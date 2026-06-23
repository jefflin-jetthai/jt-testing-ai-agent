/**
 * 錄影：bridge 另開一條 CDP 連線到目標分頁，以 Page.startScreencast 收集 JPEG frames，
 * 單一 TC 執行期間錄一段，結束用 ffmpeg 合成 .gif（每測項一支）。
 *
 * 與 chrome-devtools-mcp（puppeteer）同時連到同一分頁是允許的（各自 session）。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { CDP_BROWSER_URL } from "./config.js";
import { tabRelay } from "./attach.js";
import { augmentedEnv } from "./agents/env.js";

/** 把 frameDir 內的 frame-*.jpg 用 ffmpeg 合成 gif。回傳是否成功。 */
function framesToGif(frameDir: string, outGifPath: string, fps: number): Promise<boolean> {
  const input = join(frameDir, "frame-%05d.jpg");
  const filter = `fps=${fps},scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
  return new Promise((resolve) => {
    // 用補強 PATH（含 /usr/local/bin、/opt/homebrew/bin）以便 native-host 啟動時也找得到 ffmpeg
    const ff = spawn(
      "ffmpeg",
      ["-y", "-framerate", String(fps), "-i", input, "-vf", filter, "-loop", "0", outGifPath],
      { env: augmentedEnv() },
    );
    let err = "";
    ff.stderr?.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) => {
      console.error(`[recorder] ffmpeg spawn 失敗：${e.message}`);
      resolve(false);
    });
    ff.on("close", (code) => {
      const ok = code === 0 && existsSync(outGifPath);
      if (!ok) console.error(`[recorder] ffmpeg 合成失敗 code=${code}: ${err.slice(-300)}`);
      resolve(ok);
    });
  });
}

/** 從 /json/list 找出目標分頁的 webSocketDebuggerUrl（優先比對 url，否則取第一個 page）。 */
export async function findPageWsUrl(
  targetUrl?: string,
  browserUrl: string = CDP_BROWSER_URL,
): Promise<string | null> {
  try {
    const list = (await fetch(`${browserUrl}/json/list`).then((r) => r.json())) as any[];
    const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pages.length) return null;
    if (targetUrl) {
      const hit = pages.find((p) => p.url === targetUrl || p.url.startsWith(targetUrl));
      if (hit) return hit.webSocketDebuggerUrl;
    }
    return pages[0].webSocketDebuggerUrl;
  } catch {
    return null;
  }
}

export class ScreencastRecorder {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private frameDir: string;
  private frameCount = 0;
  private started = false;

  constructor(
    private readonly wsUrl: string,
    private readonly outGifPath: string,
    private readonly workDir: string,
  ) {
    this.frameDir = join(workDir, "frames");
  }

  private send(method: string, params: Record<string, unknown> = {}): void {
    this.ws?.send(JSON.stringify({ id: ++this.msgId, method, params }));
  }

  async start(): Promise<void> {
    if (existsSync(this.frameDir)) rmSync(this.frameDir, { recursive: true, force: true });
    mkdirSync(this.frameDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on("open", () => {
        this.send("Page.enable");
        this.send("Page.startScreencast", {
          format: "jpeg",
          quality: 60,
          maxWidth: 900,
          maxHeight: 900,
          everyNthFrame: 1,
        });
        this.started = true;
        resolve();
      });
      this.ws.on("error", reject);
      this.ws.on("message", (data) => this.onMessage(data.toString()));
    });
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.method === "Page.screencastFrame") {
      const { data, sessionId } = msg.params;
      const idx = String(++this.frameCount).padStart(5, "0");
      writeFileSync(join(this.frameDir, `frame-${idx}.jpg`), Buffer.from(data, "base64"));
      // 必須 ack，否則 Chrome 會停止推送後續 frame
      this.send("Page.screencastFrameAck", { sessionId });
    }
  }

  /** 停止錄影並用 ffmpeg 合成 gif。回傳 gif 路徑（無 frame 則 null）。 */
  async stop(fps = 4): Promise<string | null> {
    if (this.started) {
      this.send("Page.stopScreencast");
      await new Promise((r) => setTimeout(r, 150));
    }
    this.ws?.close();
    this.ws = null;
    if (this.frameCount === 0) return null;

    const ok = await this.assembleGif(fps);
    return ok ? this.outGifPath : null;
  }

  private assembleGif(fps: number): Promise<boolean> {
    return framesToGif(this.frameDir, this.outGifPath, fps);
  }
}

/**
 * attach 模式錄影：透過 extension 的 chrome.debugger（tabRelay）下 Page.startScreencast，
 * 收 Page.screencastFrame 事件存成 jpg，結束以 ffmpeg 合成 gif。
 * （browser-mcp 的操作走 tabRelay 的 request/response，事件通道由本錄影器獨佔，互不干擾。）
 */
export class AttachRecorder {
  private frameDir: string;
  private frameCount = 0;
  private started = false;

  constructor(
    private readonly outGifPath: string,
    private readonly workDir: string,
  ) {
    this.frameDir = join(workDir, "frames");
  }

  async start(): Promise<void> {
    if (!tabRelay.connected) throw new Error("tabRelay 未連線，無法錄影");
    if (existsSync(this.frameDir)) rmSync(this.frameDir, { recursive: true, force: true });
    mkdirSync(this.frameDir, { recursive: true });

    tabRelay.onEvent = (method, params: any) => {
      if (method !== "Page.screencastFrame") return;
      const idx = String(++this.frameCount).padStart(5, "0");
      writeFileSync(join(this.frameDir, `frame-${idx}.jpg`), Buffer.from(params.data, "base64"));
      // 必須 ack，否則 Chrome 停止推送後續 frame
      void tabRelay.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId });
    };

    await tabRelay.sendCommand("Page.enable", {});
    await tabRelay.sendCommand("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 900,
      maxHeight: 900,
      everyNthFrame: 1,
    });
    this.started = true;
  }

  async stop(fps = 4): Promise<string | null> {
    if (this.started) {
      await tabRelay.sendCommand("Page.stopScreencast", {});
      await new Promise((r) => setTimeout(r, 150));
    }
    tabRelay.onEvent = null;
    if (this.frameCount === 0) return null;
    const ok = await framesToGif(this.frameDir, this.outGifPath, fps);
    return ok ? this.outGifPath : null;
  }
}
