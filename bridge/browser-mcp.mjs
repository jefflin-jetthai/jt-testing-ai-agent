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

async function toolClick({ ref, text }) {
  const js =
    ref != null
      ? `(() => { const el = document.querySelector('[data-jt-ref=' + JSON.stringify(String(${JSON.stringify(String(ref))})) + ']'); if(!el) return {ok:false,err:'找不到 ref ${ref}'}; el.scrollIntoView({block:'center'}); el.click(); return {ok:true}; })()`
      : `(() => { const t=${JSON.stringify(text || "")}; const el=[...document.querySelectorAll('a,button,[role=button],input[type=submit]')].find(e => (e.innerText||e.value||'').trim().includes(t)); if(!el) return {ok:false,err:'找不到文字: '+t}; el.scrollIntoView({block:'center'}); el.click(); return {ok:true}; })()`;
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
    def: { description: "在分頁執行任意 JS 運算式並回傳結果（驗證用，如 document.querySelectorAll('x').length）。", inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
    run: (a) => toolEvaluate(a),
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
