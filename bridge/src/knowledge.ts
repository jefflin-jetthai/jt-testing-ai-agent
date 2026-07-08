/**
 * 產品知識庫：每次測試後累積 agent 學到的「產品特性 / 執行技巧」，
 * 下次執行注入 prompt，讓相同產品越測越熟。
 *
 * 存放位置比照 artifactsDir()：有設定 AT repo → <AT repo>/knowledge/<產品>.md（可 git 版控）；
 * 未設定 → <DATA_DIR>/knowledge/<產品>.md。
 * 檔案為純 markdown 條列，每條帶來源（TC id、日期），人工可直接編輯/刪除過期知識。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { atRepoPath, DATA_DIR } from "./config.js";

/** 注入 prompt 的條目上限：超過只取最新的，避免知識庫膨脹後灌爆 prompt。 */
const MAX_INJECT_ENTRIES = 80;

function knowledgeDir(): string {
  const p = atRepoPath();
  return p ? resolve(p, "knowledge") : resolve(DATA_DIR, "knowledge");
}

/** 以受測網址的 hostname 當產品 key（檔名安全化）；沒有 URL 時歸到 default。 */
export function productKey(targetUrl?: string): string {
  if (targetUrl) {
    try {
      const host = new URL(targetUrl).hostname;
      if (host) return host.replace(/[^a-zA-Z0-9.-]/g, "_");
    } catch {
      /* 非合法 URL → default */
    }
  }
  return "default";
}

export function knowledgePath(key: string): string {
  return resolve(knowledgeDir(), `${key}.md`);
}

/** 條目正規化：去掉開頭的 `- ` 與結尾的來源標註，供去重比對。 */
function normalizeEntry(line: string): string {
  return line
    .replace(/^-\s*/, "")
    .replace(/（TC-[^）]*）\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 讀出檔內所有知識條目（`- ` 開頭的行，含來源標註）。 */
function readEntries(key: string): string[] {
  const path = knowledgePath(key);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trimStart().startsWith("- "))
    .map((l) => l.trim());
}

/**
 * 取出要注入 prompt 的知識文字。空知識庫回空字串（prompt 端略過該段）。
 * 超過上限只取最新條目，並註明已省略舊條目。
 */
export function loadKnowledge(key: string): string {
  const entries = readEntries(key);
  if (!entries.length) return "";
  if (entries.length <= MAX_INJECT_ENTRIES) return entries.join("\n");
  const recent = entries.slice(-MAX_INJECT_ENTRIES);
  return [`（知識庫共 ${entries.length} 條，僅列最新 ${MAX_INJECT_ENTRIES} 條）`, ...recent].join("\n");
}

/**
 * 把 agent 這次學到的條目寫進知識庫：與既有條目去重（忽略來源標註），
 * 新條目附上來源（TC id、日期）。回傳實際新增數與檔案路徑。
 */
export function appendKnowledge(
  key: string,
  items: string[],
  tcId: string,
): { added: number; path: string } {
  const path = knowledgePath(key);
  const seen = new Set(readEntries(key).map(normalizeEntry));
  const date = new Date().toISOString().slice(0, 10);
  const fresh: string[] = [];
  for (const item of items) {
    const norm = normalizeEntry(item);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    fresh.push(`- ${norm}（${tcId}, ${date}）`);
  }
  if (!fresh.length) return { added: 0, path };

  mkdirSync(knowledgeDir(), { recursive: true });
  let head = "";
  if (!existsSync(path)) {
    head = [
      `# ${key} 產品知識庫`,
      "",
      "<!-- 由 jt-testing-ai-agent 於每次測試後自動累積，執行時注入 agent prompt。 -->",
      "<!-- 每條含來源 TC 與日期；知識是當時的觀察，過期或錯誤的條目請直接刪除。 -->",
      "",
      "",
    ].join("\n");
  }
  const existing = head ? "" : readFileSync(path, "utf8").replace(/\n*$/, "\n");
  writeFileSync(path, head + existing + fresh.join("\n") + "\n", "utf8");
  return { added: fresh.length, path };
}
