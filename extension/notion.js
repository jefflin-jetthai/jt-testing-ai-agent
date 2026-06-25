/**
 * Notion 讀取（extension 端直接 fetch）。
 * 模式參考 chrome-traslate-compare-plugin：token 存 chrome.storage.sync、
 * Notion-Version 2022-06-28、resolveDataSource(page/database 皆可)。
 *
 * 針對 QA 測試案例頁面（每個 heading = 一個 TC，底下用
 * 目的 / 前置條件 / 測試步驟 / 確認項目 區段標籤 + to_do 條列）做解析。
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/**
 * 從使用者輸入（完整 Notion 網址或純 ID）萃取 32 碼 page id。
 * 例：https://app.notion.com/p/2019b2c/QA-380b399ad8b580d0b87fe2c04fee33d1?source=...
 *     → 380b399ad8b580d0b87fe2c04fee33d1
 */
export function extractPageId(input) {
  if (!input) return "";
  // 去掉 query/hash、結尾斜線，再去掉 dash；page id 永遠是 slug 結尾的 32 碼
  const cleaned = String(input)
    .split(/[?#]/)[0]
    .trim()
    .replace(/\/+$/, "")
    .replace(/-/g, "");
  const tail = cleaned.slice(-32);
  if (/^[0-9a-f]{32}$/i.test(tail)) return tail.toLowerCase();
  // 後備：取第一段 32 碼十六進位
  const m = cleaned.match(/[0-9a-fA-F]{32}/);
  return (m ? m[0] : cleaned).toLowerCase();
}

/** 從 chrome.storage.sync 取設定。 */
export function getNotionSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["notionToken", "testPageId"], (s) =>
      resolve({ token: s.notionToken || "", pageId: s.testPageId || "" }),
    );
  });
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function api(token, path) {
  const res = await fetch(`${NOTION_API}${path}`, { headers: headers(token) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Notion HTTP ${res.status}`);
  return json;
}

/** 取一個 block 的所有 children（自動分頁）。 */
async function getChildren(token, blockId) {
  const out = [];
  let cursor;
  do {
    const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const json = await api(token, `/blocks/${blockId}/children?${qs}`);
    out.push(...(json.results || []));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return out;
}

/** 取 block 的純文字。 */
function blockText(b) {
  const o = b[b.type];
  if (!o) return "";
  const rt = o.rich_text || o.title || [];
  return Array.isArray(rt) ? rt.map((t) => t.plain_text || "").join("") : "";
}

function isHeading(type) {
  return /^heading_[1-6]$/.test(type) || type === "toggle";
}

const TC_RE = /\bTC[-_ ]?\d+/i;

const CJK_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 從標題開頭的序號（阿拉伯數字或一二三…）取編號；取不到回 null。 */
function ordinalOf(text) {
  const m = String(text).trim().match(/^[\s\W]*(\d+|[一二三四五六七八九十]+)/);
  if (!m) return null;
  const tok = m[1];
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  if (CJK_NUM[tok]) return CJK_NUM[tok]; // 一～十
  return null;
}

/** 區段標籤判斷 → 回傳 section key 或 null。 */
function sectionOf(text) {
  const t = text.trim();
  if (/^目的|^目標|purpose/i.test(t)) return "purpose";
  if (/前置條件|前提|precondition/i.test(t)) return "preconditions";
  if (/測試步驟|^步驟|^操作|steps/i.test(t)) return "steps";
  if (/確認項目|預期|驗證|expected|assert/i.test(t)) return "expected";
  if (/AI\s*測試報告|ai\s*report/i.test(t)) return "_aiReport";
  return null;
}

/** 解析單一 TC heading 的 children → {purpose, preconditions, steps, expected, aiReportBlockId}。 */
async function parseTcDetail(token, tcBlockId) {
  const children = await getChildren(token, tcBlockId);
  const detail = {
    purpose: "",
    preconditions: [],
    steps: [],
    expected: [],
    aiReportBlockId: undefined,
  };
  let current = null;

  for (const b of children) {
    const text = blockText(b).trim();
    const sec = sectionOf(text);
    if (sec === "_aiReport") {
      detail.aiReportBlockId = b.id;
      current = null;
      continue;
    }
    if (sec) {
      current = sec;
      // 標籤同列可能就帶內容（如「目的：xxx」）
      const inline = text.replace(/^[^：:]*[：:]/, "").trim();
      if (sec === "purpose" && inline) detail.purpose = inline;
      continue;
    }
    if (!text) continue;
    // 條列 / 內文 → 歸入目前區段
    if (current === "purpose") {
      detail.purpose = detail.purpose ? `${detail.purpose} ${text}` : text;
    } else if (current && Array.isArray(detail[current])) {
      detail[current].push(text);
    }
  }
  return detail;
}

/** 取頁面屬性中的純文字摘要（version / ENV / Status / Name）。 */
function pageMeta(page) {
  const props = page.properties || {};
  const meta = {};
  for (const [k, v] of Object.entries(props)) {
    const t = v.type;
    if (t === "title") meta[k] = (v.title || []).map((x) => x.plain_text).join("");
    else if (t === "rich_text")
      meta[k] = (v.rich_text || []).map((x) => x.plain_text).join("");
    else if (t === "status" || t === "select") meta[k] = v[t]?.name || "";
    else if (t === "people")
      meta[k] = (v.people || []).map((p) => p.name || p.id).join(", ");
  }
  return meta;
}

/**
 * 讀取一個 QA 頁面的所有測試案例。
 * 遞迴掃描 block 樹，任何文字含 TC-\d+ 的 heading/toggle 視為一個 TC，
 * 其 children 解析為 目的/前置條件/步驟/確認項目。
 */
export async function readTestCases(pageId) {
  const { token, pageId: defaultPage } = await getNotionSettings();
  if (!token) throw new Error("尚未設定 Notion Token（請開 Options 頁設定）");
  const pid = extractPageId(pageId || defaultPage || "");
  if (!pid || pid.length !== 32)
    throw new Error("頁面 ID 無效：請貼完整 Notion 頁面網址或 32 碼 ID");

  let page;
  try {
    page = await api(token, `/pages/${pid}`);
  } catch (e) {
    throw new Error(
      `讀取頁面失敗（${e.message}）。請確認：1) 頁面 ID 正確 2) 已在 Notion 該頁面「···→連接→你的 integration」把頁面分享給 integration。`,
    );
  }
  const meta = pageMeta(page);

  const cases = [];
  const MAX_DEPTH = 3;
  let autoSeq = 0; // 沒有 TC 編號時的後備流水號

  async function walk(blockId, depth) {
    if (depth > MAX_DEPTH) return;
    const children = await getChildren(token, blockId);
    for (const b of children) {
      if (!isHeading(b.type)) continue; // 只看 heading / toggle
      const text = blockText(b);

      // 1) 標題含 TC 編號 → 直接是一個案例
      if (TC_RE.test(text)) {
        const tcId = (text.match(TC_RE)[0] || "").replace(/[_ ]/, "-").toUpperCase();
        const detail = await parseTcDetail(token, b.id);
        cases.push({
          blockId: b.id,
          pageId: pid,
          tcId,
          title: text.replace(/^\W*TC[-_ ]?\d+\s*/i, "").trim() || text.trim(),
          ...detail,
          meta,
        });
        continue;
      }

      if (!b.has_children) continue;

      // 2) 沒有 TC 編號的 heading/toggle：先解析內容判斷它是「案例」還是「分類」。
      //    內含 測試目的/步驟/確認項目 → 視為一個案例（如「一、xxx驗證」格式）；
      //    否則當分類，往下遞迴找子案例（如「前台回歸測試」底下）。
      const detail = await parseTcDetail(token, b.id);
      const looksLikeCase =
        detail.purpose || detail.steps.length > 0 || detail.expected.length > 0;
      if (looksLikeCase) {
        const n = ordinalOf(text) ?? ++autoSeq;
        cases.push({
          blockId: b.id,
          pageId: pid,
          tcId: `TC-${String(n).padStart(2, "0")}`,
          title: text.trim(),
          ...detail,
          meta,
        });
      } else {
        await walk(b.id, depth + 1);
      }
    }
  }

  await walk(pid, 0);
  return { meta, cases };
}

/**
 * Phase 4 用：把 AI 測試報告 markdown 寫回 TC 的「AI測試報告結果」heading 底下。
 * 以 paragraph blocks append（Notion 一次 append 上限 100 blocks）。
 */
export async function appendAiReport(token, aiReportBlockId, markdown) {
  const lines = markdown.split("\n");
  const children = lines.slice(0, 95).map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: line ? [{ type: "text", text: { content: line.slice(0, 2000) } }] : [] },
  }));
  const res = await fetch(`${NOTION_API}/blocks/${aiReportBlockId}/children`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ children }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `寫回失敗 HTTP ${res.status}`);
  return json;
}
