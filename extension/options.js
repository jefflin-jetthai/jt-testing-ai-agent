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

/** 開一條暫時性 WS 到 bridge，送一個 request 後關閉。 */
async function callBridgeOnce(type, payload) {
  const url = await getBridgeUrl();
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
  status("請在彈出的視窗選擇資料夾…");
  try {
    const r = await callBridgeOnce("config.pickFolder");
    if (r.canceled) return status("已取消");
    if (r.error) return status(`選取失敗：${r.error}`);
    $("at-repo-path").value = r.path;
    chrome.storage.sync.set({ atRepoPath: r.path }, () =>
      status(`已選並儲存：${r.path}（連線後需停止再連線套用）`, true),
    );
  } catch (e) {
    status(`選取失敗：${e.message}`);
  }
});
