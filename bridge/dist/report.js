/**
 * 產生 Notion 友善的 markdown 測試報告（每測項一份）。
 * 內容對應 Notion TC 結構，並嵌入 agent 驗證結果與錄影參照。
 */
import { writeFileSync } from "node:fs";
const STATUS_EMOJI = {
    pass: "✅ PASS",
    fail: "❌ FAIL",
    error: "⚠️ ERROR",
};
/** 從 agent 最終輸出抽出 CHECKS 區塊（逐條確認項目結果）。 */
function extractChecks(finalText) {
    const block = finalText.match(/CHECKS:\s*([\s\S]*?)(?:```|$)/i)?.[1] ?? "";
    return block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("-"))
        .map((l) => l.replace(/^-\s*/, ""));
}
/** 產生 markdown 字串。 */
export function buildMarkdown(a) {
    const { tc, status, summary, finalText, agentName, durationMs } = a;
    const checks = extractChecks(finalText);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [];
    lines.push(`# ${tc.tcId} ${tc.title}`);
    lines.push("");
    lines.push(`**狀態**：${STATUS_EMOJI[status]}　·　**耗時**：${Math.round(durationMs / 1000)}s　·　**Agent**：${agentName}　·　**時間**：${now}`);
    if (tc.meta?.version || tc.meta?.ENV) {
        lines.push("");
        lines.push(`**version**：${tc.meta.version ?? "-"}　·　**ENV**：${tc.meta.ENV ?? "-"}`);
    }
    if (tc.purpose) {
        lines.push("");
        lines.push(`> 目的：${tc.purpose}`);
    }
    if (tc.preconditions.length) {
        lines.push("", "## 前置條件");
        tc.preconditions.forEach((s) => lines.push(`- ${s}`));
    }
    if (tc.steps.length) {
        lines.push("", "## 測試步驟");
        tc.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    lines.push("", "## 確認項目結果");
    if (checks.length) {
        checks.forEach((c) => {
            const ok = /:\s*pass/i.test(c) || /\bPASS\b/.test(c);
            lines.push(`- ${ok ? "✅" : "❌"} ${c}`);
        });
    }
    else {
        tc.expected.forEach((s) => lines.push(`- ⬜ ${s}`));
    }
    lines.push("", "## 摘要", summary || "(無)");
    if (a.gifFileName) {
        lines.push("", "## 錄影", `\`${a.gifFileName}\`（測試過程錄影，請手動拖入 Notion）`);
    }
    // 保留 agent 原始 verdict 供追溯
    const verdict = finalText.match(/```verdict[\s\S]*?```/i)?.[0];
    if (verdict) {
        lines.push("", "## Agent 原始結論", verdict);
    }
    return lines.join("\n");
}
/** 產生 markdown 並寫檔，回傳 {markdown, path}。 */
export function writeMarkdown(filePath, args) {
    const md = buildMarkdown(args);
    writeFileSync(filePath, md, "utf8");
    return md;
}
//# sourceMappingURL=report.js.map