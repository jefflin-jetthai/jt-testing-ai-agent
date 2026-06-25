/**
 * 「接管當前分頁」(chrome.debugger) 模式的共用狀態：
 * 單一 TabRelay 橋接 extension 的 debugger；attach 模式的 jt-browser MCP
 * 經 bridge /agent-cdp → tabRelay → chrome.debugger 驅動分頁。
 */
import { TabRelay } from "./cdp-proxy.js";

export const tabRelay = new TabRelay();

export function isRelayConnected(): boolean {
  return tabRelay.connected;
}

/**
 * 「重點式錄影」的擷取掛鉤：agent 每完成一個關鍵操作（navigate/click/fill/wait_for）後，
 * browser-mcp 會經 /agent-cdp 送 capture 訊號，server 呼叫此 handler 擷取一張截圖。
 * 由進行中的 StepRecorder 設定 / 清除。
 */
export const agentCapture: {
  handler: ((label?: string) => void | Promise<void>) | null;
} = { handler: null };
