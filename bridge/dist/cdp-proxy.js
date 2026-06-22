/**
 * CDP Proxy（實驗性）——讓 chrome-devtools-mcp(puppeteer) 能驅動
 * 由 extension `chrome.debugger` attach 的「使用者當前分頁」，免另開 Chrome。
 *
 * 原理：puppeteer.connect({browserURL}) 期待一個「瀏覽器層級」CDP 端點，
 * 但 chrome.debugger 只給「分頁層級」CDP。本 proxy 對 puppeteer 模擬一個
 * 只含單一 page target 的瀏覽器：
 *   - 處理 browser 層級指令（Target 域 / Browser 域），合成 targetCreated/attachedToTarget
 *   - 帶 sessionId 的 session 指令 → 轉發給 extension → chrome.debugger.sendCommand
 *   - chrome.debugger 事件 → 包上 sessionId 回送 puppeteer
 *
 * 因 chrome.debugger 不支援 Target 域，session 層級的 Target.* 在本地回空值。
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
const TARGET_ID = "JT-TAB-TARGET";
const SESSION_ID = "JT-TAB-SESSION";
const BROWSER_WS_PATH = "/devtools/browser/jt";
/**
 * 透過 chrome.debugger 會卡住、但對自動化非必要的指令：本地直接回成功。
 * （Page.bringToFront / Target.activateTarget 把分頁帶到前景，自動化不需要。）
 */
const LOCAL_OK_METHODS = new Set([
    "Page.bringToFront",
    "Target.activateTarget",
    "Emulation.setFocusEmulationEnabled",
]);
/** 與 extension 端 chrome.debugger 的橋接通道。 */
export class TabRelay {
    socket = null;
    seq = 0;
    pending = new Map();
    tabId = null;
    url = "";
    title = "";
    /** chrome.debugger 事件回呼（由 CdpProxy 設定，用來轉送給 puppeteer）。 */
    onEvent = null;
    onDetach = null;
    get connected() {
        return !!this.socket && this.socket.readyState === this.socket.OPEN;
    }
    attachSocket(ws) {
        this.socket = ws;
        ws.on("message", (data) => this.handle(data.toString()));
        ws.on("close", () => {
            this.socket = null;
            this.onDetach?.();
        });
    }
    handle(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
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
    sendCommand(method, params) {
        return new Promise((resolve) => {
            if (!this.connected)
                return resolve({ error: { message: "tab relay not connected" } });
            const id = ++this.seq;
            this.pending.set(id, resolve);
            this.socket.send(JSON.stringify({ type: "command", id, method, params }));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    resolve({ error: { message: `cdp command timeout: ${method}` } });
                }
            }, 30000);
        });
    }
}
export class CdpProxy {
    port;
    relay;
    server = null;
    constructor(port, relay) {
        this.port = port;
        this.relay = relay;
    }
    get running() {
        return !!this.server;
    }
    start() {
        if (this.server)
            return;
        const http = createServer((req, res) => {
            const url = req.url ?? "/";
            if (url.startsWith("/json/version")) {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({
                    Browser: "Chrome/JT-Proxy",
                    "Protocol-Version": "1.3",
                    "User-Agent": "JT-Testing-AI-Agent CDP Proxy",
                    "V8-Version": "0.0",
                    "WebKit-Version": "0.0",
                    webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}${BROWSER_WS_PATH}`,
                }));
                return;
            }
            if (url.startsWith("/json")) {
                // puppeteer 通常用 /json/version 即可；/json/list 回單一 page
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify([this.targetInfo(true)]));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const wss = new WebSocketServer({ server: http, path: BROWSER_WS_PATH });
        wss.on("connection", (ws) => this.onPuppeteer(ws));
        http.listen(this.port, "127.0.0.1");
        this.server = http;
    }
    stop() {
        this.server?.close();
        this.server = null;
    }
    targetInfo(attached) {
        return {
            targetId: TARGET_ID,
            type: "page",
            title: this.relay.title || "page",
            url: this.relay.url || "about:blank",
            attached,
            canAccessOpener: false,
            browserContextId: "JT-CONTEXT",
        };
    }
    onPuppeteer(ws) {
        const send = (obj) => {
            if (ws.readyState === ws.OPEN)
                ws.send(JSON.stringify(obj));
        };
        // chrome.debugger 事件 → 包 sessionId 後送給 puppeteer
        this.relay.onEvent = (method, params) => send({ method, params, sessionId: SESSION_ID });
        ws.on("message", async (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            }
            catch {
                return;
            }
            const { id, method, params, sessionId } = msg;
            if (process.env.CDP_PROXY_DEBUG)
                console.error(`[proxy] recv id=${id} method=${method} sid=${sessionId ?? "-"}`);
            // ── session 層級：原則上轉發給分頁；Target.* 與部分「會卡住 chrome.debugger」
            //    的非必要指令在本地回成功（不影響自動化）──
            if (sessionId) {
                if (method?.startsWith("Target.") || LOCAL_OK_METHODS.has(method)) {
                    send({ id, sessionId, result: {} });
                    return;
                }
                const r = await this.relay.sendCommand(method, params ?? {});
                if (r.error)
                    send({ id, sessionId, error: this.toError(r.error) });
                else
                    send({ id, sessionId, result: r.result ?? {} });
                return;
            }
            // ── browser 層級：模擬單一 page target ──
            switch (method) {
                case "Browser.getVersion":
                    send({
                        id,
                        result: {
                            protocolVersion: "1.3",
                            product: "Chrome/JT-Proxy",
                            revision: "",
                            userAgent: "JT-Testing-AI-Agent",
                            jsVersion: "0.0",
                        },
                    });
                    break;
                case "Target.getBrowserContexts":
                    send({ id, result: { browserContextIds: [] } });
                    break;
                case "Target.setDiscoverTargets":
                    send({ id, result: {} });
                    send({ method: "Target.targetCreated", params: { targetInfo: this.targetInfo(false) } });
                    break;
                case "Target.setAutoAttach":
                    send({ id, result: {} });
                    send({
                        method: "Target.attachedToTarget",
                        params: {
                            sessionId: SESSION_ID,
                            targetInfo: this.targetInfo(true),
                            waitingForDebugger: false,
                        },
                    });
                    break;
                case "Target.attachToTarget":
                    send({ id, result: { sessionId: SESSION_ID } });
                    send({
                        method: "Target.attachedToTarget",
                        params: {
                            sessionId: SESSION_ID,
                            targetInfo: this.targetInfo(true),
                            waitingForDebugger: false,
                        },
                    });
                    break;
                case "Target.getTargets":
                    send({ id, result: { targetInfos: [this.targetInfo(true)] } });
                    break;
                case "Target.getTargetInfo":
                    send({ id, result: { targetInfo: this.targetInfo(true) } });
                    break;
                default:
                    // 其餘 browser 指令回空 result，避免卡住握手
                    send({ id, result: {} });
            }
        });
        ws.on("close", () => {
            if (this.relay.onEvent)
                this.relay.onEvent = null;
        });
    }
    toError(error) {
        const message = typeof error === "object" && error && "message" in error
            ? String(error.message)
            : String(error);
        return { code: -32000, message };
    }
}
//# sourceMappingURL=cdp-proxy.js.map