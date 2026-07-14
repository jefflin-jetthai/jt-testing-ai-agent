/**
 * 產生 Notion 友善的 markdown 測試報告（每測項一份）。
 * 內容對應 Notion TC 結構，並嵌入 agent 驗證結果與錄影參照。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TestCase } from "./protocol.js";

const STATUS_EMOJI: Record<string, string> = {
  pass: "✅ PASS",
  fail: "❌ FAIL",
  warn: "⚠️ WARN",
  error: "🛑 ERROR",
};

/** 從 agent 最終輸出抽出 CHECKS 區塊（逐條確認項目結果）。 */
function extractChecks(finalText: string): string[] {
  const block = finalText.match(/CHECKS:\s*([\s\S]*?)(?:```|$)/i)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-\s*/, ""));
}

/** 把一條 check 拆成 {確認項目, 結果, 說明}。形如「<項目>: PASS - <說明>」（項目內可含全形「：」）。 */
function parseCheck(c: string): { item: string; result: string; note: string } {
  const m = c.match(/^(.*):\s*(PASS|FAIL|WARN|BLOCKED|SKIP(?:PED)?|ERROR)\b\s*[-–—]?\s*([\s\S]*)$/i);
  if (!m) return { item: c, result: "", note: "" };
  const raw = m[2].toUpperCase();
  const result = raw.startsWith("WARN") || raw.startsWith("BLOCK") || raw.startsWith("SKIP") ? "WARN" : raw;
  return { item: m[1].trim(), result, note: m[3].trim() };
}

/** markdown 表格儲存格：跳脫 `|`、把換行壓成空白，空值補「-」。 */
function cell(s: unknown): string {
  const t = String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return t || "-";
}

export interface BuildReportArgs {
  tc: TestCase;
  status: "pass" | "fail" | "warn" | "error";
  summary: string;
  finalText: string;
  agentName: string;
  durationMs: number;
  recordingFileName?: string; // 例如 TC-01.gif / TC-01.mp4（相對檔名）
  targetUrl?: string; // 受測網站
  actualEnv?: string; // agent 這次執行實際觀察到的環境（優先於 Notion 記載）
  actualVersion?: string; // agent 實際觀察到的產品版本（優先於 Notion 記載）
  /** api_check 工具留下的證據摘要（完整 request/response 在對應 json 檔） */
  apiEvidence?: { seq: number; check: string; result: string; note: string; file: string }[];
}

/** 產生 markdown 字串（表格式報告：摘要表 + 步驟表 + 確認項目表 + 結論）。 */
export function buildMarkdown(a: BuildReportArgs): string {
  const { tc, status, summary, finalText, agentName, durationMs } = a;
  const checks = extractChecks(finalText);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines: string[] = [];

  lines.push(`# ${tc.tcId} ${tc.title}`, "");

  // ── 摘要資訊表 ──
  const info: [string, string][] = [
    ["測試案例", `${tc.tcId} ${tc.title}`],
    ["整體結果", STATUS_EMOJI[status]],
  ];
  if (a.targetUrl) info.push(["受測網站", a.targetUrl]);
  // 環境/版本以「這次執行實際觀察到」為準；只有 Notion 記載時明確標注、不冒充實測值
  const env = a.actualEnv || (tc.meta?.ENV ? `${tc.meta.ENV}（Notion 記載，未實地確認）` : "");
  if (env) info.push(["測試環境", env]);
  const version =
    a.actualVersion || (tc.meta?.version ? `${tc.meta.version}（Notion 記載，未實地確認）` : "");
  if (version) info.push(["version", version]);
  info.push(["Agent", agentName]);
  info.push(["耗時", `${Math.round(durationMs / 1000)}s`]);
  info.push(["測試日期", now]);
  lines.push("| 項目 | 內容 |", "| --- | --- |");
  info.forEach(([k, v]) => lines.push(`| ${cell(k)} | ${cell(v)} |`));

  if (tc.purpose) lines.push("", `> 目的：${tc.purpose}`);

  if (tc.preconditions.length) {
    lines.push("", "## 前置條件");
    tc.preconditions.forEach((s) => lines.push(`- ${s}`));
  }

  // ── 測試步驟表 ──
  if (tc.steps.length) {
    const stepStatus = status === "pass" ? "✅ 完成" : "—";
    lines.push("", "## 測試步驟", "| # | 步驟 | 狀態 |", "| --- | --- | --- |");
    tc.steps.forEach((s, i) => lines.push(`| ${i + 1} | ${cell(s)} | ${stepStatus} |`));
  }

  // ── 確認項目表 ──
  lines.push("", "## 確認項目結果", "| # | 確認項目 | 結果 | 說明 |", "| --- | --- | --- | --- |");
  if (checks.length) {
    checks.forEach((c, i) => {
      const { item, result, note } = parseCheck(c);
      const badge = STATUS_EMOJI[result.toLowerCase()] ?? (result || "—");
      lines.push(`| ${i + 1} | ${cell(item)} | ${cell(badge)} | ${cell(note)} |`);
    });
  } else if (tc.expected.length) {
    tc.expected.forEach((s, i) => lines.push(`| ${i + 1} | ${cell(s)} | ⬜ 未驗證 | - |`));
  } else {
    lines.push("| - | (無確認項目) | - | - |");
  }

  // ── API 證據表（api_check 工具產出）──
  if (a.apiEvidence?.length) {
    lines.push("", "## API 證據", "| # | 檢查 | 結果 | 說明 | 檔案 |", "| --- | --- | --- | --- | --- |");
    for (const e of a.apiEvidence) {
      const badge = STATUS_EMOJI[e.result.toLowerCase()] ?? e.result;
      lines.push(`| ${e.seq} | ${cell(e.check)} | ${cell(badge)} | ${cell(e.note)} | ${cell(e.file)} |`);
    }
  }

  // ── 結論 ──
  lines.push("", "## 結論", summary || "(無)");

  if (a.recordingFileName) {
    lines.push("", "## 錄影", `\`${a.recordingFileName}\`（測試過程錄影，請手動拖入 Notion）`);
  }

  // 保留 agent 原始 verdict 供追溯
  const verdict = finalText.match(/```verdict[\s\S]*?```/i)?.[0];
  if (verdict) {
    lines.push("", "## Agent 原始結論", verdict);
  }

  return lines.join("\n");
}

/** 產生 markdown 並寫檔，回傳 {markdown, path}。 */
export function writeMarkdown(filePath: string, args: BuildReportArgs): string {
  const md = buildMarkdown(args);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, md, "utf8");
  return md;
}
