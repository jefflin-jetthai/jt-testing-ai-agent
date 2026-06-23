/**
 * TabRelay —— 與 extension 端 `chrome.debugger` 的橋接通道。
 *
 * extension 透過 /cdp-relay 連入，attach 當前分頁；bridge 經此把 CDP 指令
 * 轉發到 chrome.debugger（attach 模式的 jt-browser MCP 即經 /agent-cdp → 這裡驅動分頁）。
 */
import type { WebSocket } from "ws";

export class TabRelay {
  private socket: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, (r: { result?: unknown; error?: unknown }) => void>();
  public tabId: number | null = null;
  public url = "";
  public title = "";
  public onEvent: ((method: string, params: unknown) => void) | null = null;
  public onDetach: (() => void) | null = null;

  get connected(): boolean {
    return !!this.socket && this.socket.readyState === this.socket.OPEN;
  }

  attachSocket(ws: WebSocket): void {
    this.socket = ws;
    ws.on("message", (data) => this.handle(data.toString()));
    ws.on("close", () => {
      this.socket = null;
      this.onDetach?.();
    });
  }

  private handle(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        this.tabId = msg.tabId;
        this.url = msg.url ?? "";
        this.title = msg.title ?? "";
        break;
      case "result": {
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb({ result: msg.result, error: msg.error });
        }
        break;
      }
      case "event":
        this.onEvent?.(msg.method, msg.params);
        break;
      case "detached":
        this.onDetach?.();
        break;
    }
  }

  /** 轉發一條 CDP 指令到 extension 的 chrome.debugger。 */
  sendCommand(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }> {
    return new Promise((resolve) => {
      if (!this.connected) return resolve({ error: { message: "tab relay not connected" } });
      const id = ++this.seq;
      this.pending.set(id, resolve);
      this.socket!.send(JSON.stringify({ type: "command", id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ error: { message: `cdp command timeout: ${method}` } });
        }
      }, 30000);
    });
  }
}
