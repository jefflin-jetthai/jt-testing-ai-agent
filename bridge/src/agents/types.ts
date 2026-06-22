/** 可插拔 agent runtime 的介面（claude / codex / antigravity 共用）。 */

export interface AgentEvent {
  kind: "system" | "text" | "tool" | "result" | "stderr";
  text: string;
  raw?: unknown;
}

export interface AgentRunOptions {
  /** 主要任務 prompt（單一 TC 的執行指令）。 */
  prompt: string;
  /** 追加的 system prompt（測試 skill / 規範摘要）。 */
  systemPrompt?: string;
  /** 工作目錄（=AT repo，套用其 CLAUDE.md）。 */
  cwd: string;
  /** MCP 設定檔路徑（含 chrome-devtools）；生成程式碼時可省略。 */
  mcpConfigPath?: string;
  /** 允許的工具（如 mcp__chrome-devtools__*）；省略則沿用 agent 預設工具集。 */
  allowedTools?: string[];
  model?: string;
  signal?: AbortSignal;
  /** 串流事件回呼。 */
  onEvent: (ev: AgentEvent) => void;
}

export interface AgentResult {
  ok: boolean;
  finalText: string;
  raw?: unknown;
}

export interface AgentAdapter {
  readonly name: string;
  /** CLI / 執行檔是否存在可用。 */
  isAvailable(): Promise<boolean>;
  run(opts: AgentRunOptions): Promise<AgentResult>;
}
