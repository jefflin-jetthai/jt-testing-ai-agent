let panel = null;
let selectionTimer = null;
let hoverTimer = null;
let lastText = '';
let lastHoverText = '';
let lastRect = null;
let selectMode = true;
let hoverMode = false;
let clickMode = false;
let imageOcrMode = false;
let captureToken = 0;
let suspended = false; // AI 測試執行中由 side panel 設旗標暫停比對，避免面板干擾操作與錄影

chrome.storage.sync.get(['selectMode', 'hoverMode', 'clickMode', 'imageOcrMode'], s => {
  selectMode = s.selectMode !== false;
  hoverMode = s.hoverMode === true;
  clickMode = s.clickMode === true;
  imageOcrMode = s.imageOcrMode === true;
});
chrome.storage.local.get(['tcSuspended'], s => {
  suspended = s.tcSuspended === true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tcSuspended) {
    suspended = changes.tcSuspended.newValue === true;
    if (suspended) removePanel();
    return;
  }
  if (area !== 'sync') return;
  if (changes.selectMode) selectMode = changes.selectMode.newValue !== false;
  if (changes.hoverMode) {
    hoverMode = changes.hoverMode.newValue === true;
    if (!hoverMode) clearTimeout(hoverTimer);
  }
  if (changes.clickMode) clickMode = changes.clickMode.newValue === true;
  if (changes.imageOcrMode) imageOcrMode = changes.imageOcrMode.newValue === true;
});

document.addEventListener('mouseup', onPointerUp);
document.addEventListener('keyup', onKeyUp);
document.addEventListener('mousedown', onOutsideClick, true);
document.addEventListener('keydown', onKeyDown);
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('click', onImageOcrClick, true);

// 圖片文字辨識模式：點擊圖片 → 經 bridge + Claude 視覺辨識文字 → 走既有比對流程。
// 開啟時攔下圖片上的點擊（preventDefault），避免點 logo/banner 觸發原本的連結跳轉。
function onImageOcrClick(e) {
  if (!imageOcrMode || suspended) return;
  if (panel && panel.contains(e.target)) return;
  const src = findImageSource(e);
  if (!src) return;
  e.preventDefault();
  e.stopPropagation();
  ocrAndCheck(src, e.clientX, e.clientY);
}

/** 從點擊事件找出圖片來源：<img>（含被 overlay 蓋住的）→ CSS background-image。 */
function findImageSource(e) {
  const direct = e.target.closest && e.target.closest('img');
  if (direct && (direct.currentSrc || direct.src)) return direct.currentSrc || direct.src;

  // 輪播/遮罩常把透明層蓋在圖上，e.target 不是 img → 用座標往下找被蓋住的 img
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (el.tagName === 'IMG' && (el.currentSrc || el.src)) return el.currentSrc || el.src;
  }

  // banner 常見做法：div 的 CSS background-image（computed style 回傳絕對網址）
  let node = e.target;
  for (let i = 0; i < 4 && node && node.nodeType === 1; i++) {
    const bg = getComputedStyle(node).backgroundImage || '';
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (m && /^https?:|^data:image\//.test(m[1])) return m[1];
    node = node.parentElement;
  }
  return '';
}

function onPointerUp(e) {
  if (panel && panel.contains(e.target)) return;
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(checkSelection, 300);
}

function onKeyUp(e) {
  if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(checkSelection, 300);
  }
}

function onOutsideClick(e) {
  if (panel && panel.contains(e.target)) return;

  if (clickMode) {
    const text = extractHoverText(e.target);
    if (text && text.length >= 2) {
      showPanel(text, { bottom: e.clientY, left: e.clientX });
      return;
    }
    // 點到的元素本身沒有文字（例如 ⓘ 圖示）→ 等它觸發的提示出現後再截取
    removePanel();
    captureTooltipAfterClick(e.clientX, e.clientY);
    return;
  }
  removePanel();
}

function onKeyDown(e) {
  if (e.key === 'Escape') removePanel();
}

// 懸停比對模式：讀取游標所在元素的 title / aria-label / 文字內容進行比對
const HOVER_DELAY = 450;
const HOVER_TEXT_MAX = 300;
const TOOLTIP_WAIT = 350;

function onMouseMove(e) {
  if (!hoverMode) { clearTimeout(hoverTimer); return; }
  if (panel && panel.contains(e.target)) { clearTimeout(hoverTimer); return; }

  clearTimeout(hoverTimer);
  const target = e.target;
  const x = e.clientX, y = e.clientY;
  hoverTimer = setTimeout(() => checkHover(target, x, y), HOVER_DELAY);
}

function checkHover(el, x, y) {
  if (!el || el.nodeType !== 1) return;
  if (panel && panel.contains(el)) return;

  const text = extractHoverText(el);
  if (!text || text.length < 2 || text === lastHoverText) return;

  showPanel(text, { bottom: y, left: x });
  lastHoverText = text;
}

function extractHoverText(el) {
  // 輸入框的提示文字在 placeholder 屬性、不在 textContent，需另外讀取
  if (el.matches && el.matches('input, textarea')) {
    const ph = !el.value ? (el.placeholder || '').trim() : '';
    if (ph) return ph;
    // 唯讀/停用的輸入框顯示的是固定 UI 文案（非使用者輸入），也納入比對
    if (el.readOnly || el.disabled) {
      const v = (el.value || '').trim().replace(/\s+/g, ' ');
      if (v.length >= 2 && v.length <= HOVER_TEXT_MAX) return v;
    }
  }
  // 圖片文案若有寫在 alt 屬性就拿來比對（像素裡的字需 OCR，不在支援範圍）
  if (el.matches && el.matches('img, area, input[type="image"]')) {
    const alt = (el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ');
    if (alt.length >= 2 && alt.length <= HOVER_TEXT_MAX) return alt;
  }
  let node = el;
  for (let i = 0; i < 4 && node && node !== document.body; i++) {
    const title = node.getAttribute && node.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const aria = node.getAttribute && node.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    node = node.parentElement;
  }
  const tc = (el.textContent || '').trim().replace(/\s+/g, ' ');
  if (tc.length >= 2 && tc.length <= HOVER_TEXT_MAX) return tc;
  return '';
}

// 點擊觸發式提示：點擊後等候提示出現，再從新增/可見的提示元素截取文字
function captureTooltipAfterClick(clickX, clickY) {
  const myToken = ++captureToken;
  const added = [];
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) added.push(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    if (myToken !== captureToken) return;
    const hinted = document.querySelectorAll(
      '[role="tooltip"], [class*="tooltip" i], [class*="popover" i], [class*="popper" i], [class*="tippy" i]'
    );
    const text = pickTooltipText([...added, ...hinted], clickX, clickY);
    if (text) showPanel(text, { bottom: clickY, left: clickX });
  }, TOOLTIP_WAIT);
}

function pickTooltipText(nodes, clickX, clickY) {
  let best = '';
  let bestScore = -Infinity;
  const seen = new Set();

  for (const node of nodes) {
    if (!node || node.nodeType !== 1 || seen.has(node)) continue;
    seen.add(node);
    if (node.id === 'tc-panel' || (panel && panel.contains(node)) || !node.isConnected) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) continue;

    const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length < 2 || text.length > HOVER_TEXT_MAX) continue;

    let score = 0;
    if (node.getAttribute('role') === 'tooltip') score += 500;
    const cls = typeof node.className === 'string' ? node.className.toLowerCase() : '';
    if (/tooltip|popover|popper|tippy/.test(cls)) score += 300;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    score += Math.max(0, 600 - Math.hypot(cx - clickX, cy - clickY));

    if (score > bestScore) { bestScore = score; best = text; }
  }
  return best;
}

function checkSelection() {
  if (!selectMode) return;
  const sel = window.getSelection();
  const text = sel?.toString().trim();

  if (!text || text.length < 2 || text === lastText) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  lastText = text;
  showPanel(text, rect);
}

function showPanel(text, rect) {
  if (suspended) return; // 測試執行中不彈面板（所有比對模式都經過這裡）
  removePanel();
  lastRect = rect;

  panel = document.createElement('div');
  panel.id = 'tc-panel';
  panel.setAttribute('data-tc', '1');
  panel.innerHTML = `
    <div class="tc-header">
      <span class="tc-logo">🔍</span>
      <span class="tc-title">翻譯規格比對</span>
      <button class="tc-close" title="關閉">✕</button>
    </div>
    <div class="tc-selected-row">
      <span class="tc-label">選取文字</span>
      <span class="tc-selected-text">${esc(text)}</span>
    </div>
    <div class="tc-loading">
      <div class="tc-spinner"></div>
      <span>查詢 Notion 中…</span>
    </div>
    <div class="tc-body" style="display:none"></div>
  `;

  panel.querySelector('.tc-close').addEventListener('click', removePanel);
  document.body.appendChild(panel);
  positionPanel(rect);

  chrome.runtime.sendMessage({ action: 'checkTranslation', text }, res => {
    if (chrome.runtime.lastError) {
      renderError('無法連接擴充功能背景服務，請重新載入頁面');
      return;
    }
    renderResults(text, res);
  });
}

/** 點圖辨識：先開「辨識中」面板，OCR 回來後逐行查 Notion、合併結果呈現。 */
function ocrAndCheck(src, x, y) {
  removePanel();
  const rect = { top: y, bottom: y, left: x };
  lastRect = rect;

  panel = document.createElement('div');
  panel.id = 'tc-panel';
  panel.setAttribute('data-tc', '1');
  panel.innerHTML = `
    <div class="tc-header">
      <span class="tc-logo">🖼</span>
      <span class="tc-title">圖片文字比對</span>
      <button class="tc-close" title="關閉">✕</button>
    </div>
    <div class="tc-selected-row" style="display:none">
      <span class="tc-label">圖片文字</span>
      <span class="tc-selected-text"></span>
    </div>
    <div class="tc-loading">
      <div class="tc-spinner"></div>
      <span>辨識圖片文字中…（經 bridge / Claude 視覺，約數秒）</span>
    </div>
    <div class="tc-body" style="display:none"></div>
  `;
  panel.querySelector('.tc-close').addEventListener('click', removePanel);
  document.body.appendChild(panel);
  positionPanel(rect);

  chrome.runtime.sendMessage({ action: 'ocrImage', src }, res => {
    if (!panel) return; // 使用者已關閉
    if (chrome.runtime.lastError) { renderError('無法連接擴充功能背景服務，請重新載入頁面'); return; }
    if (res?.error) { renderError(`圖片辨識失敗：${res.error}`); return; }

    const lines = (res?.text || '').split(/\n+/).map(t => t.trim().replace(/\s+/g, ' '))
      .filter(t => t.length >= 2).slice(0, 8);
    if (!lines.length) { renderError('圖片中未辨識到文字'); return; }

    const row = panel.querySelector('.tc-selected-row');
    row.style.display = '';
    row.querySelector('.tc-selected-text').textContent = lines.join(' / ');

    // 每行各自比對，同一筆規格取最高分，合併排序後呈現
    Promise.all(lines.map(l => new Promise(r =>
      chrome.runtime.sendMessage({ action: 'checkTranslation', text: l }, r)
    ))).then(all => {
      if (!panel) return;
      const err = all.find(m => m?.error);
      const okOnes = all.filter(m => m?.success);
      if (!okOnes.length) {
        renderError(err?.error === 'NOT_CONFIGURED' ? '請先完成 Notion 設定' : (err?.error || '查詢失敗'));
        return;
      }
      const byId = new Map();
      let total = 0;
      for (const m of okOnes) {
        total = m.totalEntries;
        for (const r of m.results || []) {
          const prev = byId.get(r.id);
          if (!prev || r.matchScore > prev.matchScore) byId.set(r.id, r);
        }
      }
      const results = [...byId.values()].sort((a, b) => b.matchScore - a.matchScore).slice(0, 8);
      renderResults(lines.join(' '), { success: true, results, totalEntries: total });
    });
  });
}

function positionPanel(rect) {
  const PANEL_W = 400;
  const GAP = 10;
  const MARGIN = 8;
  const MAX_H = 520;
  const sx = window.scrollX, sy = window.scrollY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left + sx;
  if (left + PANEL_W > sx + vw - 16) left = sx + vw - PANEL_W - 16;
  if (left < sx + 8) left = sx + 8;

  const rectTop = rect.top ?? rect.bottom;
  const spaceBelow = vh - rect.bottom - GAP - MARGIN;
  const spaceAbove = rectTop - GAP - MARGIN;
  const placeBelow = spaceBelow >= spaceAbove;
  const avail = Math.max(placeBelow ? spaceBelow : spaceAbove, 0);

  // Cap height to available viewport space so the panel never overflows; body scrolls.
  panel.style.maxHeight = `${Math.min(MAX_H, avail)}px`;

  const panelH = panel.offsetHeight || 0;

  let top = placeBelow
    ? rect.bottom + sy + GAP
    : rectTop + sy - panelH - GAP;

  // Clamp within the visible viewport.
  const minTop = sy + MARGIN;
  const maxTop = sy + vh - panelH - MARGIN;
  if (top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function renderResults(selected, res) {
  const loading = panel.querySelector('.tc-loading');
  const body = panel.querySelector('.tc-body');
  loading.style.display = 'none';
  body.style.display = 'block';

  if (!res) { body.innerHTML = errorHtml('無法取得回應'); return; }

  if (res.error === 'NOT_CONFIGURED') {
    body.innerHTML = `
      <div class="tc-info">
        <p>尚未設定 Notion API Token 與 Database ID</p>
        <button class="tc-btn-options">前往設定</button>
      </div>`;
    body.querySelector('.tc-btn-options').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openOptions' });
      removePanel();
    });
    return;
  }

  if (res.error) { body.innerHTML = errorHtml(`錯誤：${esc(res.error)}`); return; }

  if (!res.results?.length) {
    body.innerHTML = `
      <div class="tc-no-match">
        <div class="tc-no-match-icon">⚠️</div>
        <p>在 Notion 中找不到相符的翻譯</p>
        <small>已搜尋 ${res.totalEntries} 筆資料</small>
      </div>`;
    return;
  }

  const cards = res.results.map(r => {
    const { cls, label, icon } = matchMeta(r.matchType);
    const pct = Math.round(r.matchScore * 100);
    const isExact = r.matchType.startsWith('exact');

    // Build multi-language translation rows（命中的語言排最上面，免得要捲動找）
    const langRows = Object.entries(r.translations || {})
      .sort(([a], [b]) => (b === r.matchField) - (a === r.matchField))
      .map(([lang, text]) => {
      const isMatchedField = lang === r.matchField;
      const diffHtml = (!isExact && isMatchedField)
        ? `<span class="tc-diff-inline">${diffSpan(selected, text)}</span>`
        : `<span>${esc(text)}</span>`;
      return `
        <div class="tc-field ${isMatchedField ? 'tc-field-matched' : ''}">
          <span class="tc-label">${esc(lang)}</span>
          ${diffHtml}
          ${isMatchedField ? `<span class="tc-match-badge">${icon}</span>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="tc-card ${cls}">
        <div class="tc-card-header">
          <span>${icon}</span>
          <span class="tc-match-label">${esc(r.matchField)} ${label}</span>
          <span class="tc-score">${pct}%</span>
          ${r.url ? `<a class="tc-notion-btn" href="${r.url}" target="_blank" title="在 Notion 中查看">↗</a>` : ''}
        </div>
        <div class="tc-langs">${langRows}</div>
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="tc-summary">找到 ${res.results.length} 個相符項目（共 ${res.totalEntries} 筆）</div>
    ${cards}`;
  if (lastRect) positionPanel(lastRect);
}

function matchMeta(type) {
  switch (type) {
    case 'exact_target':   return { cls: 'tc-exact',   label: '完全符合', icon: '✅' };
    case 'partial_target': return { cls: 'tc-partial', label: '部分符合', icon: '🟡' };
    case 'fuzzy_target':   return { cls: 'tc-fuzzy',   label: '相似',     icon: '🟣' };
    case 'template_target':return { cls: 'tc-exact',   label: '模板符合', icon: '🧩' };
    default:               return { cls: 'tc-partial', label: '部分符合', icon: '🟠' };
  }
}

function diffSpan(a, b) {
  if (a === b) return esc(a);
  const shorter = a.length < b.length ? a : b;
  const longer  = a.length < b.length ? b : a;
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  return esc(longer.slice(0, i)) + `<mark>${esc(longer.slice(i))}</mark>`;
}

function renderError(msg) {
  const loading = panel?.querySelector('.tc-loading');
  const body = panel?.querySelector('.tc-body');
  if (!loading || !body) return;
  loading.style.display = 'none';
  body.style.display = 'block';
  body.innerHTML = errorHtml(msg);
  if (lastRect) positionPanel(lastRect);
}

function errorHtml(msg) {
  return `<div class="tc-error"><span>❌</span> ${esc(msg)}</div>`;
}

function removePanel() {
  if (panel) { panel.remove(); panel = null; lastText = ''; lastRect = null; }
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}
