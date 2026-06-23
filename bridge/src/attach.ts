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
