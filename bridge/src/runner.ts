/**
 * 執行編排：對每個勾選的 TestCase，請 agent 接管當前分頁執行，
 * 串流事件給 extension，並解析 verdict 產出 run.result。
 *
 * Phase 2 聚焦「即時探索式驅動」；錄影(gif)/markdown 寫回於 Phase 3/4 接上。
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACTS_DIR,
  AT_REPO_PATH,
  CDP_BROWSER_URL,
  CLAUDE_MODEL,
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
import { isRelayConnected } from "./attach.js";
import { ATTACH_SYSTEM_PROMPT, SYSTEM_PROMPT, buildRunPrompt, parseVerdict } from "./prompt.js";
import { ScreencastRecorder, findPageWsUrl } from "./recorder.js";
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
  const runId = randomUUID().slice(0, 8);
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);

  if (!(await agent.isAvailable())) {
    throw new Error(`agent '${agentName}' CLI 不存在或不可用`);
  }

  const mode = payload.mode ?? "remote";
  const canRecord = mode === "remote"; // attach 模式暫不錄影

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

  // 非同步跑完整批，立即回 runId 讓 UI 開始顯示串流
  void (async () => {
    const log = (p: Omit<AgentLogPayload, "runId">) =>
      emit({ type: "agent.log", payload: { runId, ...p } });
    const mcpConfigPath = mode === "attach" ? writeBrowserMcpConfig() : writeMcpConfig(CDP_BROWSER_URL);
    const allowedTools = mode === "attach" ? JT_BROWSER_TOOLS : CHROME_DEVTOOLS_TOOLS;
    const systemPrompt = mode === "attach" ? ATTACH_SYSTEM_PROMPT : SYSTEM_PROMPT;

    log({
      kind: "system",
      text:
        mode === "attach"
          ? `接管當前分頁就緒（jt-browser 工具，繞開 puppeteer）。agent=${agentName}，attach 模式暫不錄影`
          : `Chrome 已連線：${probe.version}（${probe.pages?.length ?? 0} 個分頁）。agent=${agentName}`,
    });

    const runDir = join(ARTIFACTS_DIR, runId);
    mkdirSync(runDir, { recursive: true });

    for (const tc of payload.cases) {
      if (ctrl.signal.aborted) break;
      const startedAt = Date.now();
      emit({ type: "run.step", payload: { runId, tcId: tc.tcId, phase: "start", title: tc.title } });

      // 開始錄影（每測項一段；失敗不阻擋測試）。attach 模式暫不錄影。
      let recorder: ScreencastRecorder | null = null;
      try {
        const pageWs = canRecord
          ? await findPageWsUrl(payload.target?.url, CDP_BROWSER_URL)
          : null;
        if (pageWs) {
          recorder = new ScreencastRecorder(
            pageWs,
            join(runDir, `${tc.tcId}.gif`),
            join(runDir, `.tmp-${tc.tcId}`),
          );
          await recorder.start();
        } else if (canRecord) {
          log({ tcId: tc.tcId, kind: "stderr", text: "找不到可錄影的分頁，略過錄影" });
        }
      } catch (e) {
        log({ tcId: tc.tcId, kind: "stderr", text: `錄影啟動失敗：${(e as Error).message}` });
        recorder = null;
      }

      const prompt = buildRunPrompt(tc, payload.target);
      let finalText = "";
      try {
        const res = await agent.run({
          prompt,
          systemPrompt,
          cwd: AT_REPO_PATH,
          mcpConfigPath,
          allowedTools,
          model: agentName === "claude" ? CLAUDE_MODEL : undefined,
          signal: ctrl.signal,
          onEvent: (e) => log({ tcId: tc.tcId, kind: e.kind, text: e.text }),
        });
        finalText = res.finalText;
      } catch (err) {
        finalText = err instanceof Error ? err.message : String(err);
      }

      let gifPath: string | undefined;
      if (recorder) {
        try {
          gifPath = (await recorder.stop()) ?? undefined;
          if (gifPath) log({ tcId: tc.tcId, kind: "system", text: `🎞 已產出錄影：${gifPath}` });
        } catch (e) {
          log({ tcId: tc.tcId, kind: "stderr", text: `錄影合成失敗：${(e as Error).message}` });
        }
      }

      const verdict = parseVerdict(finalText);
      const durationMs = Date.now() - startedAt;
      const gifFileName = gifPath ? `${tc.tcId}.gif` : undefined;

      // 產生 Notion 友善 markdown 並寫檔
      const mdPath = join(runDir, `${tc.tcId}.md`);
      const markdown = writeMarkdown(mdPath, {
        tc,
        status: verdict.status,
        summary: verdict.summary || finalText.slice(0, 200),
        finalText,
        agentName,
        durationMs,
        gifFileName,
      });

      const result: RunResultPayload = {
        runId,
        tcId: tc.tcId,
        status: verdict.status,
        summary: verdict.summary || finalText.slice(0, 200),
        markdown,
        markdownPath: mdPath,
        gifPath,
        gifUrl: gifFileName
          ? `http://localhost:${BRIDGE_PORT}/artifacts/${runId}/${gifFileName}`
          : undefined,
        durationMs,
      };
      emit({ type: "run.result", payload: result });
    }

    activeRuns.delete(runId);
    emit({ type: "run.done", payload: { runId } });
  })();

  return { runId };
}
