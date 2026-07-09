// Translation cache
let cache = null;
let cacheTimestamp = null;
let resolvedTableId   = null; // actual table/database block ID
let resolvedTableType = null; // 'database' | 'simple_table'
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'checkTranslation') {
    handleCheck(req.text, sendResponse);
    return true;
  }
  if (req.action === 'refreshCache') {
    cache = null;
    cacheTimestamp = null;
    resolvedTableId = null;
    resolvedTableType = null;
    handleRefresh(sendResponse);
    return true;
  }
  if (req.action === 'getStatus') {
    getSettings().then(s => {
      sendResponse({
        configured: !!(s.notionToken && (s.tableId || s.databaseId))
      });
    });
    return true;
  }
  if (req.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return true;
  }
});

/** 清空快取後立即重抓 Notion，回傳筆數讓 popup 顯示回饋。 */
async function handleRefresh(sendResponse) {
  try {
    const settings = await getSettings();
    if (!settings.notionToken || (!settings.tableId && !settings.databaseId)) {
      sendResponse({ error: 'NOT_CONFIGURED' }); return;
    }
    const entries = await getTranslations(settings);
    sendResponse({ success: true, totalEntries: entries.length });
  } catch (err) {
    sendResponse({ error: err.message || 'Unknown error' });
  }
}

async function handleCheck(text, sendResponse) {
  try {
    const settings = await getSettings();
    if (!settings.notionToken || (!settings.tableId && !settings.databaseId)) {
      sendResponse({ error: 'NOT_CONFIGURED' }); return;
    }
    const entries = await getTranslations(settings);
    const results = findMatches(text, entries);
    sendResponse({ success: true, results, totalEntries: entries.length });
  } catch (err) {
    sendResponse({ error: err.message || 'Unknown error' });
  }
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['notionToken', 'databaseId', 'tableId', 'tableType', 'targetFields'],
      resolve
    );
  });
}

async function getTranslations(settings) {
  const now = Date.now();
  if (cache && cacheTimestamp && now - cacheTimestamp < CACHE_TTL) return cache;
  const data = await fetchAllEntries(settings);
  cache = data;
  cacheTimestamp = now;
  return data;
}

async function fetchAllEntries(settings) {
  const { notionToken, tableId, tableType, databaseId: legacyId, targetFields = [] } = settings;

  // Use saved resolved table info if available, otherwise resolve
  if (!resolvedTableId) {
    if (tableId && tableType) {
      resolvedTableId   = tableId;
      resolvedTableType = tableType;
    } else {
      // Legacy: try to resolve from databaseId
      const resolved = await resolveDataSource(notionToken, legacyId);
      resolvedTableId   = resolved.id;
      resolvedTableType = resolved.type;
    }
  }

  if (resolvedTableType === 'simple_table') {
    const pageId = (settings.databaseId || '').replace(/-/g, '');
    return fetchSimpleTableRows(notionToken, resolvedTableId, pageId, targetFields);
  } else {
    return fetchDatabaseRows(notionToken, resolvedTableId, targetFields);
  }
}

// Resolve a page/database ID to actual data source
async function resolveDataSource(token, id) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };

  // Try as database first
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${id}`, { headers });
  if (dbRes.ok) return { type: 'database', id };

  // Try as page - look for child_database or table blocks
  const blockRes = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, { headers });
  if (!blockRes.ok) {
    const err = await blockRes.json().catch(() => ({}));
    throw new Error(err.message || `無法解析 ID: ${id}`);
  }

  const data = await blockRes.json();

  // Prefer child_database, then fall back to first table block
  const dbBlock    = data.results.find(b => b.type === 'child_database');
  if (dbBlock) return { type: 'database', id: dbBlock.id.replace(/-/g, '') };

  const tableBlock = data.results.find(b => b.type === 'table');
  if (tableBlock) return { type: 'simple_table', id: tableBlock.id };

  throw new Error('頁面中找不到資料庫或翻譯 Table，請確認 Integration 已連結此頁面');
}

// ── Simple Table (Notion table block) ──────────────────────────────────────

async function fetchSimpleTableRows(token, tableId, pageId, targetFields) {
  const apiHeaders = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  const entries = [];
  let headers = null;
  let cursor;

  do {
    const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(`https://api.notion.com/v1/blocks/${tableId}/children?${qs}`, { headers: apiHeaders });
    if (!res.ok) {
      resolvedTableId = null;
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = await res.json();
    for (const row of json.results) {
      if (row.type !== 'table_row') continue;
      const cells = row.table_row.cells.map(cell => cell.map(t => t.plain_text).join(''));

      if (!headers) {
        headers = cells.map(h => h.trim());
        continue; // skip header row
      }

      const rowData = {};
      cells.forEach((val, i) => { if (headers[i]) rowData[headers[i]] = val; });

      const fieldsToUse = targetFields.length > 0 ? targetFields : headers.filter(Boolean);

      const translations = {};
      for (const f of fieldsToUse) {
        if (rowData[f]) translations[f] = rowData[f];
      }

      if (Object.keys(translations).length > 0) {
        const url = pageId ? `https://www.notion.so/${pageId}` : '';
        entries.push({ id: row.id, translations, url });
      }
    }
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  return entries;
}

// ── Database (child_database) ───────────────────────────────────────────────

async function fetchDatabaseRows(token, dbId, targetFields) {
  const entries = [];
  let cursor;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      resolvedTableId = null;
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = await res.json();
    for (const page of json.results) {
      const entry = extractDatabaseEntry(page, targetFields);
      if (entry) entries.push(entry);
    }
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  return entries;
}

function extractDatabaseEntry(page, targetFields) {
  const props = page.properties;
  const fieldsToUse = targetFields.length > 0 ? targetFields : Object.keys(props);
  const translations = {};
  for (const f of fieldsToUse) {
    const val = extractPropText(props[f]);
    if (val) translations[f] = val;
  }
  if (Object.keys(translations).length === 0) return null;
  return { id: page.id, translations, url: page.url };
}

function extractPropText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':    return prop.rich_text.map(t => t.plain_text).join('');
    case 'select':       return prop.select?.name || '';
    case 'multi_select': return prop.multi_select.map(s => s.name).join(', ');
    default:             return '';
  }
}

// ── Matching ────────────────────────────────────────────────────────────────

function findMatches(selected, entries) {
  const norm = normalizeText(selected);
  const results = [];

  for (const entry of entries) {
    let best = null;
    for (const [field, text] of Object.entries(entry.translations)) {
      const normText = normalizeText(text);
      if (normText === norm) {
        best = { field, type: 'exact_target', score: 1.0 };
        break;
      }
      const score = partialScore(normText, norm);
      if (score > 0.5 && (!best || score > best.score)) {
        best = { field, type: 'partial_target', score };
      }
      // 模糊比對：非包含關係但用字高度相似（改寫、標點差異、插值變數）
      const fuzzy = diceSimilarity(normText, norm);
      if (fuzzy > 0.55 && (!best || fuzzy > best.score)) {
        best = { field, type: 'fuzzy_target', score: fuzzy };
      }
    }

    if (best) results.push({ ...entry, matchField: best.field, matchType: best.type, matchScore: best.score });
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, 8);
}

/** 字元 bigram 的 Dice 相似度（0~1），中英文皆適用；長度 <2 的字串只比完全相等。 */
function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let overlap = 0;
  for (const [g, c] of ma) {
    if (mb.has(g)) overlap += Math.min(c, mb.get(g));
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function partialScore(a, b) {
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 0;
}

function normalizeText(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
