/**
 * Bridge 進入點：HTTP（健康檢查）+ WebSocket hub。
 *
 * 目前實作 Phase 0（連線 / hello / config）與 Phase 1（notion.listTestCases）。
 * Phase 2+ 的 run.start / export 等 handler 先回 "not implemented"，逐步補上。
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { unzipSync } from "fflate";
import { WebSocketServer, type WebSocket } from "ws";
import {
  artifactsDir,
  atRepoConfigured,
  atRepoPath,
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
import { tabRelay, agentCapture, apiEvidence, stepNote, viewportGate } from "./attach.js";
import { ocrImage } from "./ocr.js";
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

/** 取目前 bundle 路徑（打包版）；非打包版回空字串。 */
function bundlePath(): string {
  const p = process.env.JT_BRIDGE_SCRIPT || process.argv[1] || "";
  return /\.(c?js)$/.test(p) ? p : "";
}

const FIXED_EXT_ID = "gbodpgijbhekommdppfcgebacbpmedcj";

/** 各平台 Chrome/Chromium/Edge 的 user-data 根目錄（其下含各 profile）。 */
function chromeUserDataDirs(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(local, "Google", "Chrome", "User Data"),
      join(local, "Google", "Chrome Beta", "User Data"),
      join(local, "Chromium", "User Data"),
      join(local, "Microsoft", "Edge", "User Data"),
    ];
  }
  if (process.platform === "darwin") {
    const as = join(home, "Library", "Application Support");
    return [
      join(as, "Google", "Chrome"),
      join(as, "Google", "Chrome Beta"),
      join(as, "Chromium"),
      join(as, "Microsoft Edge"),
    ];
  }
  const cfg = process.env.XDG_CONFIG_HOME ?? join(home, ".config"); // linux
  return [
    join(cfg, "google-chrome"),
    join(cfg, "google-chrome-beta"),
    join(cfg, "chromium"),
    join(cfg, "microsoft-edge"),
  ];
}

/** 從 Chrome/Chromium/Edge 各 profile 的 Preferences 找「載入未封裝」本擴充的絕對路徑（跨平台）。 */
function findExtensionFromChrome(): string {
  for (const baseDir of chromeUserDataDirs()) {
    if (!existsSync(baseDir)) continue;
    let profiles: string[];
    try {
      profiles = readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const prof of profiles) {
      // 未封裝擴充的設定多半在 "Secure Preferences"，少數在 "Preferences"
      for (const fname of ["Secure Preferences", "Preferences"]) {
        const pref = join(baseDir, prof, fname);
        if (!existsSync(pref)) continue;
        try {
          const j = JSON.parse(readFileSync(pref, "utf8"));
          const p = j?.extensions?.settings?.[FIXED_EXT_ID]?.path;
          // 未封裝擴充的 path 是絕對路徑（使用者選的資料夾）；商店版才是相對
          if (typeof p === "string" && isAbsolute(p) && existsSync(join(p, "manifest.json"))) return p;
        } catch {
          /* skip */
        }
      }
    }
  }
  return "";
}

/**
 * 取本擴充的 extension 資料夾路徑：優先用 Install.command 記下的 extension-dir.txt，
 * 否則自動從 Chrome Preferences 找（免依賴 Install.command）。
 */
function extensionDir(): string {
  try {
    const f = join(dirname(bundlePath()), "extension-dir.txt");
    if (existsSync(f)) {
      const dir = readFileSync(f, "utf8").trim();
      if (dir && existsSync(join(dir, "manifest.json"))) return dir;
    }
  } catch {
    /* ignore */
  }
  return findExtensionFromChrome();
}

/**
 * 一鍵自我更新：下載新 bundle.cjs 覆蓋自身；若知道 extension 路徑且有 zipUrl，
 * 一併解壓 zip 內的 extension/ 覆蓋該資料夾（之後由擴充 chrome.runtime.reload 套用）。
 * 僅打包版可用；bundle 會先備份 .bak。
 */
async function selfUpdate(
  bundleUrl?: string,
  zipUrl?: string,
): Promise<
  { ok: true; extensionUpdated: boolean } | { ok: false; error: string }
> {
  const target = bundlePath();
  if (!target) return { ok: false, error: "開發模式不支援自我更新（請用 git pull / 重新打包）" };
  if (!bundleUrl || !/^https:\/\//i.test(bundleUrl)) {
    return { ok: false, error: "無效的更新來源（需 https 網址）" };
  }
  try {
    // 1) 更新 bundle.cjs
    const resp = await fetch(bundleUrl);
    if (!resp.ok) return { ok: false, error: `下載 bundle 失敗 HTTP ${resp.status}` };
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1000) return { ok: false, error: "bundle 內容異常（過小）" };
    if (existsSync(target)) copyFileSync(target, target + ".bak");
    writeFileSync(target, buf);
    console.log(`[bridge] self-updated bundle (${buf.length} bytes)`);

    // 2) 若知道 extension 路徑 + 有 zip，解壓覆蓋 extension/
    let extensionUpdated = false;
    const extDir = extensionDir();
    if (extDir && zipUrl && /^https:\/\//i.test(zipUrl)) {
      const zr = await fetch(zipUrl);
      if (zr.ok) {
        const files = unzipSync(new Uint8Array(await zr.arrayBuffer()));
        let n = 0;
        for (const [name, data] of Object.entries(files)) {
          // 取 zip 內 ".../extension/<rel>" 的檔，寫到 extDir/<rel>
          const m = name.match(/(?:^|\/)extension\/(.+)$/);
          if (!m || name.endsWith("/")) continue;
          const dest = join(extDir, m[1]);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, Buffer.from(data));
          n++;
        }
        extensionUpdated = n > 0;
        console.log(`[bridge] self-updated extension: ${n} files → ${extDir}`);
      }
    }
    return { ok: true, extensionUpdated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
        const raw = (req.payload as { path?: string })?.path;
        const path = (raw ?? "").trim(); // 允許空字串＝清除設定（AT repo 為選填）
        const exists = path ? existsSync(path) : false;
        saveBridgeConfig({ AT_REPO_PATH: path });
        // 動態讀取：存檔後即時生效；只有環境變數覆寫時才需重啟
        return {
          ...base,
          result: {
            saved: true,
            path,
            exists,
            configured: atRepoConfigured(),
            needsRestart: path !== atRepoPath(),
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

      case "bridge.selfUpdate": {
        // 下載新 bundle.cjs（＋可選 extension）覆蓋自身，再結束 → native host 下次連線啟動新 bundle
        const { bundleUrl, zipUrl } = (req.payload as { bundleUrl?: string; zipUrl?: string }) ?? {};
        const out = await selfUpdate(bundleUrl, zipUrl);
        if (out.ok) setTimeout(() => process.exit(0), 300); // 退出讓 native host 以新 bundle 重啟
        return out.ok
          ? { ...base, result: { updated: true, restarting: true, extensionUpdated: out.extensionUpdated } }
          : { id: req.id, ok: false, error: out.error };
      }

      case "chrome.launch": {
        const { url } = (req.payload as { url?: string }) ?? {};
        return { ...base, result: await launchChrome(url) };
      }

      case "chrome.status":
        return { ...base, result: await chromeStatus() };

      case "ocr.image": {
        // 翻譯比對：辨識圖片中的文字（claude CLI 視覺）
        const { dataUrl } = (req.payload as { dataUrl?: string }) ?? {};
        return { ...base, result: await ocrImage(dataUrl ?? "") };
      }

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
        const p = req.payload as { cases: TestCase[]; product?: string; agent?: string; model?: string };
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
  ".mp4": "video/mp4",
  // 證據檔與 curl 腳本：用純文字讓 RD 直接在瀏覽器點開看，不必先下載
  ".json": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
};

/** 把某個產出目錄渲染成可瀏覽的 HTML：gif/jpg/png 內嵌預覽，子目錄與其他檔案則列連結。 */
function renderArtifactIndex(dirFsPath: string, urlPath: string): string {
  const base = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  const entries = readdirSync(dirFsPath, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const isImg = (n: string) => /\.(gif|jpe?g|png)$/i.test(n);
  const isVid = (n: string) => /\.(mp4|webm)$/i.test(n);
  const items = entries
    .map((e) => {
      const href = base + encodeURIComponent(e.name) + (e.isDirectory() ? "/" : "");
      if (e.isDirectory()) return `<div class="item"><a href="${href}">📁 ${e.name}/</a></div>`;
      if (isImg(e.name))
        return `<figure><img src="${href}" loading="lazy" /><figcaption>${e.name}</figcaption></figure>`;
      if (isVid(e.name))
        return `<figure><video src="${href}" controls preload="metadata"></video><figcaption>${e.name}</figcaption></figure>`;
      return `<div class="item"><a href="${href}">📄 ${e.name}</a></div>`;
    })
    .join("\n");
  const hasImg = entries.some((e) => e.isDirectory() || isImg(e.name) || isVid(e.name));
  const clearUrl = base.replace("/artifacts/", "/artifacts-clear/");
  const openUrl = base.replace("/artifacts/", "/artifacts-open/");
  return `<!doctype html><meta charset="utf-8"><title>截圖 / 錄影 — ${urlPath}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e1e;color:#ddd;margin:16px}
  h1{font-size:15px;color:#9cdcfe;font-weight:600;display:inline-block;margin-right:12px}
  .grid{display:flex;flex-wrap:wrap;gap:12px}
  figure{margin:0;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:8px;max-width:320px}
  figure img,figure video{max-width:300px;display:block;border-radius:4px}
  figcaption{font-size:12px;color:#aaa;margin-top:6px;word-break:break-all}
  .item{padding:4px 0}a{color:#4fc1ff}
  button{color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:13px;margin-right:6px}
  button:disabled{background:#3a3a3a;color:#888;cursor:not-allowed}
  #opn{background:#3a6ea5}#clr{background:#6e4949}
</style>
<h1>${urlPath}</h1><button id="opn" onclick="openDir()">📂 開啟資料夾</button>${hasImg ? `<button id="clr" onclick="clearImgs()">🗑 清除圖片</button>` : ""}
<div class="grid">${items || "<p>（此目錄沒有檔案）</p>"}</div>
<script>
async function openDir(){
  const b=document.getElementById('opn');
  try{
    const r=await fetch(${JSON.stringify(openUrl)});
    const j=await r.json();
    if(!j.ok) alert('開啟失敗：'+(j.error||''));
  }catch(e){ alert('開啟失敗：'+e.message); }
}
async function clearImgs(){
  if(!confirm('確定清除此次測試的所有截圖 / 錄影？（報告 .md 會保留，無法復原）')) return;
  const b=document.getElementById('clr'); b.disabled=true; b.textContent='清除中…';
  try{
    const r=await fetch(${JSON.stringify(clearUrl)},{method:'DELETE'});
    const j=await r.json();
    if(j.ok){ b.textContent='已清除 '+j.removed+' 項'; setTimeout(()=>location.reload(),600); }
    else{ b.disabled=false; b.textContent='🗑 清除圖片'; alert('清除失敗：'+(j.error||'')); }
  }catch(e){ b.disabled=false; b.textContent='🗑 清除圖片'; alert('清除失敗：'+e.message); }
}
</script>`;
}

const http = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...describeConfig() }));
    return;
  }
  // 清除某次產出的圖片/錄影：DELETE /artifacts-clear/<runId>（保留 .md 報告）
  if (url.startsWith("/artifacts-clear/")) {
    const rel = normalize(decodeURIComponent(url.slice("/artifacts-clear/".length))).replace(/\/+$/, "");
    if (!rel || rel.includes("..")) {
      res.writeHead(403);
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return;
    }
    const dir = join(artifactsDir(), rel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    let removed = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        rmSync(p, { recursive: true, force: true }); // frame 暫存資料夾
        removed++;
      } else if (/\.(gif|jpe?g|png|webm|mp4)$/i.test(e.name)) {
        rmSync(p, { force: true }); // 圖片 / 錄影
        removed++;
      }
    }
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, removed }));
    return;
  }
  // 在系統檔案管理員開啟某次產出資料夾：GET /artifacts-open/<runId>
  if (url.startsWith("/artifacts-open/")) {
    const rel = normalize(decodeURIComponent(url.slice("/artifacts-open/".length))).replace(/\/+$/, "");
    if (!rel || rel.includes("..")) {
      res.writeHead(403);
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return;
    }
    const dir = join(artifactsDir(), rel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    // macOS: open；Windows: explorer；Linux: xdg-open
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
    } catch {
      /* 失敗仍回 ok:false 由前端提示 */
      res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: false, error: "open failed" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, path: dir }));
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
    const file = join(artifactsDir(), rel);
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
    let msg: {
      id?: number;
      method?: string;
      params?: unknown;
      jt?: string;
      label?: string;
      evidence?: Record<string, unknown>;
    };
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
    // API 證據（api_check 工具）：由進行中的 run 寫入該 TC 的 api-NN.json
    if (msg.jt === "apiEvidence") {
      if (msg.evidence) apiEvidence.handler?.(msg.evidence);
      return;
    }
    // 步驟標記（step_note 工具）：更新錄影步驟橫幅
    if (msg.jt === "stepNote") {
      const m = msg as unknown as { seq?: number; total?: number; title?: string };
      stepNote.handler?.({ seq: m.seq, total: m.total, title: m.title });
      return;
    }
    if (!msg.method) return;
    // relay 層防護：只放行 jt-browser 工具實際需要的 CDP 指令（agent 有 shell 權限，
    // 可繞過工具直連本 relay——白名單 + viewport 閘門在這裡才擋得住）。
    const reject = (message: string) => {
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ id: msg.id, error: { message } }));
    };
    const ALLOWED_CDP = new Set([
      "Runtime.evaluate",
      "Emulation.setDeviceMetricsOverride",
      "Emulation.clearDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
    ]);
    if (!ALLOWED_CDP.has(msg.method)) {
      reject(`CDP 指令未開放：${msg.method}（請使用 jt-browser 工具操作瀏覽器）`);
      return;
    }
    const touchOn =
      msg.method === "Emulation.setTouchEmulationEnabled" &&
      !!(msg.params as { enabled?: boolean } | undefined)?.enabled;
    if (!viewportGate.allowed && (msg.method === "Emulation.setDeviceMetricsOverride" || touchOn)) {
      reject("此測試案例未要求 RWD/響應式驗證，viewport 調整已停用（清除/還原不受限）");
      return;
    }
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
