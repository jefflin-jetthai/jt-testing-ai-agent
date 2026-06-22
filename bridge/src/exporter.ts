/**
 * 匯出 pytest：請 agent 依 AT repo 的 CLAUDE.md 規範與 specs/ + tests/ 架構，
 * 把選定的 Notion 測試案例固化成 pytest 測試檔（寫進本地 clone）。
 *
 * 只負責「生成檔案」；commit 由 git.commit 另行觸發（不自動 push）。
 */
import { AT_REPO_PATH, CLAUDE_MODEL, DEFAULT_AGENT } from "./config.js";
import { getAgent } from "./agents/index.js";
import { changedTestFiles } from "./git.js";
import type { TestCase, WsEvent } from "./protocol.js";

type Emit = (ev: WsEvent) => void;

const EXPORT_SYSTEM_PROMPT = [
  "你是一個資深測試工程師，負責把測試案例固化成可維護的 pytest 程式碼。",
  "嚴格遵守本專案 CLAUDE.md 的規範：",
  "- 選擇器一律用 tests/common/locators.py 的 Locators 類別，不硬編碼；缺少的選擇器才新增到對應 Locators。",
  "- 重用 tests/common/helpers.py 既有 helper 與 conftest.py 的 fixtures（page / login_page / test_config 等）。",
  "- 檔名 test_<功能>.py、函式 test_<行為>()，放對 tests/<product>/<module>/ 目錄。",
  "- Vue SPA 等待策略：networkidle + 明確 wait_for(visible)。",
  "- 適當加上 @pytest.mark（smoke/regression 等）與中文 docstring。",
  "不要捏造不存在的網站行為；無法確定的選擇器以 TODO 註記，但保持檔案語法正確、可被 pytest 收集。",
].join("\n");

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
      `1. 依 module 分類，建立或擴充 tests/${product}/<module>/test_*.py。`,
      "2. 先 Read 相關的 locators.py / helpers.py / conftest.py 了解可用資源再動手。",
      "3. 完成後執行 `uv run pytest <新檔> --collect-only -q` 確認可被收集（語法正確）。",
      "4. 最後條列你建立/修改了哪些檔案。",
    ].join("\n"),
  );
  return lines.join("\n");
}

export async function exportToPytest(
  payload: { cases: TestCase[]; product?: string; agent?: string },
  emit: Emit,
): Promise<{ files: string[]; summary: string }> {
  const product = payload.product ?? "pwa";
  const agentName = payload.agent ?? DEFAULT_AGENT;
  const agent = getAgent(agentName);
  if (!(await agent.isAvailable())) throw new Error(`agent '${agentName}' 不可用`);

  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `開始生成 pytest（product=${product}, ${payload.cases.length} 案例）…` } });

  const res = await agent.run({
    prompt: buildExportPrompt(payload.cases, product),
    systemPrompt: EXPORT_SYSTEM_PROMPT,
    cwd: AT_REPO_PATH,
    model: agentName === "claude" ? CLAUDE_MODEL : undefined,
    onEvent: (e) => emit({ type: "agent.log", payload: { runId: "export", kind: e.kind, text: e.text } }),
  });

  const files = await changedTestFiles();
  emit({ type: "agent.log", payload: { runId: "export", kind: "system", text: `生成完成，異動檔案：${files.length} 個` } });
  return { files, summary: res.finalText };
}
