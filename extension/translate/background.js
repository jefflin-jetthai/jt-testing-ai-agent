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
    sendResponse({ success: true });
    return true;
  }
  if (req.action === 'getStatus') {
    getSettings().then(s => {
      sendResponse({
        configured: !!(s.notionToken && (s.tableId || s.databaseId)),
        cacheLoaded: !!cache,
        cacheSize: cache ? cache.length : 0
      });
    });
    return true;
  }
  if (req.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return true;
  }
});

async function handleCheck(text, sendResponse) {
  try {
    const settings = await getSettings();
    if (!settings.notionToken || (!settings.tableId && !settings.databaseId)) {
      sendResponse({ error: 'NOT_CONFIGURED' }); return;
    }
    const entries = await getTranslations(settings);
    const results = findMatches(text, entries, settings);
    sendResponse({ success: true, results, totalEntries: entries.length });
  } catch (err) {
    sendResponse({ error: err.message || 'Unknown error' });
  }
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['notionToken', 'databaseId', 'tableId', 'tableType', 'sourceField', 'targetFields'],
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
  const { notionToken, tableId, tableType, databaseId: legacyId, sourceField = '', targetFields = [] } = settings;

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
    return fetchSimpleTableRows(notionToken, resolvedTableId, pageId, sourceField, targetFields);
  } else {
    return fetchDatabaseRows(notionToken, resolvedTableId, sourceField, targetFields);
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

async function fetchSimpleTableRows(token, tableId, pageId, sourceField, targetFields) {
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

      const source = sourceField ? (rowData[sourceField] || '') : '';
      const fieldsToUse = targetFields.length > 0
        ? targetFields
        : headers.filter(h => h && h !== sourceField);

      const translations = {};
      for (const f of fieldsToUse) {
        if (rowData[f]) translations[f] = rowData[f];
      }

      if (source || Object.keys(translations).length > 0) {
        const url = pageId ? `https://www.notion.so/${pageId}` : '';
        entries.push({ id: row.id, source, translations, url });
      }
    }
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  return entries;
}

// ── Database (child_database) ───────────────────────────────────────────────

async function fetchDatabaseRows(token, dbId, sourceField, targetFields) {
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
      const entry = extractDatabaseEntry(page, sourceField, targetFields);
      if (entry) entries.push(entry);
    }
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  return entries;
}

function extractDatabaseEntry(page, sourceField, targetFields) {
  const props = page.properties;
  const source = (sourceField && extractPropText(props[sourceField])) || extractTitleText(props);
  const fieldsToUse = targetFields.length > 0 ? targetFields : Object.keys(props);
  const translations = {};
  for (const f of fieldsToUse) {
    const val = extractPropText(props[f]);
    if (val) translations[f] = val;
  }
  if (!source && Object.keys(translations).length === 0) return null;
  return { id: page.id, source: source || '', translations, url: page.url };
}

function extractTitleText(props) {
  for (const key of Object.keys(props)) {
    if (props[key].type === 'title') return props[key].title.map(t => t.plain_text).join('');
  }
  return '';
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

function findMatches(selected, entries, settings) {
  const norm = normalizeText(selected);
  const results = [];

  for (const entry of entries) {
    const normSource = normalizeText(entry.source);

    if (normSource === norm) {
      results.push({ ...entry, matchField: settings.sourceField || '原文', matchType: 'exact_source', matchScore: 0.95 });
      continue;
    }

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
    }

    if (!best) {
      const score = partialScore(normSource, norm);
      if (score > 0.5) best = { field: settings.sourceField || '原文', type: 'partial_source', score };
    }

    if (best) results.push({ ...entry, matchField: best.field, matchType: best.type, matchScore: best.score });
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, 8);
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
