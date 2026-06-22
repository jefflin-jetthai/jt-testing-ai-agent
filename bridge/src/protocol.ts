/**
 * Extension <-> Bridge 的 WebSocket 訊息協定。
 *
 * 一律 JSON：{ id?, type, payload }
 * - request：extension → bridge，帶 id，期待對應 response
 * - response：bridge → extension，帶相同 id
 * - event：bridge → extension，無 id（單向串流，如 agent log、測試進度）
 */

export type RequestType =
  | "hello"
  | "config.describe"
  | "chrome.launch" // 一鍵啟動測試用 Chrome（remote-debugging + 載入本 extension）
  | "chrome.status"
  | "run.start" // Phase 2：開始接管當前分頁執行（payload 帶 extension 已從 Notion 解析好的 TestCase）
  | "run.cancel"
  | "export.toPytest" // Phase 5
  | "git.commit"
  | "git.push";

export type EventType =
  | "agent.log" // agent 思考 / 工具呼叫的串流
  | "run.step" // 單一 TC 步驟進度
  | "run.result" // 單一 TC 完成（pass/fail + markdown + gif 路徑）
  | "run.done"
  | "error";

/** run.start 的 payload：extension 傳已解析的 TestCase + 目標分頁資訊。 */
export interface RunStartPayload {
  cases: TestCase[];
  agent?: string; // "claude" | "codex" | "gemini"（預設 claude）
  /** "remote"=另開 remote-debugging Chrome（預設、穩定）；"attach"=接管當前分頁(chrome.debugger，實驗) */
  mode?: "remote" | "attach";
  target?: { url?: string; title?: string; tabId?: number };
}

/** agent.log 事件：一段串流文字（含 kind 區分思考/工具/輸出）。 */
export interface AgentLogPayload {
  runId: string;
  tcId?: string;
  kind: "system" | "text" | "tool" | "result" | "stderr";
  text: string;
}

/** run.result 事件：單一 TC 完成。 */
export interface RunResultPayload {
  runId: string;
  tcId: string;
  status: "pass" | "fail" | "error";
  summary: string;
  markdown?: string; // Notion 友善 markdown 全文（供複製 / 寫回）
  markdownPath?: string; // 本地檔路徑
  gifPath?: string; // 本地 gif 路徑
  gifUrl?: string; // 經 bridge HTTP 可瀏覽的 gif URL（UI 預覽用）
  durationMs: number;
}

export interface WsRequest<P = unknown> {
  id: string;
  type: RequestType;
  payload?: P;
}

export interface WsResponse<R = unknown> {
  id: string;
  ok: boolean;
  result?: R;
  error?: string;
}

export interface WsEvent<P = unknown> {
  type: EventType;
  payload: P;
}

/**
 * Notion 測試案例的正規化結構（由 extension 端解析後，隨 run.start 傳給 bridge 當 agent prompt）。
 * 對應 Notion 頁面結構：每個 TC heading 下有 目的 / 前置條件 / 測試步驟 / 確認項目 區段。
 */
export interface TestCase {
  blockId: string; // TC heading 的 Notion block id
  pageId: string; // 所屬 QA 頁面 id（write-back 用）
  tcId: string; // 例如 "TC-01"
  title: string;
  purpose: string;
  preconditions: string[];
  steps: string[];
  expected: string[]; // 確認項目
  aiReportBlockId?: string; // 「AI測試報告結果」heading id（Phase 4 寫回目標）
  meta?: Record<string, string>; // version / ENV / Status 等頁面屬性
}
