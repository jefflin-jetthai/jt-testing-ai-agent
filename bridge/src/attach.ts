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

/**
 * API 證據掛鉤：agent 用 api_check 工具驗證 API 時，browser-mcp 經 /agent-cdp
 * 送完整 request/response，由進行中的 run 寫入該 TC 的 api-NN.json 並納入報告。
 */
export const apiEvidence: {
  handler: ((evidence: Record<string, unknown>) => void) | null;
} = { handler: null };

/**
 * 步驟標記掛鉤：agent 用 step_note 工具宣告目前測試步驟，
 * 由進行中的 StepRecorder 更新受測頁頂部橫幅（錄影入鏡）並拍一格。
 */
export const stepNote: {
  handler: ((info: { seq?: number; total?: number; title?: string }) => void) | null;
} = { handler: null };
