/**
 * 錄影：bridge 另開一條 CDP 連線到目標分頁，以 Page.startScreencast 收集 JPEG frames，
 * 單一 TC 執行期間錄一段，結束用 ffmpeg 合成 .gif（每測項一支）。
 *
 * 與 chrome-devtools-mcp（puppeteer）同時連到同一分頁是允許的（各自 session）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { CDP_BROWSER_URL } from "./config.js";
/** 從 /json/list 找出目標分頁的 webSocketDebuggerUrl（優先比對 url，否則取第一個 page）。 */
export async function findPageWsUrl(targetUrl, browserUrl = CDP_BROWSER_URL) {
    try {
        const list = (await fetch(`${browserUrl}/json/list`).then((r) => r.json()));
        const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (!pages.length)
            return null;
        if (targetUrl) {
            const hit = pages.find((p) => p.url === targetUrl || p.url.startsWith(targetUrl));
            if (hit)
                return hit.webSocketDebuggerUrl;
        }
        return pages[0].webSocketDebuggerUrl;
    }
    catch {
        return null;
    }
}
export class ScreencastRecorder {
    wsUrl;
    outGifPath;
    workDir;
    ws = null;
    msgId = 0;
    frameDir;
    frameCount = 0;
    started = false;
    constructor(wsUrl, outGifPath, workDir) {
        this.wsUrl = wsUrl;
        this.outGifPath = outGifPath;
        this.workDir = workDir;
        this.frameDir = join(workDir, "frames");
    }
    send(method, params = {}) {
        this.ws?.send(JSON.stringify({ id: ++this.msgId, method, params }));
    }
    async start() {
        if (existsSync(this.frameDir))
            rmSync(this.frameDir, { recursive: true, force: true });
        mkdirSync(this.frameDir, { recursive: true });
        await new Promise((resolve, reject) => {
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
    onMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
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
    async stop(fps = 4) {
        if (this.started) {
            this.send("Page.stopScreencast");
            await new Promise((r) => setTimeout(r, 150));
        }
        this.ws?.close();
        this.ws = null;
        if (this.frameCount === 0)
            return null;
        const ok = await this.assembleGif(fps);
        return ok ? this.outGifPath : null;
    }
    assembleGif(fps) {
        const input = join(this.frameDir, "frame-%05d.jpg");
        const filter = `fps=${fps},scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
        return new Promise((resolve) => {
            const ff = spawn("ffmpeg", [
                "-y",
                "-framerate",
                String(fps),
                "-i",
                input,
                "-vf",
                filter,
                "-loop",
                "0",
                this.outGifPath,
            ]);
            ff.on("error", () => resolve(false));
            ff.on("close", (code) => resolve(code === 0 && existsSync(this.outGifPath)));
        });
    }
}
//# sourceMappingURL=recorder.js.map