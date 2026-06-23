const $ = (id) => document.getElementById(id);

// 顯示版本（讀 manifest）
$("version").textContent = `v${chrome.runtime.getManifest().version}`;
const status = (msg, ok) => {
  $("status").textContent = msg;
  $("status").style.color = ok ? "var(--ok)" : "var(--muted)";
};

chrome.storage.sync.get(
  ["notionToken", "atRepoPath"],
  (s) => {
    $("notion-token").value = s.notionToken || "";
    $("at-repo-path").value = s.atRepoPath || "";
  },
);

$("save").addEventListener("click", () => {
  chrome.storage.sync.set(
    {
      notionToken: $("notion-token").value.trim(),
      atRepoPath: $("at-repo-path").value.trim(),
    },
    () => status("已儲存 ✓（AT 路徑於連線時送給 bridge，需停止再連線套用）", true),
  );
});

/** bridge URL 來源：side panel 連線時存入的值，否則預設 localhost。 */
function getBridgeUrl() {
  return new Promise((r) =>
    chrome.storage.sync.get(["bridgeUrl"], (s) => r(s.bridgeUrl || "ws://localhost:8787")),
  );
}

/** 探測 bridge 是否已在跑（HTTP /health）。 */
async function bridgeHealthy(wsUrl) {
  const httpUrl = wsUrl.replace(/^ws/, "http").replace(/\/+$/, "") + "/health";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(httpUrl, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** 透過 Native Messaging host 自動啟動 bridge。 */
function launchBridgeViaNative() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative("com.jt_testing.bridge_launcher");
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { port.disconnect(); } catch { /* noop */ }
      resolve(r);
    };
    port.onMessage.addListener((msg) => finish(msg || { ok: true }));
    port.onDisconnect.addListener(() =>
      finish({ ok: false, error: chrome.runtime.lastError?.message || "native host 未安裝" }),
    );
    setTimeout(() => finish({ ok: false, error: "native host 逾時" }), 25000);
  });
}

/** 確保 bridge 在跑（沒跑就自動啟動）。 */
async function ensureBridge(url) {
  if (await bridgeHealthy(url)) return true;
  const r = await launchBridgeViaNative();
  return !!r.ok;
}

/** 開一條暫時性 WS 到 bridge，送一個 request 後關閉。 */
async function callBridgeOnce(type, payload) {
  const url = await getBridgeUrl();
  if (!(await ensureBridge(url))) {
    throw new Error("bridge 未啟動且無法自動啟動（請先裝 native host，或在 side panel 按連線）");
  }
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(new Error(e.message));
    }
    const id = "o" + Math.random();
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("bridge 未回應（是否已連線/啟動？）"));
    }, 60000);
    ws.onopen = () => ws.send(JSON.stringify({ id, type, payload }));
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("無法連到 bridge，請先在 side panel 按「連線」啟動 bridge"));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      m.ok ? resolve(m.result) : reject(new Error(m.error || "request failed"));
    };
  });
}

$("pick-at-repo").addEventListener("click", async () => {
  try {
    const r = await callBridgeOnce("config.pickFolder");
    if (r.canceled || r.error || !r.path) return;
    $("at-repo-path").value = r.path;
    chrome.storage.sync.set({ atRepoPath: r.path });
  } catch {
    /* 選取流程不顯示儲存鈕旁訊息 */
  }
});
