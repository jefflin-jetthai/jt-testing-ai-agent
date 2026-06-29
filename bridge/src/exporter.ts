/**
 * 匯出 pytest：請 agent 依 AT repo 的 CLAUDE.md 規範與 specs/ + tests/ 架構，
 * 把選定的 Notion 測試案例固化成 pytest 測試檔（寫進本地 clone）。
 *
 * 只負責「生成檔案」；commit 由 git.commit 另行觸發（不自動 push）。
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { atRepoPath, CLAUDE_MODEL, CODEX_MODEL, DEFAULT_AGENT } from "./config.js";
import { getAgent } from "./agents/index.js";
import { changedTestFiles, listUntrackedTestFiles } from "./git.js";
import type { TestCase, WsEvent } from "./protocol.js";

/** AT repo 內的測試產生器 agent 規範檔。 */
const GENERATOR_AGENT_FILE = ".github/agents/playwright-test-generator.agent.md";

/** 讀取產生器規範（去掉 YAML frontmatter）當作 system prompt；找不到則回退簡短規範。 */
function loadGeneratorSpec(): string {
  const p = resolve(atRepoPath(), GENERATOR_AGENT_FILE);
  if (existsSync(p)) {
    let body = readFileSync(p, "utf8");
    // 去除開頭的 --- frontmatter ---
    body = body.replace(/^---\n[\s\S]*?\n---\n/, "");
    return (
      "以下是本專案的 Playwright 測試產生器規範，請嚴格遵循：\n\n" +
      body +
      "\n\n（註：若無法使用瀏覽器/MCP 檢視工具，則依測試案例與既有 locators.py 生成，無法確定的選擇器以 TODO 標註。）"
    );
  }
  return FALLBACK_SYSTEM_PROMPT;
}

const FALLBACK_SYSTEM_PROMPT = [
  "你是一個資深測試工程師，把測試案例固化成可維護的 pytest 程式碼，嚴格遵守本專案 CLAUDE.md 規範：",
  "選擇器用 tests/common/locators.py 的 Locators 類別、重用 helpers.py / conftest.py fixtures、",
  "檔名 test_<功能>.py、放對 tests/<product>/<module>/、Vue SPA 用 networkidle + wait_for(visible)。",
].join("\n");

type Emit = (ev: WsEvent) => void;

let exportCtrl: AbortController | null = null;

/** 中止進行中的匯出（由 UI 觸發）。 */
export function cancelExport(): boolean {
  if (exportCtrl) {
    exportCtrl.abort();
    exportCtrl = null;
    return true;
  }
  return false;
}

function buildExportPrompt(cases: TestCase[], product: string): string {
  const lines: string[] = [];
  lines.push(`請為以下 ${cases.length} 個測試案例產生 pytest 測試檔，產品線：${product}。`);
  lines.push("");
  for (const tc of cases) {
    lines.push(`## ${tc.tcId} ${tc.title}`);
    if (tc.purpose) lines.push(`目的：${tc.purpose}`);
    if (tc.preconditions.length) lines.push(`前置條件：\n${tc.preconditions.map((s) => `- ${s}`).join("\n")}`);
    if (tc.steps.length) lines.push(`測試步驟：\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (tc.expected.length) lines.push(`確認項目：\n${tc.expected.map((s) => `- ${s}`).join("\n")}`);
    lines.push("");
  }
  lines.push(
    [
      "要求：",
      `1. 依產生器規範與 module 分類，建立或擴充 tests/${product}/<module>/test_*.py。`,
      "2. 先 Read 規範所指定的規則檔與相關 locators.py / helpers.py / conftest.py 再動手。",
      "3. **產生完成後不需執行 pytest 或任何驗證**。",
      "4. 最後條列你建立/修改了哪些檔案。",
    ].join("\n"),
  );
  return lines.join("\n");
}

export async function exportToPytest(
  payload: { cases: TestCase[]; product?: string; agent?: string; model?: string },
  emit: Emit,
): Promise<{ files: string[]; summary: string }> {
  const atRepo = atRepoPath();
  if (!atRepo) throw new Error("未設定 automatic-testing 專案路徑，無法匯出 pytest（請於設定頁填寫）");
  const product = payload.product ?? "pwa";
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);
  if (!(await agent.isAvailable())) throw new Error(`agent '${agentName}' 不可用`);
  // 沿用測試執行區設定的 model：claude/codex 用 payload.model；codex 未指定用 config.toml
  const resolvedModel =
    agentName === "claude"
      ? payload.model || CLAUDE_MODEL
      : agentName === "codex"
        ? payload.model || (CODEX_MODEL.startsWith("(") ? undefined : CODEX_MODEL)
        : undefined;

  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `開始生成 pytest（product=${product}, ${payload.cases.length} 案例）…` } });

  // 記錄匯出前既有的未追蹤檔，供中止時清除「本次新產生」的檔案
  const beforeUntracked = new Set(await listUntrackedTestFiles());

  const ctrl = new AbortController();
  exportCtrl = ctrl;
  let res;
  try {
    res = await agent.run({
      prompt: buildExportPrompt(payload.cases, product),
      systemPrompt: loadGeneratorSpec(),
      cwd: atRepo,
      model: resolvedModel,
      signal: ctrl.signal,
      onEvent: (e) => emit({ type: "agent.log", payload: { runId: "export", kind: e.kind, text: e.text } }),
    });
  } finally {
    exportCtrl = null;
  }

  // 被中止 → 移除本次新產生的未追蹤檔，且不回報任何產出
  if (ctrl.signal.aborted) {
    const created = (await listUntrackedTestFiles()).filter((f) => !beforeUntracked.has(f));
    for (const f of created) {
      try {
        rmSync(resolve(atRepo, f), { force: true });
      } catch {
        /* noop */
      }
    }
    emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `已中止匯出，已移除本次新產生 ${created.length} 個檔案` } });
    throw new Error("已中止匯出（不採用產出）");
  }

  const files = await changedTestFiles();
  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `生成完成，異動檔案：${files.length} 個` } });
  return { files, summary: res.finalText };
}
