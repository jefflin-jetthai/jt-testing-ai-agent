/**
 * 自建「瀏覽器工具 MCP」(stdio)，給 attach 模式用。
 *
 * 不依賴 puppeteer/chrome-devtools-mcp。所有操作只用 CDP 的 Runtime.evaluate
 * （已驗證可穩定透過 extension 的 chrome.debugger relay 運作），由 claude 經 stdio 呼叫。
 *
 * 連線：透過 ws → bridge 的 /agent-cdp → TabRelay → extension chrome.debugger → 當前分頁。
 *
 * 啟動方式（由 claude 的 --mcp-config）：
 *   command: "node", args: ["<abs>/bridge/browser-mcp.mjs"], env: { JT_BRIDGE_CDP_URL }
 */
import WebSocket from "ws";

const BRIDGE_CDP_URL = process.env.JT_BRIDGE_CDP_URL || "ws://localhost:8787/agent-cdp";

// ── 連到 bridge 的 raw CDP 通道 ──────────────────────────────────────────────
let ws = null;
let cdpSeq = 0;
const cdpPending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(BRIDGE_CDP_URL);
    ws.on("open", () => resolve());
    ws.on("error", (e) => reject(e));
    ws.on("message", (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      const cb = cdpPending.get(m.id);
      if (cb) { cdpPending.delete(m.id); cb(m); }
    });
    ws.on("close", () => { ws = null; });
  });
}

// 重點式錄影：每個「步驟」後通知 bridge 擷取一張截圖（非 CDP 指令，bridge 端特別處理）。
// 含 evaluate（量測/驗證型測試的關鍵步驟），排除 snapshot（純讀 DOM、呼叫頻繁且畫面無變化）。
const CAPTURE_TOOLS = new Set(["navigate", "click", "fill", "wait_for", "evaluate", "set_viewport"]);
function signalCapture(label) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ jt: "capture", label })); } catch { /* noop */ }
  }
}

// API 證據：把完整 request/response 傳給 bridge 寫入該 run 的產出資料夾（api-NN.json）。
function sendApiEvidence(evidence) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ jt: "apiEvidence", evidence })); } catch { /* noop */ }
  }
}

// 步驟標記：通知 bridge 更新受測頁頂部的步驟橫幅（由 StepRecorder 注入並拍一格入鏡）。
function sendStepNote(info) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ jt: "stepNote", ...info })); } catch { /* noop */ }
  }
}

function cdp(method, params) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return resolve({ error: { message: "bridge CDP 通道未連線" } });
    const id = ++cdpSeq;
    cdpPending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (cdpPending.has(id)) { cdpPending.delete(id); resolve({ error: { message: `CDP timeout: ${method}` } }); }
    }, 15000);
  });
}

/** 在分頁執行 JS（IIFE 字串），回傳序列化後的值。 */
async function evalJs(expression, awaitPromise = false) {
  const r = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (r.error) throw new Error(r.error.message);
  const res = r.result;
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "JS 例外");
  }
  return res?.result?.value;
}

// ── 工具實作（全部基於 Runtime.evaluate）─────────────────────────────────────

const SNAPSHOT_JS = `(() => {
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[onclick]';
  const els = Array.from(document.querySelectorAll(sel));
  const lines = [];
  let n = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    el.setAttribute('data-jt-ref', String(n));
    const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name || '').trim().replace(/\\s+/g,' ').slice(0,60);
    const tag = el.tagName.toLowerCase();
    const t = el.getAttribute('type');
    lines.push('[' + n + '] ' + tag + (t ? '['+t+']' : '') + (label ? ' "'+label+'"' : ''));
    n++;
  }
  return { title: document.title, url: location.href,
    text: (document.body ? document.body.innerText : '').replace(/\\n{2,}/g,'\\n').slice(0,2500),
    elements: lines };
})()`;

async function toolSnapshot() {
  const s = await evalJs(SNAPSHOT_JS);
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    ``,
    `# 互動元素（用 ref 點擊/填值）`,
    ...(s.elements.length ? s.elements : ["(無)"]),
    ``,
    `# 可見文字（節錄）`,
    s.text,
  ].join("\n");
}

async function toolNavigate(url) {
  await evalJs(`(() => { location.href = ${JSON.stringify(url)}; return true; })()`);
  // 等待載入
  await evalJs(
    `new Promise(res => { const done=()=>res(true);
      if (document.readyState==='complete') return done();
      window.addEventListener('load', done, {once:true}); setTimeout(done, 8000); })`,
    true,
  );
  return `已導向 ${url}`;
}

/**
 * 完整滑鼠事件序列（帶元素中心座標的 pointerdown→mousedown→focus→pointerup→mouseup→click）。
 * 只用 el.click() 會缺真實座標與 down/up 事件，Element UI 這類 popper 浮層
 * 的定位（mousedown 觸發）與關閉（click-outside）都不會發生，
 * 造成下拉選單卡在畫面左上角 (0,0) 並殘留——錄影裡看起來像 bug。
 */
const REAL_CLICK_JS = `
  const fire = (el, type, Ctor, x, y, extra) => el.dispatchEvent(new Ctor(type, Object.assign({
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: x, clientY: y, button: 0,
    buttons: type.endsWith('down') ? 1 : 0, detail: 1,
  }, extra || {})));
  const realClick = (el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const PE = window.PointerEvent || MouseEvent;
    const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    fire(el, 'pointerdown', PE, x, y, pointer);
    fire(el, 'mousedown', MouseEvent, x, y);
    try { el.focus(); } catch {}
    fire(el, 'pointerup', PE, x, y, pointer);
    fire(el, 'mouseup', MouseEvent, x, y);
    fire(el, 'click', MouseEvent, x, y);
  };
`;

async function toolClick({ ref, text }) {
  const finder =
    ref != null
      ? `document.querySelector('[data-jt-ref=' + JSON.stringify(String(${JSON.stringify(String(ref))})) + ']')`
      : `[...document.querySelectorAll('a,button,[role=button],input[type=submit]')].find(e => (e.innerText||e.value||'').trim().includes(${JSON.stringify(text || "")}))`;
  const errMsg = ref != null ? `'找不到 ref ${ref}'` : `'找不到文字: ' + ${JSON.stringify(text || "")}`;
  // 可見性防護：分頁/畫面切換後舊 snapshot 的 ref 仍殘留在隱藏 DOM 上，
  // 對隱藏元素派發點擊會讓 Element UI 這類浮層以 0x0 參考元素定位到畫面左上角。
  const js = `(() => { ${REAL_CLICK_JS} const el = ${finder}; if (!el) return {ok:false,err:${errMsg}};
    const r0 = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r0.width === 0 || r0.height === 0 || cs.display === 'none' || cs.visibility === 'hidden')
      return {ok:false,err:'目標元素目前不可見（可能是切換分頁前的舊 snapshot ref）；請先點擊切換到該元素所在的分頁/畫面，再重新 take_snapshot 取得新 ref。不要用 set_viewport 嘗試讓元素出現'};
    realClick(el); return {ok:true}; })()`;
  const r = await evalJs(js);
  if (!r?.ok) throw new Error(r?.err || "點擊失敗");
  return `已點擊 ${ref != null ? "ref " + ref : '"' + text + '"'}`;
}

async function toolFill({ ref, value }) {
  const js = `(() => { const el=document.querySelector('[data-jt-ref=' + JSON.stringify(String(${JSON.stringify(String(ref))})) + ']'); if(!el) return {ok:false,err:'找不到 ref ${ref}'};
    el.focus(); el.value=${JSON.stringify(value ?? "")};
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true}; })()`;
  const r = await evalJs(js);
  if (!r?.ok) throw new Error(r?.err || "填值失敗");
  return `已於 ref ${ref} 填入「${value}」`;
}

async function toolWaitFor({ text, timeoutMs }) {
  const t = JSON.stringify(text || "");
  const ms = Math.min(Number(timeoutMs) || 8000, 20000);
  const ok = await evalJs(
    `new Promise(res => { const t=${t}; const deadline=Date.now()+${ms};
      const check=()=>{ if((document.body?document.body.innerText:'').includes(t)) return res(true);
        if(Date.now()>deadline) return res(false); setTimeout(check,300); }; check(); })`,
    true,
  );
  if (!ok) throw new Error(`等待逾時，頁面未出現文字：${text}`);
  return `已出現文字：${text}`;
}

async function toolEvaluate({ expression }) {
  const v = await evalJs(`(() => { return (${expression}); })()`);
  return typeof v === "string" ? v : JSON.stringify(v);
}

// ── api_check：API 驗證 + 雙證據（錄影入鏡證據卡 + 完整回應 JSON 存檔）──────────
const API_BODY_MAX = 200_000; // 回應本文存檔上限（字元）
let apiSeq = 0; // 每個 TC 一個 MCP 程序，計數自然歸零
let preferredVia = null; // 上次成功的呼叫路徑（page / page-omit / node），同程序內沿用

/** 對回應本文跑 assert（json/status/text 可用）。回傳 {pass, assertError}。 */
function runAssert(assertExpr, text, status) {
  if (!assertExpr) return { pass: null, assertError: null };
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  try {
    return { pass: !!new Function("json", "status", "text", "return (" + assertExpr + ")")(json, status, text), assertError: null };
  } catch (e) {
    return { pass: false, assertError: String((e && e.message) || e) };
  }
}

/** 在頁面 context 打 API（自動帶登入態 cookie），回傳狀態/耗時/本文/斷言結果。 */
async function apiFetchInPage({ url, method, headers, body, assert, credentials = "include" }) {
  const arg = JSON.stringify({ url, method, headers: headers || null, body: body ?? null, assert: assert || null, max: API_BODY_MAX, credentials });
  return evalJs(`(async () => {
    const a = ${arg};
    const t0 = performance.now();
    let resp = null, text = "", err = null;
    try {
      resp = await fetch(a.url, {
        method: a.method,
        credentials: a.credentials,
        headers: a.headers || undefined,
        body: a.body == null ? undefined : (typeof a.body === "string" ? a.body : JSON.stringify(a.body)),
      });
      text = await resp.text();
    } catch (e) { err = String((e && e.message) || e); }
    const durationMs = Math.round(performance.now() - t0);
    let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON 回應 */ }
    let pass = null, assertError = null;
    if (!err && a.assert) {
      try { pass = !!(new Function("json", "status", "text", "return (" + a.assert + ")"))(json, resp.status, text); }
      catch (e) { pass = false; assertError = String((e && e.message) || e); }
    }
    return {
      err, status: resp ? resp.status : 0, finalUrl: resp ? resp.url : a.url,
      durationMs, pass, assertError, pageUrl: location.href,
      truncated: text.length > a.max,
      bodyText: text.length > a.max ? text.slice(0, a.max) : text,
    };
  })()`, true);
}

/**
 * 在 browser-mcp 自身（Node）程序直呼 API：無 CORS 限制，作為頁面 fetch 被擋時的 fallback。
 * 注意：不帶頁面 cookie，只送明示 headers（需要 token 時 agent 必須用 headers 傳）。
 */
async function apiFetchInNode({ url, method, headers, body, assert, baseUrl }) {
  let abs = url;
  try { abs = new URL(url, baseUrl || undefined).toString(); } catch { /* 保持原樣讓 fetch 報錯 */ }
  const t0 = Date.now();
  let resp = null, text = "", err = null;
  try {
    resp = await fetch(abs, {
      method,
      headers: headers || undefined,
      body: body == null ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
    text = await resp.text();
  } catch (e) { err = String((e && e.cause && e.cause.message) || (e && e.message) || e); }
  const durationMs = Date.now() - t0;
  const { pass, assertError } = err ? { pass: null, assertError: null } : runAssert(assert, text, resp.status);
  return {
    err, status: resp ? resp.status : 0, finalUrl: resp ? resp.url : abs,
    durationMs, pass, assertError, pageUrl: baseUrl || "",
    truncated: text.length > API_BODY_MAX,
    bodyText: text.length > API_BODY_MAX ? text.slice(0, API_BODY_MAX) : text,
  };
}

/** headers 存證用遮罩：token/cookie 類只留前 12 字元。 */
function maskHeaders(headers) {
  if (!headers || typeof headers !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k,
      /authorization|token|cookie|secret|key/i.test(k) ? String(v).slice(0, 12) + "…(遮罩)" : v,
    ]),
  );
}

/** 把證據卡疊到受測頁右上角（錄影入鏡用），約 1.8 秒後自動移除。 */
async function showEvidenceCard(card) {
  const arg = JSON.stringify(card);
  await evalJs(`(() => {
    const d = ${arg};
    const old = document.getElementById("__jt_api_evidence"); if (old) old.remove();
    const colors = { PASS: ["#38bdf8", "#14532d", "#86efac"], FAIL: ["#f87171", "#7f1d1d", "#fecaca"], INFO: ["#38bdf8", "#1e3a5f", "#93c5fd"] };
    const [edge, vBg, vFg] = colors[d.verdict] || colors.INFO;
    const el = document.createElement("div");
    el.id = "__jt_api_evidence";
    el.style.cssText = "position:fixed;top:40px;right:14px;width:330px;z-index:2147483647;" + /* top 避開步驟橫幅 */
      "background:rgba(10,16,26,.94);color:#e8eef6;border:1px solid #2d3d52;border-left:3px solid " + edge + ";" +
      "border-radius:8px;padding:12px 14px 10px;font:11.5px/1.55 ui-monospace,Menlo,monospace;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;word-break:break-all;";
    const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="font-weight:700;font-size:11px;letter-spacing:.08em;color:#7dd3fc">API 證據 #' + esc(d.seq) + '</span>' +
        '<span style="margin-left:auto;font-weight:700;font-size:11px;padding:1px 8px;border-radius:4px;background:' + vBg + ';color:' + vFg + '">' + esc(d.verdict) + '</span>' +
      '</div>' +
      '<div><span style="color:#64748b">' + esc(d.method) + '</span> ' + esc(d.url) + '</div>' +
      '<div><span style="color:#64748b">status</span> <b style="color:' + vFg + '">' + esc(d.status) + '</b> · ' + esc(d.durationMs) + 'ms</div>' +
      (d.note ? '<div style="margin-top:7px;padding-top:7px;border-top:1px dashed #2d3d52;color:#cbd5e1">' + esc(d.note) + '</div>' : '') +
      '<div style="margin-top:7px;font-size:10px;color:#64748b;display:flex;justify-content:space-between">' +
        '<span>' + esc(d.file) + '</span><span>' + esc(d.time) + '</span></div>';
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 1800);
    return true;
  })()`);
}

async function toolApiCheck({ url, method, headers, body, check, assert, note }) {
  if (!url) throw new Error("需要 url");
  const m = String(method || "GET").toUpperCase();
  const seq = ++apiSeq;

  // 三段梯（頁面帶 cookie / 頁面 omit / Node 直呼），依情境決定起點：
  // - 帶 Authorization 的請求通常是 token 驗證，cookie 無用且 credentials:include
  //   遇到 ACAO:* 一律被瀏覽器擋 → 直接從 omit 起跳，省掉每次必敗的第一段。
  // - 記住本程序內上次成功的路徑（preferredVia），之後的呼叫直接走通的那條。
  const hasAuth = !!headers && Object.keys(headers).some((k) => /^authorization$/i.test(k));
  const defaultLadder = hasAuth ? ["page-omit", "page", "node"] : ["page", "page-omit", "node"];
  const ladder = preferredVia
    ? [preferredVia, ...defaultLadder.filter((v) => v !== preferredVia)]
    : defaultLadder;

  const attempts = [];
  const viaLabels = { page: "page(cookie)", "page-omit": "page(omit)", node: "node" };
  let via = ladder[0];
  let r = null;
  let pageUrl = "";
  for (const rung of ladder) {
    via = rung;
    r =
      rung === "node"
        ? await apiFetchInNode({ url, method: m, headers, body, assert, baseUrl: pageUrl })
        : await apiFetchInPage({
            url, method: m, headers, body, assert,
            credentials: rung === "page" ? "include" : "omit",
          });
    pageUrl = r.pageUrl || pageUrl;
    if (!r.err) {
      preferredVia = rung; // 下次同程序的呼叫直接走這條
      break;
    }
    attempts.push({ via: viaLabels[rung], error: r.err });
  }
  r = { ...r, pageUrl };

  const verdict = r.err ? "FAIL" : r.pass === null ? "INFO" : r.pass ? "PASS" : "FAIL";
  const file = `api-${String(seq).padStart(2, "0")}.json`;
  const viaLabel = via === "page" ? "" : via === "page-omit" ? "（頁面 fetch 不帶 cookie）" : "（CORS 受阻，改由本機直呼、僅帶明示 headers）";
  const noteText = r.err
    ? `網路錯誤：${r.err}`
    : r.assertError
      ? `assert 執行失敗：${r.assertError}`
      : `${note || check || ""}${viaLabel}`;

  // 1) 完整證據 → bridge 寫檔（api-NN.json）
  sendApiEvidence({
    seq,
    capturedAt: new Date().toISOString(),
    check: check || "",
    via,
    attempts: attempts.length ? attempts : undefined,
    request: { method: m, url, pageUrl: r.pageUrl, headers: maskHeaders(headers), body: body ?? undefined },
    response: { status: r.status, durationMs: r.durationMs, truncated: r.truncated, bodyText: r.bodyText, error: r.err || undefined },
    assert: assert ? { expression: assert, result: verdict, error: r.assertError || undefined, note: note || undefined } : undefined,
  });

  // 2) 證據卡入鏡 + 觸發錄影擷取（卡片顯示約 1.8s，涵蓋擷取時機）
  const shortUrl = (r.finalUrl || url).replace(/^https?:\/\/[^/]*/, "") || url;
  try {
    await showEvidenceCard({
      seq: String(seq).padStart(2, "0"), verdict, method: m, url: shortUrl,
      status: r.status, durationMs: r.durationMs, note: noteText, file,
      time: new Date().toTimeString().slice(0, 8),
    });
    signalCapture("api_check");
  } catch { /* 證據卡失敗不影響驗證本身 */ }

  const excerpt = (r.bodyText || "").slice(0, 4000);
  return [
    `API 證據 #${String(seq).padStart(2, "0")}（${verdict}）已記錄 → ${file}`,
    `${m} ${r.finalUrl || url} → ${r.status} · ${r.durationMs}ms${r.err ? ` · 錯誤：${r.err}` : ""}${via !== "page" ? ` · via=${via}${viaLabel}` : ""}`,
    ...(attempts.length ? [`先前嘗試：${attempts.map((a) => `${a.via} → ${a.error}`).join("；")}`] : []),
    assert ? `assert: ${assert} → ${r.pass}${r.assertError ? `（執行失敗：${r.assertError}）` : ""}` : "(未提供 assert，僅記錄)",
    ``,
    `回應本文（節錄 4000 字）：`,
    excerpt || "(空)",
  ].join("\n");
}

/** 設定 viewport 尺寸（響應式測試用），透過 CDP Emulation.setDeviceMetricsOverride。 */
async function toolSetViewport({ width, height, mobile, reset }) {
  if (reset === true || Number(width) === 0) {
    await cdp("Emulation.clearDeviceMetricsOverride", {});
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    return "已還原預設 viewport（清除裝置模擬）";
  }
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 800);
  if (!w || w < 1) throw new Error("需要有效的 width");
  const isMobile = !!mobile;
  const r = await cdp("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: isMobile ? 2 : 1,
    mobile: isMobile,
  });
  if (r.error) throw new Error(r.error.message);
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: isMobile }); // 行動裝置同步開觸控
  // 等版面依新尺寸重排
  await evalJs(`new Promise(res => requestAnimationFrame(() => setTimeout(() => res(true), 150)))`, true).catch(() => {});
  return `已設定 viewport 為 ${w}x${h}${isMobile ? "（行動裝置模式）" : "（桌機模式）"}`;
}

const TOOLS = {
  snapshot: {
    def: { description: "讀取當前分頁：URL、標題、互動元素清單（含 ref）、可見文字。操作前先用它了解頁面。", inputSchema: { type: "object", properties: {} } },
    run: () => toolSnapshot(),
  },
  navigate: {
    def: { description: "導向指定網址並等待載入。", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    run: (a) => toolNavigate(a.url),
  },
  click: {
    def: { description: "點擊元素：用 snapshot 的 ref（數字）或用 text（元素文字）。", inputSchema: { type: "object", properties: { ref: { type: ["number", "string"] }, text: { type: "string" } } } },
    run: (a) => toolClick(a),
  },
  fill: {
    def: { description: "在輸入框填值：ref + value。", inputSchema: { type: "object", properties: { ref: { type: ["number", "string"] }, value: { type: "string" } }, required: ["ref", "value"] } },
    run: (a) => toolFill(a),
  },
  wait_for: {
    def: { description: "等待頁面出現指定文字（預設 8 秒）。", inputSchema: { type: "object", properties: { text: { type: "string" }, timeoutMs: { type: "number" } }, required: ["text"] } },
    run: (a) => toolWaitFor(a),
  },
  evaluate: {
    def: { description: "在分頁執行任意 JS 運算式並回傳結果（DOM 驗證用，如 document.querySelectorAll('x').length）。API 驗證請改用 api_check（自動留證據）。", inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
    run: (a) => toolEvaluate(a),
  },
  step_note: {
    def: {
      description: "標記目前正在執行的測試步驟：步驟簡短標題會顯示在受測頁頂部橫幅並錄進影片。每開始執行『測試步驟』清單中的一步就先呼叫一次（title 用該步驟的簡短摘要，seq/total 為步驟序號與總數）。",
      inputSchema: {
        type: "object",
        properties: {
          seq: { type: "number", description: "目前步驟序號（1 起算）" },
          total: { type: "number", description: "步驟總數" },
          title: { type: "string", description: "步驟簡短標題" },
        },
        required: ["title"],
      },
    },
    run: (a) => {
      sendStepNote({ seq: a.seq, total: a.total, title: String(a.title || "") });
      return `已標記步驟${a.seq != null ? ` ${a.seq}${a.total ? "/" + a.total : ""}` : ""}：${a.title}`;
    },
  },
  api_check: {
    def: {
      description: "API 驗證專用：在頁面 context 打 API（自動帶登入態），存完整回應為證據檔（api-NN.json）並把結果卡疊進錄影。跨來源被 CORS 擋時自動 fallback：頁面 fetch 不帶 cookie → 本機直呼（無 CORS，但只送明示 headers）。因此需要認證的 API 務必用 headers 傳 Authorization（token 可先用 evaluate 從 localStorage/sessionStorage 取）。assert 為 JS 判斷式，可用變數 json（解析後回應）/ status / text，例：status===200 && json.list.length>0。check 寫這次要驗證什麼（一句話）；note 選填補充（如預期值）。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "API 網址（可相對路徑）" },
          method: { type: "string", description: "預設 GET" },
          headers: { type: "object" },
          body: { description: "請求本文（物件會轉 JSON）" },
          check: { type: "string", description: "這次驗證的目的（一句話）" },
          assert: { type: "string", description: "JS 判斷式（json/status/text 可用）" },
          note: { type: "string", description: "補充說明（如預期 vs 實際）" },
        },
        required: ["url", "check"],
      },
    },
    run: (a) => toolApiCheck(a),
  },
  set_viewport: {
    def: { description: "設定瀏覽器 viewport 尺寸——僅限測試案例明確要求 RWD/響應式驗證時使用，不可用來「讓看不到的元素出現」（那要靠切換分頁＋重新 take_snapshot）。width 必填；height 預設 800；mobile=true 啟用行動裝置模式（觸控 + deviceScaleFactor=2）。RWD 驗證結束後必須用 reset=true 還原，否則後續畫面與錄影尺寸都會異常。", inputSchema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" }, mobile: { type: "boolean" }, reset: { type: "boolean", description: "true=清除裝置模擬還原預設" } }, required: [] } },
    run: (a) => toolSetViewport(a),
  },
};

// ── MCP stdio (JSON-RPC, newline-delimited) ──────────────────────────────────
function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) await handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;

  if (method === "initialize") {
    write({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jt-browser", version: "0.1.0" } } });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "tools/list") {
    write({ jsonrpc: "2.0", id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t.def })) } });
    return;
  }
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (!tool) { write({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `未知工具: ${params?.name}` }] } }); return; }
    try {
      const text = await tool.run(params.arguments || {});
      if (CAPTURE_TOOLS.has(params.name)) signalCapture(params.name); // 關鍵操作後擷取截圖
      write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(text) }] } });
    } catch (e) {
      write({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `錯誤: ${e.message}` }] } });
    }
    return;
  }
  if (id != null) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

// 啟動：先連 bridge CDP 通道再開始服務
connect().catch((e) => {
  process.stderr.write(`[jt-browser-mcp] 連 bridge 失敗: ${e.message}\n`);
});
