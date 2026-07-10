const dotConfig = document.getElementById('dot-config');
const textConfig = document.getElementById('text-config');
const dotBridge = document.getElementById('dot-bridge');
const textBridge = document.getElementById('text-bridge');
const toggleSelect = document.getElementById('toggle-select');
const toggleHover = document.getElementById('toggle-hover');
const toggleClick = document.getElementById('toggle-click');
const toggleImageOcr = document.getElementById('toggle-image-ocr');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// Load initial status
function refreshNotionStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, res => {
    if (!res) return;

    if (res.configured) {
      dotConfig.className = 'status-dot dot-ok';
      textConfig.textContent = 'Notion 已設定';
    } else {
      dotConfig.className = 'status-dot dot-warn';
      textConfig.textContent = '尚未設定 Notion';
    }
  });
}
refreshNotionStatus();

// 圖片辨識 bridge 狀態（背景以 hello 探測 bridge 是否在線）
// 開關預設 disabled（HTML），確認 bridge 在線才開放切換；
// popup 開著期間定時輪詢，bridge 啟動/關閉時燈號與開關即時跟著更新
function checkBridgeStatus() {
  chrome.runtime.sendMessage({ action: 'getBridgeStatus' }, res => {
    if (res?.connected) {
      dotBridge.className = 'status-dot dot-ok';
      textBridge.textContent = '圖片辨識 bridge 已連線';
      toggleImageOcr.disabled = false;
    } else {
      dotBridge.className = 'status-dot dot-warn';
      textBridge.textContent = '圖片辨識 bridge 未連線（需按 bridge 「連線」啟動）';
      toggleImageOcr.disabled = true;
    }
  });
}
checkBridgeStatus();
setInterval(checkBridgeStatus, 4000);

// Toggle modes
chrome.storage.sync.get(['selectMode', 'hoverMode', 'clickMode', 'imageOcrMode'], s => {
  toggleSelect.checked = s.selectMode !== false;
  toggleHover.checked = s.hoverMode === true;
  toggleClick.checked = s.clickMode === true;
  toggleImageOcr.checked = s.imageOcrMode === true;
});
toggleSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ selectMode: toggleSelect.checked });
});
toggleHover.addEventListener('change', () => {
  chrome.storage.sync.set({ hoverMode: toggleHover.checked });
});
toggleClick.addEventListener('change', () => {
  chrome.storage.sync.set({ clickMode: toggleClick.checked });
});
toggleImageOcr.addEventListener('change', () => {
  chrome.storage.sync.set({ imageOcrMode: toggleImageOcr.checked });
});

// Open options
document.getElementById('btn-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Manual search
document.getElementById('btn-search').addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

function doSearch() {
  const text = searchInput.value.trim();
  if (!text) return;

  searchResults.innerHTML = '<div class="searching">查詢中…</div>';

  // loose：手動查詢用寬鬆門檻（短關鍵字也能命中）
  chrome.runtime.sendMessage({ action: 'checkTranslation', text, loose: true }, res => {
    if (!res || res.error) {
      searchResults.innerHTML = `<div class="error">${res?.error === 'NOT_CONFIGURED' ? '請先完成設定' : (res?.error || '查詢失敗')}</div>`;
      return;
    }
    if (!res.results?.length) {
      searchResults.innerHTML = `<div class="no-result">找不到相符項目（共搜尋 ${res.totalEntries} 筆）</div>`;
      return;
    }
    searchResults.innerHTML = res.results.map(r => {
      const icons = { exact_target: '✅', partial_target: '🟡', fuzzy_target: '🟣', template_target: '🧩' };
      const labels = { exact_target: '完全符合', partial_target: '部分符合', fuzzy_target: '相似', template_target: '模板符合' };
      return `
        <div class="result-card">
          <div class="result-header">
            ${icons[r.matchType] || '🔍'} ${labels[r.matchType] || r.matchType}
            <span class="score">${Math.round(r.matchScore * 100)}%</span>
            <a href="${r.url}" target="_blank" class="notion-link">↗</a>
          </div>
          ${Object.entries(r.translations || {})
            .sort(([a], [b]) => (b === r.matchField) - (a === r.matchField))
            .map(([lang, text]) =>
              `<div class="field"><span class="lbl">${esc(lang)}</span><strong>${esc(text)}</strong></div>`
            ).join('')}
        </div>`;
    }).join('');
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(s || ''));
  return d.innerHTML;
}

// ===== Notion Config Section =====

let popupNotionToken   = '';
let popupSelectedTable = null;
let popupSavedTargets  = [];

const popupDbIdInput    = document.getElementById('popup-database-id');
const popupBtnClearDb   = document.getElementById('popup-btn-clear-db');
const popupBtnLoad      = document.getElementById('popup-btn-load');
const popupBtnReread    = document.getElementById('popup-btn-reread');
const popupBtnReset     = document.getElementById('popup-btn-reset');
const popupDbPicker     = document.getElementById('popup-db-picker');
const popupDbPickerList = document.getElementById('popup-db-picker-list');
const popupDiagBox      = document.getElementById('popup-diag-box');
const popupDiagTitle    = document.getElementById('popup-diag-title');
const popupDiagBody     = document.getElementById('popup-diag-body');
const popupFieldEmpty   = document.getElementById('popup-field-mapping-empty');
const popupFieldSelects = document.getElementById('popup-field-mapping-selects');
const popupTargetList   = document.getElementById('popup-target-fields-list');
const popupFieldHint    = document.getElementById('popup-field-hint');
const popupToastEl      = document.getElementById('popup-toast');
const popupTokenWarn    = document.getElementById('popup-token-warn');

chrome.storage.sync.get(
  ['notionToken', 'databaseId', 'tableId', 'tableType', 'targetFields'],
  async s => {
    popupNotionToken  = s.notionToken  || '';
    popupSavedTargets = s.targetFields || [];

    if (!popupNotionToken) popupTokenWarn.style.display = 'block';
    if (s.databaseId) popupDbIdInput.value = s.databaseId;

    if (s.notionToken && s.tableId && s.tableType) {
      popupSelectedTable = { id: s.tableId, type: s.tableType, title: '' };
      setPopupLoaded(true); // 已有設定 → 讀取鎖住、開放重讀/重置（同 AI 測試頁）
      try {
        const cols = await getTableColumns(s.notionToken, s.tableId, s.tableType);
        populatePopupFieldSelects(cols);
      } catch (_) { /* silent */ }
    }
  }
);

// 本頁常駐於 side panel iframe，不會像 popup 每次重新載入；
// 設定頁存 token（或其他設定變動）時由 storage.onChanged 即時帶入，免重開面板
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.notionToken) {
    popupNotionToken = changes.notionToken.newValue || '';
    popupTokenWarn.style.display = popupNotionToken ? 'none' : 'block';
  }
  if (changes.targetFields) popupSavedTargets = changes.targetFields.newValue || [];
  if (changes.notionToken || changes.databaseId || changes.tableId) refreshNotionStatus();
});

// 貼上：把剪貼簿內容填入 Notion URL/ID 輸入框（同 AI 測試頁）
document.getElementById('popup-btn-paste-db').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) { showPopupToast('剪貼簿是空的', 'info'); return; }
    popupDbIdInput.value = text;
    popupDbIdInput.focus();
  } catch (e) {
    showPopupToast(`貼上失敗：${e.message}（可改用 Cmd+V）`, 'error');
  }
});

popupBtnClearDb.addEventListener('click', () => {
  popupDbIdInput.value = '';
  popupDbPicker.style.display = 'none';
  popupDiagBox.style.display  = 'none';
  popupSelectedTable = null;
  resetPopupFieldSelects();
  popupDbIdInput.focus();
});

/** 讀取/重讀/重置 按鈕狀態（同 AI 測試頁：讀取成功後鎖讀取、開放重讀/重置）。 */
function setPopupLoaded(loaded) {
  popupBtnLoad.disabled   = loaded;
  popupBtnReread.disabled = !loaded;
  popupBtnReset.disabled  = !loaded;
}

/** 選定表格 → 讀欄位、預設勾選 → 直接寫入設定並載入資料（免兩段式儲存）。 */
async function applyPopupTable(table, rawId) {
  popupSelectedTable = table;
  const cols = await getTableColumns(popupNotionToken, table.id, table.type);
  populatePopupFieldSelects(cols);
  const targetFields = [...popupTargetList.querySelectorAll('.target-field-cb:checked')].map(cb => cb.value);
  popupSavedTargets = targetFields;
  chrome.storage.sync.set({
    databaseId:  rawId,
    tableId:     table.id,
    tableType:   table.type,
    targetFields
  }, () => {
    chrome.runtime.sendMessage({ action: 'refreshCache' }, res => {
      if (res?.success) showPopupToast(`✅ 已載入${table.title ? `「${esc(table.title)}」` : ''} ${res.totalEntries} 筆`, 'success');
      else showPopupToast(`❌ 載入失敗：${res?.error || '未知錯誤'}`, 'error');
    });
  });
  setPopupLoaded(true);
}

// 讀取：解析 URL/ID → 選定表格後直接生效（原「測試連線」+「儲存」合併為一步）
popupBtnLoad.addEventListener('click', async () => {
  if (!popupNotionToken) {
    showPopupToast('請先在設定頁面填入 Notion Integration Token', 'error');
    return;
  }
  const rawId = extractId(popupDbIdInput.value.trim());
  if (!rawId) { showPopupToast('請填入 Page/Database ID', 'error'); return; }

  popupBtnLoad.disabled    = true;
  popupBtnLoad.textContent = '讀取中…';
  popupDbPicker.style.display = 'none';
  popupDiagBox.style.display  = 'none';
  popupSelectedTable = null;
  resetPopupFieldSelects();

  try {
    const resolved = await resolveNotionId(popupNotionToken, rawId);

    if (resolved.kind === 'direct_database') {
      popupDbIdInput.value = resolved.id;
      await applyPopupTable({ id: resolved.id, type: 'database', title: getTitle(resolved.db.title) }, resolved.id);
    } else if (resolved.tables.length === 1) {
      await applyPopupTable(resolved.tables[0], rawId);
    } else {
      showPopupTablePicker(popupNotionToken, resolved.tables, rawId);
      showPopupToast(`找到 ${resolved.tables.length} 個表格，請選擇`, 'info');
      popupBtnLoad.disabled = false; // 等使用者點選表格
    }
  } catch (e) {
    showPopupDiag(e.message);
    showPopupToast('❌ 讀取失敗', 'error');
    setPopupLoaded(false);
  } finally {
    popupBtnLoad.textContent = '📥 讀取';
  }
});

// 重讀：清除快取、以現有設定重新抓取 Notion 最新內容（原「重新抓取 Notion 更新」）
popupBtnReread.addEventListener('click', () => {
  popupBtnReread.disabled    = true;
  popupBtnReread.textContent = '重讀中…';
  chrome.runtime.sendMessage({ action: 'refreshCache' }, res => {
    popupBtnReread.disabled    = false;
    popupBtnReread.textContent = '🔄 重讀';
    if (res?.success) showPopupToast(`✅ 已重新載入 ${res.totalEntries} 筆`, 'success');
    else showPopupToast(res?.error === 'NOT_CONFIGURED' ? '請先完成設定' : `❌ ${res?.error || '載入失敗'}`, 'error');
  });
});

// 重置：清除表格與欄位設定（保留 Token），回到未設定狀態
popupBtnReset.addEventListener('click', () => {
  chrome.storage.sync.remove(['databaseId', 'tableId', 'tableType', 'targetFields'], () => {
    popupSelectedTable = null;
    popupSavedTargets  = [];
    popupDbIdInput.value = '';
    popupDbPicker.style.display = 'none';
    popupDiagBox.style.display  = 'none';
    resetPopupFieldSelects();
    searchResults.innerHTML = '';
    setPopupLoaded(false);
    // 清空 background 快取（未設定狀態下回應必為錯誤，忽略）
    chrome.runtime.sendMessage({ action: 'refreshCache' }, () => void chrome.runtime.lastError);
    showPopupToast('已重置（Token 保留）', 'info');
  });
});

// 勾選語言欄位即儲存並重載快取（debounce 避免連續勾選重複抓取）
let popupFieldsTimer;
popupTargetList.addEventListener('change', () => {
  if (!popupSelectedTable) return;
  const targetFields = [...popupTargetList.querySelectorAll('.target-field-cb:checked')].map(cb => cb.value);
  if (!targetFields.length) showPopupToast('⚠️ 未勾選任何欄位，將比對全部欄位', 'info');
  popupSavedTargets = targetFields;
  chrome.storage.sync.set({ targetFields });
  clearTimeout(popupFieldsTimer);
  popupFieldsTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'refreshCache' }, res => {
      if (res?.success) showPopupToast(`✅ 已更新語言欄位，載入 ${res.totalEntries} 筆`, 'success');
    });
  }, 800);
});

function populatePopupFieldSelects(columns) {
  if (!columns.length) { showPopupToast('⚠️ 此表格沒有任何欄位', 'error'); return; }

  const defaultChecked = popupSavedTargets.length > 0 ? popupSavedTargets : columns;
  popupTargetList.innerHTML = columns.map(c => {
    const checked = defaultChecked.includes(c) ? 'checked' : '';
    return `<label class="cb-row-sm">
      <input type="checkbox" class="target-field-cb" value="${esc(c)}" ${checked}>
      <span>${esc(c)}</span>
    </label>`;
  }).join('');

  popupFieldEmpty.style.display   = 'none';
  popupFieldSelects.style.display = 'block';
  popupFieldHint.textContent = `共 ${columns.length} 個欄位` +
    (popupSelectedTable ? `（${popupSelectedTable.type === 'simple_table' ? 'Simple Table' : 'Database'}）` : '');
}

function resetPopupFieldSelects() {
  popupTargetList.innerHTML       = '';
  popupFieldEmpty.style.display   = 'flex';
  popupFieldSelects.style.display = 'none';
  popupFieldHint.textContent      = '';
}

function showPopupTablePicker(token, tables, rawId) {
  const icons  = { database: '🗃', simple_table: '📋' };
  const labels = { database: 'Database', simple_table: 'Simple Table' };

  popupDbPickerList.innerHTML = tables.map(t => `
    <button class="picker-btn-sm" data-id="${esc(t.id)}" data-type="${t.type}" data-title="${esc(t.title)}">
      <span>${icons[t.type]}</span>
      <span class="picker-name-sm">${esc(t.title)}</span>
      <em class="picker-tag-sm">${labels[t.type]}</em>
    </button>`
  ).join('');

  popupDbPickerList.querySelectorAll('.picker-btn-sm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, type, title } = btn.dataset;
      popupDbPicker.style.display = 'none';
      try {
        await applyPopupTable({ id, type, title }, rawId);
      } catch (e) {
        showPopupToast(`❌ 無法讀取欄位：${e.message}`, 'error');
      }
    });
  });

  popupDbPicker.style.display = 'block';
}

function showPopupDiag(rawMessage) {
  let title, steps;
  if (rawMessage === 'NO_TABLE_IN_PAGE') {
    title = '⚠️ 頁面中找不到任何表格';
    steps = ['確認貼的是包含翻譯 Table 的頁面 URL'];
  } else if (/Make sure the relevant pages|Could not find/i.test(rawMessage)) {
    title = '❌ Integration 尚未連結此頁面';
    steps = ['在 Notion 開啟目標頁面', '點右上角 ⋯ → 連結（Connections）', '選擇你的 Integration 名稱授予存取權'];
  } else if (/Invalid token|unauthorized/i.test(rawMessage)) {
    title = '❌ Token 無效，請前往設定更新';
    steps = ['點下方「⚙️ 設定」更新 Notion Token'];
  } else {
    title = '❌ 連線失敗';
    steps = [`Notion API 回應：<code>${esc(rawMessage)}</code>`];
  }
  popupDiagTitle.innerHTML   = title;
  popupDiagBody.innerHTML    = '<ol>' + steps.map(s => `<li>${s}</li>`).join('') + '</ol>';
  popupDiagBox.style.display = 'block';
}

function showPopupToast(msg, type = 'info') {
  popupToastEl.className     = `toast-sm toast-sm-${type}`;
  popupToastEl.innerHTML     = msg;
  popupToastEl.style.display = 'block';
  clearTimeout(popupToastEl._timer);
  popupToastEl._timer = setTimeout(() => { popupToastEl.style.display = 'none'; }, 5000);
}

function extractId(value) {
  const m = value.match(/([0-9a-f]{32})/i);
  if (m) return m[1];
  const u = value.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (u) return u[1].replace(/-/g, '');
  return value.replace(/-/g, '');
}

class NotionApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function resolveNotionId(token, id) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${id}`, { headers });
  if (dbRes.ok) {
    const db = await dbRes.json();
    return { kind: 'direct_database', db, id };
  }
  const dbErr = await dbRes.json().catch(() => ({}));
  const blockRes = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, { headers });
  if (!blockRes.ok) {
    const blockErr = await blockRes.json().catch(() => ({}));
    throw new NotionApiError(blockRes.status, blockErr.message || dbErr.message || '');
  }
  const children = await blockRes.json();
  const tables = [];
  let lastHeading = '';
  for (const block of children.results) {
    const hType = ['heading_1', 'heading_2', 'heading_3'].find(t => t === block.type);
    if (hType) {
      lastHeading = (block[hType].rich_text || []).map(t => t.plain_text).join('');
      continue;
    }
    if (block.type === 'child_database') {
      tables.push({ id: block.id.replace(/-/g, ''), type: 'database', title: block.child_database.title || lastHeading || '(未命名 Database)', context: lastHeading });
    } else if (block.type === 'table') {
      tables.push({ id: block.id, type: 'simple_table', title: lastHeading || '(表格)', context: lastHeading });
    }
  }
  if (tables.length === 0) throw new NotionApiError(200, 'NO_TABLE_IN_PAGE');
  return { kind: 'page', tables };
}

async function getTableColumns(token, tableId, tableType) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  if (tableType === 'database') {
    const res = await fetch(`https://api.notion.com/v1/databases/${tableId}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const db = await res.json();
    const VALID = ['title', 'rich_text', 'select', 'multi_select'];
    return Object.entries(db.properties)
      .filter(([, p]) => VALID.includes(p.type))
      .map(([name]) => name);
  } else {
    const res = await fetch(`https://api.notion.com/v1/blocks/${tableId}/children?page_size=1`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const firstRow = json.results[0];
    if (!firstRow || firstRow.type !== 'table_row') throw new Error('無法讀取表格標頭列');
    return firstRow.table_row.cells
      .map(cell => cell.map(t => t.plain_text).join('').trim())
      .filter(h => h);
  }
}

function getTitle(arr) {
  return (arr || []).map(t => t.plain_text).join('') || '(未命名)';
}
