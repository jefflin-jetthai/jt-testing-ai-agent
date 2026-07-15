/**
 * 執行編排：對每個勾選的 TestCase，請 agent 接管當前分頁執行，
 * 串流事件給 extension，並解析 verdict 產出 run.result。
 *
 * Phase 2 聚焦「即時探索式驅動」；錄影(gif)/markdown 寫回於 Phase 3/4 接上。
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentCwd,
  artifactsDir,
  CDP_BROWSER_URL,
  CLAUDE_MODEL,
  CODEX_MODEL,
  DEFAULT_AGENT,
} from "./config.js";
import { getAgent } from "./agents/index.js";
import {
  CHROME_DEVTOOLS_TOOLS,
  JT_BROWSER_TOOLS,
  probeCdp,
  writeBrowserMcpConfig,
  writeMcpConfig,
} from "./mcp.js";
import { isRelayConnected, apiEvidence, viewportGate } from "./attach.js";
import { attachSystemPrompt, SYSTEM_PROMPT, buildRunPrompt, parseMemory, parseVerdict } from "./prompt.js";
import { appendKnowledge, loadKnowledge, productKey } from "./knowledge.js";
import { StepRecorder, ScreencastRecorder, findPageWsUrl } from "./recorder.js";
import type { RecordingFormat } from "./recorder.js";
import { writeMarkdown } from "./report.js";
import { BRIDGE_PORT } from "./config.js";
import type {
  AgentLogPayload,
  RunResultPayload,
  RunStartPayload,
  WsEvent,
} from "./protocol.js";

type Emit = (ev: WsEvent) => void;

const activeRuns = new Map<string, AbortController>();
const RECORDER_STOP_TIMEOUT_MS = 45_000;

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 從 agent CLI 的原始事件抓「實際解析到的 model id」（別名 → 完整版本）。
 * claude：init 事件的 model / assistant 事件的 message.model；codex：事件或 msg 內的 model 欄位（若有）。
 */
function extractResolvedModel(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, any>;
  for (const m of [o.model, o.message?.model, o.msg?.model]) {
    if (typeof m === "string" && m) return m;
  }
  return undefined;
}

function artifactBaseName(tcId: string): string {
  return (tcId || "TC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "TC";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 逾時（${Math.round(ms / 1000)}s）`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function cancelRun(runId: string): boolean {
  const ctrl = activeRuns.get(runId);
  if (ctrl) {
    ctrl.abort();
    activeRuns.delete(runId);
    return true;
  }
  return false;
}

export async function startRun(
  payload: RunStartPayload,
  emit: Emit,
): Promise<{ runId: string }> {
  // 以本地時間命名產出資料夾，方便辨識（YYYY-MM-DD_HH-MM-SS_xxxx；後綴防同秒碰撞）
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const runId = `${stamp}_${randomUUID().slice(0, 4)}`;
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);

  if (!(await agent.isAvailable())) {
    throw new Error(`agent '${agentName}' CLI 不存在或不可用`);
  }

  const mode = payload.mode ?? "remote";
  const recFormat: RecordingFormat = payload.recording === "mp4" ? "mp4" : "gif";

  // attach 模式：用自建 jt-browser MCP（Runtime.evaluate）經 chrome.debugger 驅動當前分頁，繞開 puppeteer。
  // remote 模式：用 chrome-devtools-mcp 連 9222。
  let probe: Awaited<ReturnType<typeof probeCdp>> = { ok: true };
  if (mode === "attach") {
    if (!isRelayConnected()) {
      throw new Error("尚未接管當前分頁：請先在 side panel 按「接管當前分頁」。");
    }
  } else {
    probe = await probeCdp(CDP_BROWSER_URL);
    if (!probe.ok) {
      throw new Error(
        `無法連到目標 Chrome 的 CDP（${CDP_BROWSER_URL}）。\n` +
          `請按 side panel 的「啟動測試用 Chrome」，或手動以 --remote-debugging-port=9222 啟動。\n錯誤：${probe.error}`,
      );
    }
  }

  const ctrl = new AbortController();
  activeRuns.set(runId, ctrl);

  // 非同步跑完整批，立即回 runId 讓 UI 開始顯示串流。
  // 任何未預期錯誤都必須落到 finally，否則 UI 會卡在「執行中」。
  void (async () => {
    const log = (p: Omit<AgentLogPayload, "runId">) =>
      emit({ type: "agent.log", payload: { runId, ...p } });
    let runError: string | undefined;
    let resolvedModelReported = false; // 每 run 只回報一次實際 model
    try {
      const allowedTools = mode === "attach" ? JT_BROWSER_TOOLS : CHROME_DEVTOOLS_TOOLS;
      const remoteMcpConfigPath = mode === "attach" ? null : writeMcpConfig(CDP_BROWSER_URL);
      const systemPrompt = mode === "attach" ? attachSystemPrompt() : SYSTEM_PROMPT;

      // claude 由 bridge 指定 model；codex/antigravity 用各自 CLI 的預設 model
      // claude / codex 可由 UI 下拉指定 model（payload.model）；codex 未指定用 config.toml；antigravity 用 CLI 預設
      const resolvedModel =
        agentName === "claude"
          ? payload.model || CLAUDE_MODEL
          : agentName === "codex"
            ? payload.model || (CODEX_MODEL.startsWith("(") ? undefined : CODEX_MODEL)
            : undefined;
      const modelLabel =
        agentName === "claude"
          ? payload.model || CLAUDE_MODEL
          : agentName === "codex"
            ? payload.model || CODEX_MODEL
            : "(CLI 預設)";
      log({
        kind: "system",
        text:
          (mode === "attach"
            ? `接管當前分頁就緒（jt-browser 工具，繞開 puppeteer）。`
            : `Chrome 已連線：${probe.version}（${probe.pages?.length ?? 0} 個分頁）。`) +
          `agent=${agentName} · model=${modelLabel}`,
      });

      const runDir = join(artifactsDir(), runId);
      mkdirSync(runDir, { recursive: true });

      for (const tc of payload.cases) {
        if (ctrl.signal.aborted) break;
        const startedAt = Date.now();
        const artifactBase = artifactBaseName(tc.tcId);
        emit({ type: "run.step", payload: { runId, tcId: tc.tcId, phase: "start", title: tc.title } });

        // 開始錄影（每測項一段；失敗不阻擋測試）。attach→經 chrome.debugger；remote→連 9222。
        const recPathOut = join(runDir, `${artifactBase}.${recFormat}`);
        const recTmp = join(runDir, `.tmp-${artifactBase}`);
        let recorder: ScreencastRecorder | StepRecorder | null = null;
        const stopRecorder = async (): Promise<string | undefined> => {
          if (!recorder) return undefined;
          try {
            return (
              (await withTimeout(
                recorder.stop(),
                RECORDER_STOP_TIMEOUT_MS,
                "錄影停止/合成",
              )) ?? undefined
            );
          } catch (e) {
            log({ tcId: tc.tcId, kind: "stderr", text: `錄影停止失敗：${formatError(e)}` });
            return undefined;
          } finally {
            recorder = null;
          }
        };

        try {
          const tcLabel = [tc.tcId, tc.title].filter(Boolean).join(" ").slice(0, 80);
          if (mode === "attach") {
            recorder = new StepRecorder(recPathOut, recTmp, recFormat, tcLabel);
            await recorder.start();
          } else {
            const pageWs = await findPageWsUrl(payload.target?.url, CDP_BROWSER_URL);
            if (pageWs) {
              recorder = new ScreencastRecorder(pageWs, recPathOut, recTmp, recFormat, tcLabel);
              await recorder.start();
            } else {
              log({ tcId: tc.tcId, kind: "stderr", text: "找不到可錄影的分頁，略過錄影" });
            }
          }
        } catch (e) {
          log({ tcId: tc.tcId, kind: "stderr", text: `錄影啟動失敗：${formatError(e)}` });
          recorder = null;
        }

        // API 證據（api_check 工具）：寫入 <TC>-api-NN.json，並收摘要供報告表格
        const apiEvidences: {
          seq: number;
          check: string;
          result: string;
          note: string;
          file: string;
        }[] = [];
        apiEvidence.handler = (ev) => {
          try {
            const seq = Number((ev as any)?.seq) || apiEvidences.length + 1;
            const file = `${artifactBase}-api-${String(seq).padStart(2, "0")}.json`;
            writeFileSync(join(runDir, file), JSON.stringify({ tcId: tc.tcId, ...ev }, null, 2));
            const assert = (ev as any)?.assert;
            apiEvidences.push({
              seq,
              check: String((ev as any)?.check ?? ""),
              result: String(assert?.result ?? "INFO"),
              note: String(assert?.note ?? ""),
              file,
            });
            // API 錯誤（網路錯誤 / HTTP >=400 / assert FAIL）→ 即時紅色警示；正常 → 一般紀錄
            const req = (ev as any)?.request ?? {};
            const resp = (ev as any)?.response ?? {};
            const status = Number(resp.status ?? 0);
            const reason = resp.error
              ? `網路錯誤：${resp.error}`
              : status >= 400
                ? `HTTP ${status}`
                : assert?.result === "FAIL"
                  ? `驗證不符：${assert?.note || assert?.expression || "assert 不成立"}`
                  : "";
            if (reason) {
              log({
                tcId: tc.tcId,
                kind: "stderr",
                text: `🛑 API 錯誤 #${seq}：${req.method ?? ""} ${req.url ?? ""} → ${reason}（詳見 ${file}）`,
              });
            } else {
              log({ tcId: tc.tcId, kind: "system", text: `API 證據 #${seq}（${assert?.result ?? "INFO"}）→ ${file}` });
            }
          } catch (e) {
            log({ tcId: tc.tcId, kind: "stderr", text: `API 證據寫入失敗：${formatError(e)}` });
          }
        };

        // 每個 TC 都重讀知識庫：同一批 run 內，後面的 TC 能用到前面剛學到的知識
        const knowledgeKey = productKey(payload.target?.url);
        const prompt = buildRunPrompt(tc, payload.target, loadKnowledge(knowledgeKey), {
          apiCheck: mode === "attach",
        });
        // set_viewport 只在 TC 明確要求 RWD/響應式驗證時開放（每 TC 判斷）；
        // viewportGate 是 relay 層閘門，agent 繞過工具直連 /agent-cdp 也會被擋
        const wantsViewport = /rwd|responsive|響應式|自適應|適配|viewport|手機版|平板|窄螢幕|mobile/i.test(
          [tc.title, tc.purpose, ...tc.steps, ...tc.expected].join(" "),
        );
        viewportGate.allowed = wantsViewport;
        const mcpConfigPath = remoteMcpConfigPath ?? writeBrowserMcpConfig(wantsViewport);
        let finalText = "";
        try {
          const res = await agent.run({
            prompt,
            systemPrompt,
            cwd: agentCwd(),
            mcpConfigPath,
            allowedTools,
            model: resolvedModel,
            signal: ctrl.signal,
            onEvent: (e) => {
              log({ tcId: tc.tcId, kind: e.kind, text: e.text });
              if (!resolvedModelReported) {
                const m = extractResolvedModel(e.raw);
                if (m) {
                  resolvedModelReported = true;
                  emit({ type: "run.model", payload: { runId, agent: agentName, model: m } });
                }
              }
            },
          });
          finalText = res.finalText || (res.ok ? "" : "agent 執行失敗（未回傳錯誤內容）");
        } catch (err) {
          finalText = formatError(err);
        } finally {
          apiEvidence.handler = null;
          viewportGate.allowed = false;
        }

        // 被使用者中止 → 不產出 markdown / 結果，直接結束
        if (ctrl.signal.aborted) {
          await stopRecorder();
          log({ tcId: tc.tcId, kind: "system", text: "已中止，略過此測項報告" });
          break;
        }

        const recPath = await stopRecorder();
        if (recPath) log({ tcId: tc.tcId, kind: "system", text: `已產出錄影：${recPath}` });

        const verdict = parseVerdict(finalText);

        // 回寫產品知識庫（失敗不影響測試結果）
        try {
          const learned = parseMemory(finalText);
          if (learned.length) {
            const { added, path } = appendKnowledge(knowledgeKey, learned, tc.tcId);
            if (added > 0)
              log({ tcId: tc.tcId, kind: "system", text: `已累積產品知識 ${added} 條 → ${path}` });
          }
        } catch (e) {
          log({ tcId: tc.tcId, kind: "stderr", text: `知識庫寫入失敗：${formatError(e)}` });
        }

        const durationMs = Date.now() - startedAt;
        const recFileName = recPath ? `${artifactBase}.${recFormat}` : undefined;
        const recUrl = recFileName
          ? `http://localhost:${BRIDGE_PORT}/artifacts/${runId}/${recFileName}`
          : undefined;

        // 產生 Notion 友善 markdown 並寫檔
        const mdPath = join(runDir, `${artifactBase}.md`);
        const markdown = writeMarkdown(mdPath, {
          tc,
          status: verdict.status,
          summary: verdict.summary || finalText.slice(0, 200),
          finalText,
          agentName,
          durationMs,
          recordingFileName: recFileName,
          targetUrl: payload.target?.url,
          actualEnv: verdict.env,
          actualVersion: verdict.version,
          apiEvidence: apiEvidences,
        });

        const result: RunResultPayload = {
          runId,
          tcId: tc.tcId,
          status: verdict.status,
          summary: verdict.summary || finalText.slice(0, 200),
          markdown,
          markdownPath: mdPath,
          recordingPath: recPath,
          recordingUrl: recUrl,
          recordingFormat: recPath ? recFormat : undefined,
          // 舊欄位相容（舊版 extension 只認 gifPath/gifUrl）
          gifPath: recPath,
          gifUrl: recUrl,
          durationMs,
        };
        emit({ type: "run.result", payload: result });
      }
    } catch (err) {
      runError = formatError(err);
      log({ kind: "stderr", text: `run 異常結束：${runError}` });
      emit({ type: "error", payload: { runId, error: runError } });
    } finally {
      activeRuns.delete(runId);
      emit({ type: "run.done", payload: { runId, cancelled: ctrl.signal.aborted, error: runError } });
    }
  })();

  return { runId };
}
