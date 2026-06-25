/**
 * Bridge 進入點：HTTP（健康檢查）+ WebSocket hub。
 *
 * 目前實作 Phase 0（連線 / hello / config）與 Phase 1（notion.listTestCases）。
 * Phase 2+ 的 run.start / export 等 handler 先回 "not implemented"，逐步補上。
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  ARTIFACTS_DIR,
  AT_REPO_PATH,
  BRIDGE_PORT,
  describeConfig,
  loadAtEnv,
  saveBridgeConfig,
} from "./config.js";
import type { RunStartPayload, WsEvent, WsRequest, WsResponse } from "./protocol.js";
import { cancelRun, startRun } from "./runner.js";
import { availableAgents, listAgents } from "./agents/index.js";
import { cancelExport, exportToPytest } from "./exporter.js";
import { createCommit, diff, push } from "./git.js";
import { chromeStatus, launchChrome, pickFolder } from "./chrome.js";
import { tabRelay, agentCapture } from "./attach.js";
import type { TestCase } from "./protocol.js";

loadAtEnv();

const clients = new Set<WebSocket>();

function send(ws: WebSocket, msg: WsResponse | WsEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** 廣播事件給所有連線的 extension（agent log / 進度等用）。 */
export function broadcast(event: WsEvent): void {
  for (const ws of clients) send(ws, event);
}

async function handleRequest(req: WsRequest): Promise<WsResponse> {
  const base = { id: req.id, ok: true };
  try {
    switch (req.type) {
      case "hello":
        return { ...base, result: { server: "jt-testing-ai-agent-bridge", v: "0.1.0" } };

      case "config.describe":
        return {
          ...base,
          result: {
            ...describeConfig(),
            agents: listAgents(),
            availableAgents: await availableAgents(),
          },
        };

      case "config.setAtRepo": {
        const { path } = (req.payload as { path?: string }) ?? {};
        if (!path) return { id: req.id, ok: false, error: "缺少 path" };
        const exists = existsSync(path);
        saveBridgeConfig({ AT_REPO_PATH: path });
        return {
          ...base,
          result: {
            saved: true,
            path,
            exists,
            needsRestart: path !== AT_REPO_PATH,
          },
        };
      }

      case "config.pickFolder":
        return { ...base, result: await pickFolder() };

      case "bridge.shutdown":
        // 先回應，再結束整個程序（連同 npm/tsx 父程序）
        console.log("[bridge] shutdown requested by UI");
        setTimeout(() => process.exit(0), 150);
        return { ...base, result: { stopping: true } };

      case "chrome.launch": {
        const { url } = (req.payload as { url?: string }) ?? {};
        return { ...base, result: await launchChrome(url) };
      }

      case "chrome.status":
        return { ...base, result: await chromeStatus() };

      // 註：Notion 讀取已移至 extension 端直接 fetch（參考 chrome-traslate-compare-plugin），bridge 不再經手。
      case "run.start": {
        const payload = req.payload as RunStartPayload;
        if (!payload?.cases?.length)
          return { id: req.id, ok: false, error: "沒有要執行的測試案例" };
        const { runId } = await startRun(payload, broadcast);
        return { ...base, result: { runId } };
      }

      case "run.cancel": {
        const { runId } = (req.payload as { runId?: string }) ?? {};
        return { ...base, result: { cancelled: runId ? cancelRun(runId) : false } };
      }

      case "export.toPytest": {
        const p = req.payload as { cases: TestCase[]; product?: string; agent?: string };
        if (!p?.cases?.length) return { id: req.id, ok: false, error: "沒有要匯出的測試案例" };
        const out = await exportToPytest(p, broadcast);
        return { ...base, result: out };
      }

      case "export.cancel":
        return { ...base, result: { cancelled: cancelExport() } };

      case "git.commit": {
        const p = req.payload as { message: string; files: string[]; branch?: string };
        if (!p?.files?.length) return { id: req.id, ok: false, error: "沒有要提交的檔案" };
        const d = await diff(p.files);
        const commit = await createCommit({
          message: p.message || "test(ai-agent): add generated pytest cases",
          files: p.files,
          branch: p.branch,
        });
        return { ...base, result: { ...commit, diff: d } };
      }

      case "git.push": {
        const { branch } = (req.payload as { branch?: string }) ?? {};
        return { ...base, result: await push(branch) };
      }

      default:
        return { id: req.id, ok: false, error: `unknown type: ${req.type}` };
    }
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8",
  ".webm": "video/webm",
};

/** 把某個產出目錄渲染成可瀏覽的 HTML：gif/jpg/png 內嵌預覽，子目錄與其他檔案則列連結。 */
function renderArtifactIndex(dirFsPath: string, urlPath: string): string {
  const base = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  const entries = readdirSync(dirFsPath, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const isImg = (n: string) => /\.(gif|jpe?g|png)$/i.test(n);
  const items = entries
    .map((e) => {
      const href = base + encodeURIComponent(e.name) + (e.isDirectory() ? "/" : "");
      if (e.isDirectory()) return `<div class="item"><a href="${href}">📁 ${e.name}/</a></div>`;
      if (isImg(e.name))
        return `<figure><img src="${href}" loading="lazy" /><figcaption>${e.name}</figcaption></figure>`;
      return `<div class="item"><a href="${href}">📄 ${e.name}</a></div>`;
    })
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>截圖 / 錄影 — ${urlPath}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e1e;color:#ddd;margin:16px}
  h1{font-size:15px;color:#9cdcfe;font-weight:600}
  .grid{display:flex;flex-wrap:wrap;gap:12px}
  figure{margin:0;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:8px;max-width:320px}
  figure img{max-width:300px;display:block;border-radius:4px}
  figcaption{font-size:12px;color:#aaa;margin-top:6px;word-break:break-all}
  .item{padding:4px 0}a{color:#4fc1ff}
</style>
<h1>${urlPath}</h1><div class="grid">${items || "<p>（此目錄沒有檔案）</p>"}</div>`;
}

const http = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...describeConfig() }));
    return;
  }
  // 產出物（gif / markdown）瀏覽：/artifacts/<runId>/<file>
  if (url.startsWith("/artifacts/")) {
    const rel = normalize(decodeURIComponent(url.slice("/artifacts/".length)));
    if (rel.includes("..")) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const file = join(ARTIFACTS_DIR, rel);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    // 目錄 → 產生可瀏覽的截圖/錄影索引頁（gif/jpg/png 內嵌預覽）
    if (statSync(file).isDirectory()) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderArtifactIndex(file, url));
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "access-control-allow-origin": "*",
    });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

// 兩個 WS endpoint：預設 "/" 給 side panel；"/cdp-relay" 給 extension 的 debugger 橋接
const appWss = new WebSocketServer({ noServer: true });
const relayWss = new WebSocketServer({ noServer: true });

// /agent-cdp：自建 browser-mcp 經此送 raw CDP，bridge 轉給 TabRelay → extension chrome.debugger
const agentCdpWss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/cdp-relay") {
    relayWss.handleUpgrade(req, socket, head, (ws) => relayWss.emit("connection", ws, req));
  } else if (url === "/agent-cdp") {
    agentCdpWss.handleUpgrade(req, socket, head, (ws) => agentCdpWss.emit("connection", ws, req));
  } else {
    appWss.handleUpgrade(req, socket, head, (ws) => appWss.emit("connection", ws, req));
  }
});

relayWss.on("connection", (ws) => {
  console.log("[bridge] cdp-relay connected（extension debugger 橋接）");
  tabRelay.attachSocket(ws);
});

agentCdpWss.on("connection", (ws) => {
  console.log("[bridge] agent-cdp connected（browser-mcp 橋接）");
  ws.on("message", async (data) => {
    let msg: { id?: number; method?: string; params?: unknown; jt?: string; label?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    // 「重點式錄影」擷取訊號（非 CDP 指令）：由進行中的 StepRecorder 處理
    if (msg.jt === "capture") {
      void agentCapture.handler?.(msg.label);
      return;
    }
    if (!msg.method) return;
    const r = await tabRelay.sendCommand(msg.method, msg.params ?? {});
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ id: msg.id, result: r.result, error: r.error }));
  });
});

appWss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[bridge] client connected (${clients.size} total)`);

  ws.on("message", async (data) => {
    let req: WsRequest;
    try {
      req = JSON.parse(data.toString()) as WsRequest;
    } catch {
      send(ws, { type: "error", payload: { error: "invalid JSON" } });
      return;
    }
    const res = await handleRequest(req);
    send(ws, res);
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[bridge] client disconnected (${clients.size} total)`);
  });
});

http.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] listening on http://localhost:${BRIDGE_PORT}`);
  console.table(describeConfig());
});
