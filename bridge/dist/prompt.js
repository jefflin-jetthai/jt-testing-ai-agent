/** system prompt：定位 agent 角色 + 重用 AT CLAUDE.md 的關鍵規範摘要。 */
export const SYSTEM_PROMPT = [
    "你是一個 E2E 測試執行 agent，透過 chrome-devtools MCP 工具操作『使用者目前正在看的這個 Chrome 分頁』。",
    "目標網站多為 Vue.js SPA：操作前務必等待元素出現/可見（等同 networkidle + wait_for visible），不要對尚未渲染的元素操作。",
    "選擇器優先序：data-testid > name > placeholder > 文字語意 > type > class，禁用 nth-child 位置選擇器。",
    "務必『接管當前分頁』而非開新分頁：先用 list_pages 找到與目標 URL 相符的分頁並 select_page，再操作。",
    "逐步執行測試步驟，每步說明你做了什麼；最後逐條檢查『確認項目』。",
    "只做測試案例描述的操作，不要進行破壞性或與測試無關的動作。",
].join("\n");
/** attach 模式：使用自建 jt-browser 工具（繞開 puppeteer）。 */
export const ATTACH_SYSTEM_PROMPT = [
    "你是一個 E2E 測試執行 agent，透過 jt-browser MCP 工具操作『使用者目前的 Chrome 分頁』（已由 extension 接管）。",
    "可用工具：snapshot（讀頁面+互動元素ref）、navigate、click（用 ref 或 text）、fill（ref+value）、wait_for（等文字）、evaluate（執行JS驗證）。",
    "流程：先 snapshot 了解頁面 → 依測試步驟用 click/fill/navigate 操作 →（必要時 wait_for）→ 用 evaluate/snapshot 驗證『確認項目』。",
    "目標網站多為 Vue SPA：操作後常需 wait_for 等待結果出現再驗證。",
    "只做測試案例描述的操作，不要破壞性動作。",
].join("\n");
/** 單一 TC 的執行指令。要求結尾輸出機器可解析的 VERDICT 區塊。 */
export function buildRunPrompt(tc, target) {
    const lines = [];
    lines.push(`# 測試案例 ${tc.tcId}：${tc.title}`);
    if (target?.url)
        lines.push(`\n目標分頁 URL：${target.url}`);
    if (tc.purpose)
        lines.push(`\n## 目的\n${tc.purpose}`);
    if (tc.preconditions.length)
        lines.push(`\n## 前置條件\n${tc.preconditions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (tc.steps.length)
        lines.push(`\n## 測試步驟\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (tc.expected.length)
        lines.push(`\n## 確認項目（逐條驗證）\n${tc.expected.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    lines.push([
        "\n## 執行要求",
        "1. 先 list_pages → 找到符合上述目標 URL 的分頁 → select_page。",
        "2. 依序執行測試步驟，必要時 take_snapshot / wait_for。",
        "3. 逐條驗證『確認項目』，記錄實際結果。",
        "4. 最後輸出下列固定格式（供程式解析）：",
        "",
        "```verdict",
        "STATUS: PASS 或 FAIL",
        "SUMMARY: 一句話總結",
        "CHECKS:",
        "- <確認項目1>: PASS/FAIL - 實際觀察",
        "- <確認項目2>: PASS/FAIL - 實際觀察",
        "```",
    ].join("\n"));
    return lines.join("\n");
}
/** 從 agent 最終輸出解析 verdict。找不到 verdict 區塊時保守判為 error。 */
export function parseVerdict(finalText) {
    const block = finalText.match(/```verdict([\s\S]*?)```/i)?.[1] ?? finalText;
    const statusM = block.match(/STATUS:\s*(PASS|FAIL)/i);
    const summaryM = block.match(/SUMMARY:\s*(.+)/i);
    if (!statusM)
        return { status: "error", summary: summaryM?.[1]?.trim() ?? "無法解析測試結果" };
    return {
        status: statusM[1].toUpperCase() === "PASS" ? "pass" : "fail",
        summary: summaryM?.[1]?.trim() ?? "",
    };
}
//# sourceMappingURL=prompt.js.map