/**
 * Service worker。
 * - 點工具列圖示開啟 side panel。
 * - 「接管當前分頁」(實驗)：chrome.debugger attach 當前分頁，並把 CDP 透過
 *   WebSocket relay 到 bridge 的 /cdp-relay，讓 chrome-devtools-mcp 能驅動此分頁。
 * - 翻譯規格比對（整合自 chrome-traslate-compare-plugin）：訊息用 req.action 區分，
 *   與本檔的 msg.cmd 不衝突，兩組 listener 並存。
 */
import "./translate/background.js";

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open && tab.windowId != null) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {
      /* noop */
    }
  }
});

// ── chrome.debugger ↔ bridge CDP relay ───────────────────────────────
let relay = null; // { tabId, ws }

const PROTOCOL_VERSION = "1.3";

function debuggerEventListener(source, method, params) {
  if (!relay || source.tabId !== relay.tabId) return;
  if (relay.ws?.readyState === WebSocket.OPEN) {
    relay.ws.send(JSON.stringify({ type: "event", method, params }));
  }
}

function debuggerDetachListener(source, reason) {
  if (!relay || source.tabId !== relay.tabId) return;
  // target_closed = 分頁已關 → 真的收掉；其餘（canceled_by_user / replaced_with_devtools）
  // 保留 relay，讓後續指令由 sendCdp 自動重新 attach。
  if (reason === "target_closed") {
    relay.ws?.send?.(JSON.stringify({ type: "detached", reason }));
    teardownRelay();
  } else {
    console.warn(`[jt-agent] debugger detached (reason=${reason})，將於下次指令重新 attach`);
  }
}

function teardownRelay() {
  if (!relay) return;
  try {
    chrome.debugger.onEvent.removeListener(debuggerEventListener);
    chrome.debugger.onDetach.removeListener(debuggerDetachListener);
  } catch {
    /* noop */
  }
  try {
    chrome.debugger.detach({ tabId: relay.tabId });
  } catch {
    /* noop */
  }
  try {
    relay.ws?.close();
  } catch {
    /* noop */
  }
  relay = null;
}

/** 確保 debugger attach 到指定分頁；已 attach 則略過。 */
async function ensureAttached(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (e) {
    // 已經 attach 過 → 視為成功；其餘錯誤往外拋
    if (!/already attached/i.test(e?.message || "")) throw e;
  }
}

/** 送一條 CDP 指令到分頁；偵測到未 attach 會重新 attach 重試一次。 */
async function sendCdp(tabId, method, params) {
  try {
    return await chrome.debugger.sendCommand({ tabId }, method, params || {});
  } catch (e) {
    if (/not attached/i.test(e?.message || "")) {
      await ensureAttached(tabId);
      return await chrome.debugger.sendCommand({ tabId }, method, params || {});
    }
    throw e;
  }
}

async function attachCurrentTab(relayUrl) {
  // 先清掉舊的
  teardownRelay();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("找不到當前分頁");
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url || ""))
    throw new Error(`此分頁不可被偵錯（${tab.url}）。請切到一般網頁再接管。`);

  await ensureAttached(tab.id);

  const ws = new WebSocket(relayUrl);
  relay = { tabId: tab.id, ws };

  await new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", tabId: tab.id, url: tab.url, title: tab.title }));
      resolve();
    };
    ws.onerror = () => reject(new Error("無法連到 bridge /cdp-relay"));
  });

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type !== "command") return;
    const { id, method, params } = msg;
    // 用 promise 形式 + try/catch，避免未處理 rejection（Uncaught in promise）
    sendCdp(relay.tabId, method, params)
      .then((result) => ws.send(JSON.stringify({ type: "result", id, result: result ?? {} })))
      .catch((e) =>
        ws.send(JSON.stringify({ type: "result", id, error: { message: e?.message || String(e) } })),
      );
  };
  ws.onclose = () => {
    if (relay && relay.ws === ws) teardownRelay();
  };

  chrome.debugger.onEvent.addListener(debuggerEventListener);
  chrome.debugger.onDetach.addListener(debuggerDetachListener);

  return { tabId: tab.id, url: tab.url, title: tab.title };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === "attachCurrentTab") {
    attachCurrentTab(msg.relayUrl)
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg?.cmd === "detachTab") {
    teardownRelay();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.cmd === "attachStatus") {
    sendResponse({ attached: !!relay, tabId: relay?.tabId ?? null });
    return false;
  }
});
