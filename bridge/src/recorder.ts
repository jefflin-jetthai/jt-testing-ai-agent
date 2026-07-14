/**
 * 錄影：bridge 另開一條 CDP 連線到目標分頁，以 Page.startScreencast 收集 JPEG frames，
 * 單一 TC 執行期間錄一段，結束用 ffmpeg 合成 .gif 或 .mp4（每測項一支，由 UI 勾選）。
 *
 * 準確度設計：擷取端不再用低 fps 節流丟 frame（Chrome 只在重繪時推 frame，閒置期本來就沒
 * frame），每張 frame 記錄真實 timestamp，合成時以 concat demuxer 依真實間隔輸出（VFR），
 * 時間軸與實際操作一致，瞬間出現的 toast / 錯誤訊息不會因節流被丟掉。
 *
 * 與 chrome-devtools-mcp（puppeteer）同時連到同一分頁是允許的（各自 session）。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { CDP_BROWSER_URL } from "./config.js";
import { tabRelay, agentCapture } from "./attach.js";
import { augmentedEnv } from "./agents/env.js";

export type RecordingFormat = "gif" | "mp4";

// 連續錄影（screencast）參數：min interval 限制爆量動畫時的上限（10fps），不是取樣率
const CAPTURE_MIN_INTERVAL_MS = Number(process.env.JT_CAPTURE_MIN_MS ?? 100);
const CAPTURE_MAX_FRAMES = Number(process.env.JT_CAPTURE_MAX_FRAMES ?? 3000);
const CAPTURE_JPEG_QUALITY = Number(process.env.JT_CAPTURE_QUALITY ?? 70);
const CAPTURE_MAX_DIM = Number(process.env.JT_CAPTURE_MAX_DIM ?? 1280);

// 輸出尺寸：gif 需控制檔案大小仍縮圖；mp4 壓縮效率高、保留較大尺寸以利閱讀小字
const GIF_OUT_WIDTH = Number(process.env.JT_GIF_WIDTH ?? 800);
const MP4_OUT_WIDTH = Number(process.env.JT_MP4_WIDTH ?? 1280);

// 「重點式」步驟錄影參數
const STEP_FRAME_MS = Number(process.env.JT_STEP_FRAME_MS ?? 800); // 每步畫面停留時間
const STEP_MAX_FRAMES = Number(process.env.JT_STEP_MAX_FRAMES ?? 400);
const STEP_SETTLE_MS = Number(process.env.JT_STEP_SETTLE_MS ?? 350); // 操作後等畫面穩定再擷取
const STEP_POLL_MS = Number(process.env.JT_STEP_POLL_MS ?? 1000); // 步驟間定期補拍（0=停用）

interface FrameMeta {
  file: string; // frame 檔名（相對 frameDir）
  ts: number; // 擷取時間（epoch ms）
}

/** 產生 ffmpeg concat demuxer 清單：每張 frame 依真實 timestamp 給 duration（VFR）。 */
function writeConcatList(
  frameDir: string,
  frames: FrameMeta[],
  fixedDurationMs?: number,
): string {
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < frames.length; i++) {
    const durMs =
      fixedDurationMs ??
      (i + 1 < frames.length
        ? Math.max(20, frames[i + 1].ts - frames[i].ts)
        : 800); // 最後一張停留 0.8s
    lines.push(`file '${frames[i].file}'`, `duration ${(durMs / 1000).toFixed(3)}`);
  }
  // concat demuxer 慣例：最後一個 file 需重複一次，最後的 duration 才會生效
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
  const listPath = join(frameDir, "frames.ffconcat");
  writeFileSync(listPath, lines.join("\n"), "utf8");
  return listPath;
}

/** 用 ffmpeg 把 frames 依 concat 清單合成 gif 或 mp4。回傳是否成功。 */
function assembleRecording(
  frameDir: string,
  frames: FrameMeta[],
  outPath: string,
  format: RecordingFormat,
  fixedDurationMs?: number,
): Promise<boolean> {
  const listPath = writeConcatList(frameDir, frames, fixedDurationMs);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-vsync", "vfr"];
  if (format === "mp4") {
    // 寬高需為偶數（yuv420p 限制）；faststart 讓瀏覽器可邊下邊播
    args.push(
      "-vf",
      `scale='trunc(min(${MP4_OUT_WIDTH},iw)/2)*2':-2:flags=lanczos`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    );
  } else {
    args.push(
      "-vf",
      `scale='min(${GIF_OUT_WIDTH},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
      "-loop",
      "0",
    );
  }
  args.push(outPath);
  return new Promise((resolve) => {
    // 用補強 PATH（含 /usr/local/bin、/opt/homebrew/bin）以便 native-host 啟動時也找得到 ffmpeg
    const ff = spawn("ffmpeg", args, { env: augmentedEnv() });
    let err = "";
    ff.stderr?.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) => {
      console.error(`[recorder] ffmpeg spawn 失敗：${e.message}`);
      resolve(false);
    });
    ff.on("close", (code) => {
      const size = existsSync(outPath) ? statSync(outPath).size : 0;
      const ok = code === 0 && size > 0;
      if (!ok) console.error(`[recorder] ffmpeg 合成失敗 code=${code}: ${err.slice(-300)}`);
      if (!ok) rmSync(outPath, { force: true });
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
  private frames: FrameMeta[] = [];
  private lastFrameAt = 0;
  private started = false;

  constructor(
    private readonly wsUrl: string,
    private readonly outPath: string,
    workDir: string,
    private readonly format: RecordingFormat = "gif",
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
          quality: CAPTURE_JPEG_QUALITY,
          maxWidth: CAPTURE_MAX_DIM,
          maxHeight: CAPTURE_MAX_DIM,
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
      const now = Date.now();
      if (
        this.frames.length < CAPTURE_MAX_FRAMES &&
        (this.lastFrameAt === 0 || now - this.lastFrameAt >= CAPTURE_MIN_INTERVAL_MS)
      ) {
        this.lastFrameAt = now;
        const file = `frame-${String(this.frames.length + 1).padStart(5, "0")}.jpg`;
        writeFileSync(join(this.frameDir, file), Buffer.from(data, "base64"));
        this.frames.push({ file, ts: now });
      }
      // 必須 ack，否則 Chrome 會停止推送後續 frame
      this.send("Page.screencastFrameAck", { sessionId });
    }
  }

  /** 停止錄影並用 ffmpeg 合成。回傳輸出路徑（無 frame 則 null）。 */
  async stop(): Promise<string | null> {
    if (this.started) {
      this.send("Page.stopScreencast");
      await new Promise((r) => setTimeout(r, 150));
    }
    this.ws?.close();
    this.ws = null;
    if (this.frames.length === 0) return null;

    const ok = await assembleRecording(this.frameDir, this.frames, this.outPath, this.format);
    return ok ? this.outPath : null;
  }
}

/**
 * attach 模式「重點式」錄影：agent 每個關鍵操作（navigate/click/fill/wait_for）後，
 * 經 agentCapture 掛鉤以 Page.captureScreenshot 擷取。
 *
 * 準確度補強：
 * - 每步拍兩張：操作後立即一張（捕捉瞬間狀態，如 toast / loading），穩定後再一張。
 * - 步驟之間每 STEP_POLL_MS 定期補拍，與前一張內容相同則丟棄（不佔空間），
 *   捕捉非同步出現的畫面變化（延遲載入、輪詢更新、晚到的錯誤）。
 * 合成時每張固定停留 STEP_FRAME_MS（重點式瀏覽，非真實時間軸）。
 */
export class StepRecorder {
  private frameDir: string;
  private frames: FrameMeta[] = [];
  private lastData: string | null = null; // 前一張 base64，用於 poll 去重
  private pollTimer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve(); // 序列化擷取，避免漏拍

  constructor(
    private readonly outPath: string,
    workDir: string,
    private readonly format: RecordingFormat = "gif",
  ) {
    this.frameDir = join(workDir, "frames");
  }

  async start(): Promise<void> {
    if (!tabRelay.connected) throw new Error("tabRelay 未連線，無法錄影");
    if (existsSync(this.frameDir)) rmSync(this.frameDir, { recursive: true, force: true });
    mkdirSync(this.frameDir, { recursive: true });
    agentCapture.handler = (label) => this.captureStep(label);
    await this.enqueue(() => this.shoot(false)); // 起始畫面
    if (STEP_POLL_MS > 0) {
      this.pollTimer = setInterval(() => {
        void this.enqueue(() => this.shoot(true));
      }, STEP_POLL_MS);
    }
  }

  /** 關鍵操作後：立即拍一張（瞬間狀態），等畫面穩定再拍一張。 */
  private captureStep(_label?: string): Promise<void> {
    return this.enqueue(async () => {
      await this.shoot(true); // 操作瞬間（與前一張相同會被去重丟棄）
      await new Promise((r) => setTimeout(r, STEP_SETTLE_MS));
      await this.shoot(false); // 穩定後畫面一定保留
    });
  }

  /** 排入一個擷取工作。序列化執行，確保不互相覆蓋、stop 時能等到最後一張。 */
  private enqueue(job: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(job).catch(() => {});
    return this.chain;
  }

  private async shoot(dedupe: boolean): Promise<void> {
    if (this.frames.length >= STEP_MAX_FRAMES) return;
    const r = (await tabRelay.sendCommand("Page.captureScreenshot", {
      format: "jpeg",
      quality: CAPTURE_JPEG_QUALITY,
    })) as { result?: { data?: string }; error?: unknown };
    const data = r?.result?.data;
    if (!data) return;
    if (dedupe && data === this.lastData) return; // 畫面沒變，不佔 frame
    this.lastData = data;
    const file = `frame-${String(this.frames.length + 1).padStart(5, "0")}.jpg`;
    writeFileSync(join(this.frameDir, file), Buffer.from(data, "base64"));
    this.frames.push({ file, ts: Date.now() });
  }

  async stop(): Promise<string | null> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    agentCapture.handler = null;
    await this.chain.catch(() => {}); // 等最後一張拍完
    if (this.frames.length === 0) return null;
    const ok = await assembleRecording(
      this.frameDir,
      this.frames,
      this.outPath,
      this.format,
      STEP_FRAME_MS,
    );
    return ok ? this.outPath : null;
  }
}
