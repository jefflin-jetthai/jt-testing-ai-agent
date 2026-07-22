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
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { CDP_BROWSER_URL } from "./config.js";
import { tabRelay, agentCapture, stepNote } from "./attach.js";
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

/**
 * 錄影疊加層注入 JS（idempotent）：
 * 1. 步驟橫幅——受測頁頂部一條窄橫幅，顯示目前 TC／步驟標題；
 * 2. 假滑鼠指標——導頁會清空 DOM，依 sessionStorage 記下的最後座標復原
 *    （指標由 browser-mcp 的點擊/填值操作放置，見 CURSOR_JS）。
 * 導頁後由 recorder 在每次擷取前（attach）或定期（remote）重新確保。
 * 皆 pointer-events:none 不干擾操作。
 */
function overlaysJs(text: string): string {
  return `(() => {
    const t = ${JSON.stringify(text)};
    let el = document.getElementById("__jt_step_banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "__jt_step_banner";
      el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483646;pointer-events:none;" +
        "background:rgba(10,16,26,.82);color:#e8eef6;font:12px/1.2 -apple-system,'Segoe UI',sans-serif;" +
        "padding:6px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;";
      document.documentElement.appendChild(el);
    }
    if (el.textContent !== t) el.textContent = t;

    // 導頁後復原指標（同源 sessionStorage 會保留最後座標）
    if (!document.getElementById("__jt_cursor")) {
      let pos = null;
      try { pos = sessionStorage.getItem("__jt_cursor_pos"); } catch (e) {}
      if (pos) {
        const xy = pos.split(",");
        const c = document.createElement("div");
        c.id = "__jt_cursor";
        c.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;" +
          "left:" + (Number(xy[0]) - 4) + "px;top:" + (Number(xy[1]) - 3) + "px;" +
          "transition:left .18s ease-out,top .18s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));";
        c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24">' +
          '<path d="M4 3 L4 19.5 L8.2 15.3 L10.8 21.2 L13.4 20.1 L10.9 14.4 L16.5 14.4 Z" ' +
          'fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
        document.documentElement.appendChild(c);
      }
    }
    return true;
  })()`;
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

/** 讀 JPEG 標頭取得寬高（SOF 標記）；解析失敗回 null。 */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
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

  // 固定畫布：以第一張 frame 的尺寸（縮到輸出上限）為準，全部 frame 等比縮放後置中
  // letterbox。避免測試中途 set_viewport / DPR 改變造成 frame 尺寸不一，讓編碼失敗
  // 或影片比例被擠壞。
  const maxW = format === "mp4" ? MP4_OUT_WIDTH : GIF_OUT_WIDTH;
  let canvas: { w: number; h: number } | null = null;
  try {
    const first = jpegSize(readFileSync(join(frameDir, frames[0].file)));
    if (first) {
      const s = Math.min(1, maxW / first.w);
      const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
      canvas = { w: even(first.w), h: even(first.h) };
    }
  } catch {
    /* 讀取失敗 → 退回舊有單純縮放 */
  }
  const fit = canvas
    ? `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=${canvas.w}:${canvas.h}:(ow-iw)/2:(oh-ih)/2:color=0x101820`
    : null;

  if (format === "mp4") {
    // 寬高需為偶數（yuv420p 限制）；faststart 讓瀏覽器可邊下邊播
    args.push(
      "-vf",
      fit ?? `scale='trunc(min(${MP4_OUT_WIDTH},iw)/2)*2':-2:flags=lanczos`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    );
  } else {
    const pre = fit ?? `scale='min(${GIF_OUT_WIDTH},iw)':-1:flags=lanczos`;
    args.push("-vf", `${pre},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, "-loop", "0");
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
  private lastBannerAt = 0;
  private started = false;

  constructor(
    private readonly wsUrl: string,
    private readonly outPath: string,
    workDir: string,
    private readonly format: RecordingFormat = "gif",
    private readonly tcLabel = "", // 錄影頂部橫幅顯示的 TC 標題（remote 模式為靜態）
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
      // 定期重新確保步驟橫幅存在（導頁後 DOM 會清空；fire-and-forget，不阻擋 frame 處理）
      if (this.tcLabel && now - this.lastBannerAt > 1500) {
        this.lastBannerAt = now;
        this.send("Runtime.evaluate", { expression: overlaysJs(this.tcLabel), returnByValue: true });
      }
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
  private bannerText: string;

  constructor(
    private readonly outPath: string,
    workDir: string,
    private readonly format: RecordingFormat = "gif",
    // 橫幅前綴（TC 編號＋標題）；step_note 會在其後接上目前步驟
    private readonly tcLabel = "",
  ) {
    this.frameDir = join(workDir, "frames");
    this.bannerText = tcLabel;
  }

  /** 清除裝置模擬（viewport/觸控 override）。TC 前防前次殘留、TC 後還原使用者分頁。 */
  private async resetEmulation(): Promise<void> {
    try {
      await tabRelay.sendCommand("Emulation.clearDeviceMetricsOverride", {});
      await tabRelay.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false });
    } catch {
      /* 重置失敗不阻擋測試 */
    }
  }

  async start(): Promise<void> {
    if (!tabRelay.connected) throw new Error("tabRelay 未連線，無法錄影");
    if (existsSync(this.frameDir)) rmSync(this.frameDir, { recursive: true, force: true });
    mkdirSync(this.frameDir, { recursive: true });
    await this.resetEmulation(); // 防上一個 TC 的 set_viewport 殘留
    agentCapture.handler = (label) => this.captureStep(label);
    // agent 宣告目前步驟 → 更新橫幅並拍一格（步驟起點入鏡）
    stepNote.handler = (info) => {
      const step = [
        info.seq != null ? `步驟 ${info.seq}${info.total ? `/${info.total}` : ""}` : "",
        info.title || "",
      ]
        .filter(Boolean)
        .join("：");
      this.bannerText = [this.tcLabel, step].filter(Boolean).join(" · ");
      void this.enqueue(() => this.shoot(false));
    };
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

  /** 擷取前確保疊加層（步驟橫幅、滑鼠指標）存在（導頁會清掉 DOM）。失敗不影響截圖本身。 */
  private async ensureOverlays(): Promise<void> {
    try {
      await tabRelay.sendCommand("Runtime.evaluate", {
        expression: overlaysJs(this.bannerText),
        returnByValue: true,
      });
    } catch {
      /* 疊加層失敗不阻擋擷取 */
    }
  }

  private async shoot(dedupe: boolean): Promise<void> {
    if (this.frames.length >= STEP_MAX_FRAMES) return;
    await this.ensureOverlays();
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
    stepNote.handler = null;
    await this.chain.catch(() => {}); // 等最後一張拍完
    await this.resetEmulation(); // TC 結束還原 viewport，避免影響使用者與下一個 TC
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
