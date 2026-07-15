/**
 * 把一個 Notion TestCase 組成 agent 的執行 prompt 與 system prompt。
 * agent 以 chrome-devtools-mcp 驅動「使用者當前分頁」逐步執行並驗證。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestCase } from "./protocol.js";

/** system prompt：定位 agent 角色 + 重用 AT CLAUDE.md 的關鍵規範摘要。 */
export const SYSTEM_PROMPT = [
  "你是一個 E2E 測試執行 agent，透過 chrome-devtools MCP 工具操作『使用者目前正在看的這個 Chrome 分頁』。",
  "目標網站多為 Vue.js SPA：操作前務必等待元素出現/可見（等同 networkidle + wait_for visible），不要對尚未渲染的元素操作。",
  "選擇器優先序：data-testid > name > placeholder > 文字語意 > type > class，禁用 nth-child 位置選擇器。",
  "務必『接管當前分頁』而非開新分頁：先用 list_pages 找到與目標 URL 相符的分頁並 select_page，再操作。",
  "逐步執行測試步驟，每步說明你做了什麼；最後逐條檢查『確認項目』。",
  "只做測試案例描述的操作，不要進行破壞性或與測試無關的動作。",
].join("\n");

/**
 * attach 模式「專業測試執行工程師規範」（內建預設）。
 * 此為品質一致的基準；可由 AT repo 的 .github/agents/qa-test-executor.agent.md 覆寫（見 attachSystemPrompt）。
 */
export const ATTACH_SYSTEM_PROMPT_DEFAULT = `你是一位資深 E2E 測試執行工程師（QA Engineer），透過 jt-browser MCP 工具操作「使用者目前的 Chrome 分頁」（已由 extension 接管），執行 Notion 測試案例。
你的最高原則是「品質一致」：相同案例每次都依相同標準與流程執行，產出可重現、有憑證的結果。

# 可用工具
- snapshot：讀取頁面（URL、標題、互動元素 ref 清單、可見文字）。每次操作前先用它了解頁面。
- navigate：導向網址並等待載入。
- click：點擊元素（用 snapshot 的 ref，或元素文字 text）。
- fill：在輸入框填值（ref + value）。
- wait_for：等待頁面出現指定文字。
- evaluate：執行 JS 取得實際數值/狀態（驗證用）。
- set_viewport：設定 viewport 尺寸做響應式/RWD 測試（桌機 width=1200；手機 width=390, mobile=true）。

# 鐵則（必須遵守）
1. 接管當前分頁，不開新分頁、不離開受測網站（除非測試步驟明確要求 navigate）。
2. 只執行測試案例描述的操作。嚴禁破壞性/不可逆動作：送出付款、刪除資料、變更帳號或系統設定、送出無法復原的表單等——即使頁面允許也不做。
3. 每個確認項目都必須以「實際觀察到的憑證」判定（evaluate 取得的數值/文字，或 snapshot 看到的內容）。沒有憑證不得判 PASS。
4. 無法驗證時誠實標記（FAIL，並於說明寫明原因），絕不臆測、絕不編造數值或結果。
5. 被前置條件擋住（未登入、無權限、找不到元素）時，明確回報卡在哪、缺什麼，不要假裝完成。

# 標準執行流程（每個案例固定照做）
1. snapshot 確認目前在正確的受測頁面/分頁。
2. 檢查前置條件是否滿足；不滿足則如實回報並結束該案例。
3. 依「測試步驟」逐步操作，每步用語意化描述說明你做了什麼。
4. 受測站多為 Vue.js SPA，畫面非同步更新：驗證前務必 wait_for 對應文字或重新 snapshot，不要對尚未渲染/更新的內容下判斷。
5. 逐條驗證「確認項目」，每條記錄「實際觀察」（具體數值、文字、可見狀態）。

# 定位策略
- 選擇器優先序：data-testid > name > placeholder > 文字語意 > type > class。
- 禁用 nth-child / 絕對位置選擇器。
- 找不到元素時先重新 snapshot 取得最新 ref，不要硬猜。

# 量測型驗證
- 需要精確數值（寬度、數量、樣式、文字）時，用 evaluate 取 computed 值（getComputedStyle / getBoundingClientRect / querySelectorAll().length 等），不可肉眼估計。
- 對照規格時明確寫出「預期 vs 實際」。

# 輸出與判定
- CHECKS 每條格式固定：「- <確認項目>: PASS/FAIL/WARN - <實際觀察/憑證>」。
- 整體 STATUS 三選一：
  - PASS：所有確認項目皆符合。
  - FAIL：**實際觀察到不符合規格／確認項目明確失敗**（明確的異常才用 FAIL）。
  - WARN：因『前置條件』無法滿足（未登入、無權限、找不到受測頁面/元素、缺資料）而**無法執行驗證**——不要判 FAIL，改用 WARN，並在 SUMMARY 寫明卡在哪、缺什麼。`;

/** 規範檔名（隨工具散佈在 jt-testing-ai-agent 內，使用者可編輯覆寫內建預設）。 */
const EXECUTOR_SPEC_FILE = "qa-test-executor.agent.md";

/** 去掉 markdown 開頭的 YAML frontmatter（--- ... ---）。 */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? md.slice(m[0].length) : md).trim();
}

/** 規範檔可能的位置：環境變數 > 打包版（bundle.cjs 同層 agents/）> 開發版（bridge/agents/）。 */
function specCandidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.JT_EXECUTOR_SPEC) paths.push(process.env.JT_EXECUTOR_SPEC);
  // 打包版：bundle.cjs 由 node 啟動，process.argv[1] 即其路徑，規範檔放同層 agents/
  const script = process.argv[1];
  if (script) paths.push(resolve(dirname(script), "agents", EXECUTOR_SPEC_FILE));
  // 開發版：bridge/src/prompt.ts → bridge/agents/qa-test-executor.agent.md
  try {
    paths.push(resolve(fileURLToPath(import.meta.url), "..", "..", "agents", EXECUTOR_SPEC_FILE));
  } catch {
    /* 打包版 import.meta.url 為假值，忽略 */
  }
  return paths;
}

/**
 * attach 模式 system prompt（專業測試執行工程師規範）：
 * 優先讀 jt-testing-ai-agent 內的 qa-test-executor.agent.md（去掉 frontmatter），
 * 找不到才用內建預設 ATTACH_SYSTEM_PROMPT_DEFAULT。每次 run 讀取，編輯後立即生效。
 */
export function attachSystemPrompt(): string {
  for (const p of specCandidatePaths()) {
    try {
      if (existsSync(p)) {
        const body = stripFrontmatter(readFileSync(p, "utf8"));
        if (body) return body;
      }
    } catch {
      /* 試下一個候選路徑 */
    }
  }
  return ATTACH_SYSTEM_PROMPT_DEFAULT;
}

/** 單一 TC 的執行指令。要求結尾輸出機器可解析的 VERDICT 區塊與 MEMORY 知識區塊。 */
export function buildRunPrompt(
  tc: TestCase,
  target?: { url?: string; title?: string },
  knowledge?: string,
  opts?: { apiCheck?: boolean }, // attach 模式提供 api_check 工具
): string {
  const lines: string[] = [];
  lines.push(`# 測試案例 ${tc.tcId}：${tc.title}`);
  if (target?.url) lines.push(`\n目標分頁 URL：${target.url}`);
  if (tc.purpose) lines.push(`\n## 目的\n${tc.purpose}`);
  if (tc.preconditions.length)
    lines.push(`\n## 前置條件\n${tc.preconditions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (tc.steps.length)
    lines.push(`\n## 測試步驟\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (tc.expected.length)
    lines.push(`\n## 確認項目（逐條驗證）\n${tc.expected.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  if (knowledge)
    lines.push(
      `\n## 已知產品知識與執行技巧（過去測試累積，供參考）\n${knowledge}\n\n注意：知識是過去的觀察，若與實際頁面不符，以實際觀察為準。`,
    );

  lines.push(
    [
      "\n## 執行要求",
      "0. 所有瀏覽器操作一律經提供的瀏覽器工具執行；禁止用 shell/腳本直連 bridge、CDP 或 WebSocket 操作瀏覽器（會破壞測試證據與畫面尺寸）。",
      "1. 先 list_pages → 找到符合上述目標 URL 的分頁 → select_page。",
      "2. 依序執行測試步驟，必要時 take_snapshot / wait_for。",
      ...(opts?.apiCheck
        ? [
            "2.5 每開始執行『測試步驟』清單中的一步，先呼叫 step_note（seq=步驟序號、total=總步數、title=該步驟簡短標題）——" +
              "它會把目前步驟顯示在受測頁頂部橫幅並錄進影片；換下一步時再呼叫一次。",
          ]
        : []),
      "3. 逐條驗證『確認項目』，記錄實際結果。",
      ...(opts?.apiCheck
        ? [
            "3.5 需要以 API 驗證時，一律用 api_check 工具（會自動存完整回應為證據檔並把結果卡疊進錄影），不要用 evaluate 裸打 fetch，也不要用 shell/curl 繞過（那樣不會留證據）。" +
              "check 寫這次驗證什麼；assert 寫 JS 判斷式（可用 json / status / text）；note 寫預期值說明。" +
              "跨來源被 CORS 擋時工具會自動 fallback 到本機直呼（不帶 cookie），所以需要認證的 API 務必用 headers 傳 Authorization——token 先用 evaluate 從 localStorage / sessionStorage / 頁面既有請求取得。",
            "3.6 若 api_check 回報 FAIL 是因為你自己的參數／assert 寫錯（如缺 Authorization、欄位路徑錯），修正後必須「重新用 api_check」再驗一次，" +
              "不可改用 evaluate 繞過——錄影與證據檔必須呈現最終真實結果。CHECKS 的每條 API 相關結論都必須與最後一次對應 api_check 的證據一致。",
          ]
        : []),
      "4. 最後輸出下列固定格式（供程式解析）：",
      "",
      "```verdict",
      "STATUS: PASS / FAIL / WARN",
      "SUMMARY: 一句話總結",
      "ENV: <實際受測環境，依受測 URL 與頁面內容判斷（例如 ZAZADEV / staging / prod）；無法判斷寫 unknown>",
      "VERSION: <實際觀察到的產品版本字串（頁面 footer、console、API 回應等）；觀察不到寫 unknown，不要猜>",
      "CHECKS:",
      "- <確認項目1>: PASS/FAIL/WARN - 實際觀察",
      "- <確認項目2>: PASS/FAIL/WARN - 實際觀察",
      "```",
      "",
      "ENV / VERSION 必須是你「這次執行實際觀察到」的值，不可抄測試案例或文件記載。",
      "",
      "STATUS 判定原則：",
      "- 因『前置條件』無法滿足（未登入、無權限、找不到受測頁面/元素、缺資料）而無法執行驗證 → 用 WARN，並在 SUMMARY 寫明卡在哪、缺什麼。",
      "- 只有實際觀察到『不符合規格／確認項目明確失敗』才用 FAIL。",
      "- 所有確認項目皆符合 → PASS。",
      "",
      "5. 在 verdict 之後，把這次「新學到、下次測這個產品仍用得上」的知識輸出成下列格式：",
      "",
      "```memory",
      "- [技巧] <元素定位/等待/操作上的訣竅，例如：登入按鈕無 data-testid，需用文字「登入」定位>",
      "- [產品] <產品行為或功能特性，例如：訂單列表預設只顯示 30 天內資料>",
      "```",
      "",
      "知識條目原則：只收「跨測試案例可重用」的通則；已列在『已知產品知識』的不要重複；單次測試資料、本次操作流水帳不要收；沒有新發現就輸出空的 memory 區塊。",
    ].join("\n"),
  );
  return lines.join("\n");
}

/** 從 agent 最終輸出解析 memory 區塊的知識條目；沒有區塊或為空 → 空陣列。 */
export function parseMemory(finalText: string): string[] {
  const block = finalText.match(/```memory([\s\S]*?)```/i)?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l && !/^(無|沒有|N\/A|none)/i.test(l));
}

/** 取 verdict 區塊的 ENV / VERSION 實測值；unknown / 佔位字樣視為未回報。 */
function observedField(block: string, key: "ENV" | "VERSION"): string | undefined {
  const v = block.match(new RegExp(`^${key}:\\s*(.+)$`, "im"))?.[1]?.trim();
  if (!v || /^(unknown|n\/?a|無|不明|<.*>)$/i.test(v)) return undefined;
  return v;
}

/** 從 agent 最終輸出解析 verdict。找不到 verdict 區塊時保守判為 error。 */
export function parseVerdict(finalText: string): {
  status: "pass" | "fail" | "warn" | "error";
  summary: string;
  /** agent 實際觀察到的受測環境 / 產品版本（非 Notion 記載） */
  env?: string;
  version?: string;
} {
  const block = finalText.match(/```verdict([\s\S]*?)```/i)?.[1] ?? finalText;
  // WARN/BLOCKED/SKIP = 前置造成無法測試（非失敗）
  const statusM = block.match(/STATUS:\s*(PASS|FAIL|WARN|BLOCKED|SKIP(?:PED)?)/i);
  const summaryM = block.match(/SUMMARY:\s*(.+)/i);
  const env = observedField(block, "ENV");
  const version = observedField(block, "VERSION");
  if (!statusM) {
    // 沒有 verdict：常見是 agent 本身的錯誤（額度/認證等），直接把原文帶出來方便診斷
    const raw = (finalText || "").trim();
    if (/session limit|usage limit|rate limit|limit reached|quota|credit|insufficient|額度|用量|上限/i.test(raw))
      return { status: "error", summary: `Agent 額度/限制：${raw.slice(0, 160)}`, env, version };
    return {
      status: "error",
      summary: summaryM?.[1]?.trim() || raw.slice(0, 200) || "無法解析測試結果（agent 無輸出）",
      env,
      version,
    };
  }
  const s = statusM[1].toUpperCase();
  const status = s === "PASS" ? "pass" : s.startsWith("WARN") || s.startsWith("BLOCK") || s.startsWith("SKIP") ? "warn" : "fail";
  return { status, summary: summaryM?.[1]?.trim() ?? "", env, version };
}
