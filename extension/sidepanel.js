/**
 * Side panel UI 邏輯（ES module）。
 * - Notion 測試案例：extension 端直接讀（notion.js），不經 bridge。
 * - Bridge 連線：保留給 Phase 2+（接管分頁執行 / 匯出 / commit）。
 */
import { readTestCases, getNotionSettings, appendAiReport } from "./notion.js";

const $ = (id) => document.getElementById(id);
let ws = null;
let reqId = 0;
const pending = new Map();
let testCases = [];

function logLine(text, cls = "") {
  const box = $("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

let bridgeConnected = false;

function setConnected(on) {
  bridgeConnected = on;
  $("dot").className = `dot ${on ? "on" : "off"}`;
  $("btn-connect").disabled = on; // 已連線 → 連線鈕 disable
  updateStopBridgeBtn();
  updateActionButtons();
}

/** 停止 bridge：需已連線；但在「已接管 / Chrome 已連線」進行中時 disable，避免中斷 session。 */
function updateStopBridgeBtn() {
  const attachMode = $("mode-select").value === "attach";
  const sessionActive = attachMode ? attachReady : chromeReady;
  $("btn-stop-bridge").disabled =
    !bridgeConnected || sessionActive || running || exporting;
}

/** 探測 bridge 是否已在跑（HTTP /health）。 */
async function bridgeHealthy(wsUrl) {
  const httpUrl = wsUrl.replace(/^ws/, "http").replace(/\/+$/, "") + "/health";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(httpUrl, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** 透過 Native Messaging host 自動啟動 bridge。 */
function launchBridgeViaNative() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative("com.jt_testing.bridge_launcher");
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { port.disconnect(); } catch { /* noop */ }
      resolve(r);
    };
    port.onMessage.addListener((msg) => finish(msg || { ok: true }));
    port.onDisconnect.addListener(() =>
      finish({ ok: false, error: chrome.runtime.lastError?.message || "native host 未安裝或斷線" }),
    );
    setTimeout(() => finish({ ok: false, error: "native host 逾時" }), 25000);
  });
}

function call(type, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("bridge 未連線"));
    const id = `r${++reqId}`;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, payload }));
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${type} timeout`));
        }
      }, timeoutMs);
    }
  });
}

/**
 * 把 Options 設定的 automatic-testing 路徑推給 bridge（動態生效，免重啟），
 * 再依結果即時顯示/隱藏「匯出 pytest」區。cfg 可選（連線當下已有則沿用其當前值比對）。
 */
async function syncAtRepo(cfg) {
  if (!bridgeConnected) return;
  const { atRepoPath } = await new Promise((r) => chrome.storage.sync.get(["atRepoPath"], r));
  const desired = (atRepoPath ?? "").trim();
  let configured = cfg ? cfg.atRepoConfigured : false;
  try {
    // 永遠送一次，讓 bridge 設定檔與 Options 一致（動態讀取，存檔即生效）
    const r = await call("config.setAtRepo", { path: desired });
    configured = r.configured;
    if (desired && !r.exists) logLine(`⚠ 設定的 AT 路徑不存在：${desired}`, "err");
  } catch (e) {
    logLine(`設定 AT 路徑失敗：${e.message}`, "err");
  }
  $("export-section").style.display = configured ? "" : "none";
}

// Options 頁改了 automatic-testing 路徑 → 連線中即時套用、更新匯出顯示（免重連/重啟）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.atRepoPath) syncAtRepo();
});

// ── 線上更新偵測（GitHub Releases）───────────────────────────────────────────
// 每次發版在此 repo 建一個 Release，附上 bundle.cjs 與 zip 兩個 asset 即可被偵測。
const UPDATE_FEED =
  "https://api.github.com/repos/jefflin-jetthai/jt-testing-ai-agent/releases/latest";
let updateBundleUrl = null;
let updateZipUrl = null;

/** 比較版號 a vs b（回 1/0/-1）。 */
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 連線後偵測 GitHub 最新 Release，有新版就顯示更新列。 */
async function checkUpdate() {
  try {
    const cur = chrome.runtime.getManifest().version;
    const res = await fetch(UPDATE_FEED, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return; // repo 私有 / 無 release → 靜默
    const rel = await res.json();
    const latest = (rel.tag_name || "").replace(/^v/, "");
    if (!latest || cmpVer(latest, cur) <= 0) return; // 已是最新
    const assets = rel.assets || [];
    updateBundleUrl = assets.find((a) => a.name === "bundle.cjs")?.browser_download_url || null;
    const zip = assets.find((a) => /\.zip$/i.test(a.name));
    updateZipUrl = zip?.browser_download_url || null;
    $("update-msg").textContent = `🆕 有新版 v${latest}（目前 v${cur}）`;
    $("btn-update-bridge").style.display = updateBundleUrl && bridgeConnected ? "inline-block" : "none";
    // 手動下載連結預設隱藏；只有自動更新 extension 失敗時才顯示
    const dl = $("update-download");
    dl.href = updateZipUrl || rel.html_url || "#";
    dl.style.display = "none";
    $("update-bar").style.display = "flex";
  } catch {
    /* 偵測失敗不影響使用 */
  }
}

let updating = false;

/** 更新收尾（只跑一次）：res 為 bridge 乾淨回應（可能為 null＝bridge 已 exit、由 ws.onclose 觸發）。 */
function finishUpdate(res) {
  if (!updating) return;
  updating = false;
  const btn = $("btn-update-bridge");
  btn.disabled = false;
  btn.textContent = "更新";
  $("update-bar").style.display = "none";
  // 有乾淨回應 → 用其 extensionUpdated；沒有 → 以「有送 zip」保守推測（reload 無害）
  const extUpdated = res ? !!res.extensionUpdated : !!updateZipUrl;
  if (extUpdated) {
    logLine("更新完成，重新載入擴充以套用新版…", "ok");
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch { connect(); }
    }, 800);
  } else {
    logLine("bridge 已更新，重新連線…", "ok");
    if (updateZipUrl) {
      const dl = $("update-download");
      dl.textContent = "extension 需手動更新：下載 zip";
      dl.style.display = "";
      $("update-msg").textContent = "bridge 已更新；extension 請手動下載並 reload";
      $("btn-update-bridge").style.display = "none";
      $("update-bar").style.display = "flex";
    }
    setTimeout(() => connect(), 1500);
  }
}

// 一鍵更新：bridge 下載新 bundle（＋extension 檔）覆蓋自己 → 退出。
// 不強依賴回應：bridge 退出時 ws 會 close → 由 ws.onclose 觸發 finishUpdate，避免卡在「更新中…」。
$("btn-update-bridge").addEventListener("click", async () => {
  if (!updateBundleUrl || updating) return;
  updating = true;
  const btn = $("btn-update-bridge");
  btn.disabled = true;
  btn.textContent = "更新中…";
  logLine("更新中（bridge 下載新版並重啟）…", "tool");
  setTimeout(() => finishUpdate(null), 45000); // 安全網：避免任何情況下永久卡住
  try {
    const res = await call("bridge.selfUpdate", { bundleUrl: updateBundleUrl, zipUrl: updateZipUrl }, 40000);
    finishUpdate(res); // 收到乾淨回應
  } catch (e) {
    // bridge 回錯誤（仍連線）→ 顯示並重置；bridge 已 exit（ws 斷）→ 交給 onclose 收尾
    if (ws && ws.readyState === WebSocket.OPEN) {
      updating = false;
      btn.disabled = false;
      btn.textContent = "更新";
      logLine(`更新失敗：${e.message}`, "err");
    }
  }
});
$("update-dismiss").addEventListener("click", () => {
  $("update-bar").style.display = "none";
});

async function connect() {
  // 冪等：先拆掉舊連線，避免重複連線造成事件重複處理
  if (ws) {
    try {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      ws.close();
    } catch {
      /* noop */
    }
    ws = null;
  }
  const url = $("ws-url").value.trim() || "ws://localhost:8787";
  $("ws-url").value = url;
  // 存起來供 Options 的資料夾選取器沿用同一個 bridge 位址
  chrome.storage.sync.set({ bridgeUrl: url });

  // bridge 沒在跑 → 透過 native host 自動啟動
  if (!(await bridgeHealthy(url))) {
    logLine("bridge 未啟動，嘗試自動啟動…", "tool");
    const r = await launchBridgeViaNative();
    if (r.ok) {
      logLine(r.already ? "bridge 已在執行" : "bridge 已自動啟動", "ok");
      $("setup-hint").style.display = "none";
    } else if (/not found|未安裝|forbidden/i.test(r.error || "")) {
      // 首次：native host 尚未註冊 → 引導使用者做一次性安裝（之後就自動）
      logLine("⚠ 首次使用：尚未完成一次性設定", "err");
      $("setup-hint").style.display = "block";
    } else {
      logLine(`自動啟動失敗：${r.error}`, "err");
    }
  } else {
    $("setup-hint").style.display = "none";
  }

  try {
    ws = new WebSocket(url);
  } catch (e) {
    logLine(`連線失敗：${e.message}`, "err");
    return;
  }
  ws.onopen = async () => {
    setConnected(true);
    logLine("已連線到 bridge", "ok");
    try {
      const cfg = await call("config.describe");
      $("config-box").textContent = JSON.stringify(cfg, null, 2);
      // 套用 Options 設定的 automatic-testing 路徑（選填；可空＝清除）→ 動態生效並更新匯出顯示
      await syncAtRepo(cfg);
      // 依實際可用的 agent CLI 啟用下拉選項
      const avail = new Set(cfg.availableAgents || ["claude"]);
      for (const opt of $("agent-select").options) {
        opt.disabled = !avail.has(opt.value);
        if (!opt.disabled) opt.textContent = opt.textContent.replace(/（.*?）/, "").trim();
      }
      const firstAvailable = [...$("agent-select").options].find((opt) => !opt.disabled);
      if ($("agent-select").selectedOptions[0]?.disabled && firstAvailable) {
        $("agent-select").value = firstAvailable.value;
      }
      if (cfg.claudeModel) agentModels.claude = cfg.claudeModel;
      if (cfg.codexModel) agentModels.codex = cfg.codexModel;
      if (cfg.antigravityModel) agentModels.antigravity = cfg.antigravityModel;
      updateModelUI(); // 依目前 agent 填入下拉並選中偵測到的 model
      showStaleBridge(cfg); // bridge 程式已更新但沒重啟 → 提示重啟（否則跑的是舊邏輯）
      refreshChromeStatus();
      checkUpdate(); // 線上偵測新版（GitHub Releases）
    } catch (e) {
      logLine(`config 讀取失敗：${e.message}`, "err");
    }
  };
  ws.onclose = () => {
    setConnected(false);
    // 更新中 bridge 自我更新後會 exit → ws 在此關閉，觸發收尾（reload / 重連），避免卡「更新中…」
    if (updating) finishUpdate(null);
    // bridge 斷線 → cdp-relay 失效，接管已不可用，重置狀態讓按鈕回到正確 enable/disable
    if (attachReady) {
      attachReady = false;
      $("attach-status").textContent = "🔴 未接管";
    }
    if (running || exporting) {
      running = false;
      exporting = false;
      currentRunId = null;
      setTranslateSuspended(false); // 連線中斷 = run 無法繼續，恢復翻譯比對
    }
    updateActionButtons();
    updateStopBridgeBtn();
    logLine("bridge 連線關閉");
  };
  ws.onerror = () => logLine("WebSocket 錯誤（bridge 有啟動嗎？）", "err");
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.ok ? resolve(msg.result) : reject(new Error(msg.error || "request failed"));
      return;
    }
    handleEvent(msg);
  };
}

let currentRunId = null;
let lastRunId = null; // 最近一次 run（執行結束後仍保留，供「檢視截圖」用）
let attachReady = false; // attach 模式：是否已成功接管當前分頁
let attaching = false; // attach 模式：接管/解除進行中
let chromeReady = false; // remote 模式：測試用 Chrome 是否已啟動
let running = false; // 測試執行中
let exporting = false; // 匯出 pytest 中

/** 測試執行中暫停翻譯比對面板（translate/content.js 讀此旗標），避免面板彈出干擾操作與錄影。 */
function setTranslateSuspended(v) {
  chrome.storage.local.set({ tcSuspended: v });
}
setTranslateSuspended(false); // side panel 開啟時重置，避免上次異常結束後旗標卡住
// 各 agent 的 model，bridge 連線後由 config.describe 帶回
const agentModels = { claude: "opus", codex: "(codex 預設)", antigravity: "(CLI 預設)" };

// 可下拉選 model 的 agent 與其選項（antigravity 的 CLI 不吃 -m，故不列、改顯示文字）
// claude 用 CLI 別名：執行時由 claude CLI 解析成該系列最新版，清單免維護
const MODEL_OPTIONS = {
  claude: [
    ["opus", "Opus（最新）"],
    ["sonnet", "Sonnet（最新）"],
    ["haiku", "Haiku（最新）"],
  ],
  codex: [
    ["", "(依 codex 設定)"], // 不帶 -m，由 codex config.toml 決定
    ["gpt-5.5", "gpt-5.5"],
    ["gpt-5-codex", "gpt-5-codex"],
    ["gpt-5", "gpt-5"],
  ],
};

// 錄影輸出格式偏好：勾選＝MP4 影片、未勾＝GIF（持久化，下次開啟沿用）
chrome.storage.sync.get(["recVideo"], ({ recVideo }) => {
  $("rec-video").checked = !!recVideo;
});
$("rec-video").addEventListener("change", () => {
  chrome.storage.sync.set({ recVideo: $("rec-video").checked });
});

// 執行時 agent CLI 回報的「實際解析到的 model」（run.model 事件；持久化供下次開啟顯示）
const resolvedModels = {};
// 使用者自己選的 model（每個 agent 各記一個）。不記住的話，run.model 事件或重連時
// 下拉會被重建並跳回 bridge 預設（opus），使用者選的 sonnet 就無聲消失了。
const selectedModels = {};
chrome.storage.sync.get(["resolvedModels", "selectedModels"], (s) => {
  if (s.resolvedModels && typeof s.resolvedModels === "object")
    Object.assign(resolvedModels, s.resolvedModels);
  if (s.selectedModels && typeof s.selectedModels === "object")
    Object.assign(selectedModels, s.selectedModels);
  updateModelUI();
});

/** 依 agent 填入 model 下拉選項並還原選取（使用者選過的 > 目前值 > bridge 預設）。 */
function setModelOptions(agent) {
  const sel = $("model-select");
  const opts = (MODEL_OPTIONS[agent] || []).slice();
  const current = agentModels[agent];
  if (current && !current.startsWith("(") && !opts.some((o) => o[0] === current))
    opts.unshift([current, current]); // bridge 偵測到的 model 不在清單 → 補進去
  // 重建 options 會清掉選取，故先記下目前選擇再還原，否則每次重繪都跳回預設
  const prev = agent in selectedModels ? selectedModels[agent] : sel.value;
  sel.innerHTML = opts
    .map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`)
    .join("");
  const pick = [prev, current].find(
    (v) => v != null && !String(v).startsWith("(") && opts.some((o) => o[0] === v),
  );
  if (pick != null) sel.value = pick;
}

/** 有下拉選項的 agent（claude/codex）→ 顯示下拉；其它（antigravity）→ 顯示 model 文字。 */
function updateModelUI() {
  const agent = $("agent-select")?.value || "claude";
  const sel = $("model-select");
  const lbl = $("model-label");
  if (!sel || !lbl) return;
  if (MODEL_OPTIONS[agent]) {
    setModelOptions(agent);
    sel.style.display = "";
    // 有跑過測試 → 顯示 CLI 實際解析到的完整版本（例如 sonnet → claude-sonnet-5）
    const resolved = resolvedModels[agent];
    lbl.style.display = resolved ? "" : "none";
    lbl.textContent = resolved ? `· 實際: ${resolved}` : "";
  } else {
    sel.style.display = "none";
    lbl.style.display = "";
    lbl.textContent = `· ${agentModels[agent] || "?"}`;
  }
}

/**
 * 執行鈕：案例已讀取 + 瀏覽器就緒（attach 已接管 / remote Chrome 已啟動）+ 非執行中。
 * 匯出鈕：只需 bridge 已連線 + 案例已讀取 + 非執行中（產生程式碼不需瀏覽器）。
 */
function updateActionButtons() {
  const hasCases = testCases.length > 0;
  const attachMode = $("mode-select").value === "attach";
  const browserReady = attachMode ? attachReady : chromeReady;
  $("btn-run").disabled = running || !(hasCases && browserReady);
  $("btn-cancel").disabled = !running; // 執行中才可停止
  $("btn-view-shots").disabled = !lastRunId; // 有跑過才可檢視截圖
  $("btn-export").disabled = running || exporting || !(hasCases && bridgeConnected);
  $("btn-export-cancel").disabled = !exporting; // 匯出中才可停止
  updateAttachButtons();
}

/**
 * 接管 / 解除按鈕的 enable/disable 狀態（attach 模式兩顆都顯示）：
 * - 接管：bridge 已連線、尚未接管、非進行中、非執行中才可按
 * - 解除：已接管、非進行中、非執行中才可按
 */
function updateAttachButtons() {
  const attachMode = $("mode-select").value === "attach";
  const attach = $("btn-attach");
  const detach = $("btn-detach");
  attach.style.display = attachMode ? "inline-block" : "none";
  detach.style.display = attachMode ? "inline-block" : "none";
  if (!attachMode) return;
  attach.disabled = !bridgeConnected || attachReady || attaching || running;
  detach.disabled = !attachReady || attaching || running;
}

/** 依模式切換 attach / launch 按鈕＋狀態顯示，並更新動作鈕狀態。 */
function applyModeUI() {
  const attachMode = $("mode-select").value === "attach";
  $("btn-launch-chrome").style.display = attachMode ? "none" : "inline-block";
  // 狀態指示：只顯示對應模式那一個（在各自按鈕右側）
  $("attach-status").style.display = attachMode ? "inline" : "none";
  $("chrome-status").style.display = attachMode ? "none" : "inline";
  if (attachMode && !attachReady) $("attach-status").textContent = "🔴 未接管";
  if (!attachMode) refreshChromeStatus();
  updateActionButtons();
  updateStopBridgeBtn();
}

function handleEvent(msg) {
  const p = msg.payload || {};
  switch (msg.type) {
    case "agent.log": {
      const prefix = p.tcId ? `${p.tcId} ` : "";
      const cls = p.kind === "stderr" ? "err" : p.kind === "tool" ? "tool" : "";
      logLine(`${prefix}${p.text ?? ""}`, cls);
      break;
    }
    case "run.model": {
      // agent CLI 回報實際使用的 model（別名 → 完整 id）；更新標籤並持久化
      if (p.agent && p.model && resolvedModels[p.agent] !== p.model) {
        resolvedModels[p.agent] = p.model;
        chrome.storage.sync.set({ resolvedModels });
        updateModelUI();
      }
      break;
    }
    case "run.step":
      if (p.phase === "start") logLine(`▶ 開始 ${p.tcId}：${p.title || ""}`, "tool");
      break;
    case "run.result": {
      const emoji =
        p.status === "pass" ? "✅" : p.status === "fail" ? "❌" : p.status === "warn" ? "⚠️" : "🛑";
      const cls = p.status === "pass" ? "ok" : p.status === "warn" ? "tool" : "err";
      logLine(
        `${emoji} ${p.tcId} ${p.status.toUpperCase()} (${Math.round((p.durationMs || 0) / 1000)}s) — ${p.summary || ""}`,
        cls,
      );
      renderResult(p);
      break;
    }
    case "run.done":
      if (p.error) logLine(`◼ 測試異常結束：${p.error}`, "err");
      else logLine(p.cancelled ? "◼ 已中止測試" : "◼ 全部測試完成", p.cancelled ? "tool" : "ok");
      currentRunId = null;
      running = false;
      setTranslateSuspended(false);
      updateActionButtons();
      updateStopBridgeBtn();
      break;
    case "error":
      logLine(p.error ?? "error", "err");
      break;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/** 錄影預覽 HTML：mp4 用 <video>（可拖曳進度），gif 用 <img>；沿用舊欄位 gifUrl 相容。 */
function recordingPreviewHtml(p) {
  const url = p.recordingUrl || p.gifUrl;
  if (!url) return "";
  const isVideo = p.recordingFormat === "mp4" || /\.(mp4|webm)$/i.test(url);
  return isVideo
    ? `<video class="gif" src="${url}" controls preload="metadata" title="${p.tcId} 錄影"></video>`
    : `<img class="gif" src="${url}" alt="${p.tcId} 錄影" />`;
}

/** 渲染單一 TC 結果卡：狀態、錄影預覽（gif 圖 / mp4 影片）、複製 markdown、寫回 Notion。 */
function renderResult(p) {
  const box = $("results");
  const card = document.createElement("div");
  card.className = "result";
  const badgeMap = {
    pass: ["✅ PASS", "ok"],
    fail: ["❌ FAIL", "err"],
    warn: ["⚠️ WARN", "warn"],
    error: ["🛑 ERROR", "err"],
  };
  const [badge, badgeCls] = badgeMap[p.status] || badgeMap.error;
  card.innerHTML = `
    <div class="result-head">
      <span class="tc">${escapeHtml(p.tcId)}</span>
      <span class="${badgeCls}">${badge}</span>
      <span class="meta">${Math.round((p.durationMs || 0) / 1000)}s</span>
    </div>
    <div class="meta">${escapeHtml(p.summary || "")}</div>
    ${recordingPreviewHtml(p)}
    <div class="row" style="margin-top:6px">
      <button class="copy-md" style="background:#3a3a3a">複製 markdown</button>
      <button class="write-notion">寫回 Notion</button>
    </div>`;

  card.querySelector(".copy-md").addEventListener("click", async () => {
    await navigator.clipboard.writeText(p.markdown || "");
    logLine(`${p.tcId} markdown 已複製`, "ok");
  });

  card.querySelector(".write-notion").addEventListener("click", async () => {
    const tc = testCases.find((t) => t.tcId === p.tcId);
    if (!tc?.aiReportBlockId) {
      logLine(`${p.tcId} 找不到「AI測試報告結果」區塊，無法寫回`, "err");
      return;
    }
    try {
      const { token } = await getNotionSettings();
      await appendAiReport(token, tc.aiReportBlockId, p.markdown || "");
      logLine(`${p.tcId} 已寫回 Notion`, "ok");
    } catch (e) {
      logLine(`${p.tcId} 寫回失敗：${e.message}`, "err");
    }
  });

  box.appendChild(card);
}

async function loadCases() {
  const pageId = $("page-id").value.trim() || undefined;
  logLine("讀取 Notion 測試案例…");
  try {
    const { cases, meta } = await readTestCases(pageId);
    testCases = cases || [];
    renderCases();
    const metaStr = meta?.version ? ` (version ${meta.version}, ENV ${meta.ENV || "-"})` : "";
    logLine(`讀到 ${testCases.length} 個測試案例${metaStr}`, "ok");
    // 讀取成功 → 讀取鈕 disable、重置/重讀鈕 enable
    if (testCases.length) {
      $("btn-load").disabled = true;
      $("btn-reset").disabled = false;
      $("btn-reread").disabled = false;
    }
  } catch (e) {
    logLine(`讀取失敗：${e.message}`, "err");
    if (/Token/.test(e.message)) logLine("→ 請按「設定」填入 Notion Token", "err");
  }
}

/** 案例展開時的預覽內容：目的 / 前置條件 / 測試步驟 / 確認項目。 */
function casePreviewHtml(tc) {
  const list = (items, ordered) =>
    `<${ordered ? "ol" : "ul"}>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
  const parts = [];
  if (tc.purpose) parts.push(`<h5>目的</h5><p>${escapeHtml(tc.purpose)}</p>`);
  if (tc.preconditions.length) parts.push(`<h5>前置條件</h5>${list(tc.preconditions, false)}`);
  if (tc.steps.length) parts.push(`<h5>測試步驟</h5>${list(tc.steps, true)}`);
  if (tc.expected.length) parts.push(`<h5>確認項目</h5>${list(tc.expected, false)}`);
  return parts.join("") || `<p class="meta">（無細節）</p>`;
}

function renderCases() {
  const box = $("cases");
  box.innerHTML = "";
  for (const tc of testCases) {
    const el = document.createElement("div");
    el.className = "case";
    el.innerHTML = `
      <div class="case-row">
        <input type="checkbox" data-block="${tc.blockId}" />
        <div class="case-head" title="點擊展開 / 收合內容">
          <div><span class="tc">${escapeHtml(tc.tcId)}</span> ${escapeHtml(tc.title)}<span class="caret">▸</span></div>
          <div class="meta">${tc.steps.length} 步驟 · ${tc.expected.length} 確認項目${
            tc.preconditions.length ? " · " + tc.preconditions.length + " 前置" : ""
          }</div>
        </div>
      </div>
      <div class="case-detail" style="display:none">${casePreviewHtml(tc)}</div>`;
    // 點標題列展開 / 收合（預設收合），不影響 checkbox 勾選
    const head = el.querySelector(".case-head");
    const detail = el.querySelector(".case-detail");
    const caret = el.querySelector(".caret");
    head.addEventListener("click", () => {
      const open = detail.style.display === "none";
      detail.style.display = open ? "block" : "none";
      caret.textContent = open ? "▾" : "▸";
    });
    box.appendChild(el);
  }
  const hasNone = testCases.length === 0;
  $("cases-toolbar").style.display = hasNone ? "none" : "flex";
  updateActionButtons();
  updateCasesCount();
}

function setAllCases(checked) {
  document.querySelectorAll(".case input[type=checkbox]").forEach((i) => (i.checked = checked));
  updateCasesCount();
}

function updateCasesCount() {
  const total = document.querySelectorAll(".case input[type=checkbox]").length;
  const sel = document.querySelectorAll(".case input[type=checkbox]:checked").length;
  $("cases-count").textContent = total ? `已選 ${sel} / ${total}` : "";
}

function selectedCases() {
  const checked = new Set(
    [...document.querySelectorAll(".case input:checked")].map((i) => i.dataset.block),
  );
  return testCases.filter((tc) => checked.has(tc.blockId));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}

/**
 * bridge 是常駐程序：bundle 更新後若沒重啟，跑的仍是舊程式碼（改動看似沒生效）。
 * bridge 端比對檔案時間戳後回報，這裡顯示提示列並提供一鍵重啟。
 */
function showStaleBridge(cfg) {
  const bar = $("stale-bar");
  if (!cfg?.bridgeStale) {
    bar.style.display = "none";
    return;
  }
  $("stale-msg").textContent =
    `⚠️ bridge 程式已更新但尚未重啟，目前仍執行舊版邏輯（載入 ${cfg.bridgeLoadedAt || "?"} 的版本，磁碟上是 ${cfg.bridgeDiskAt || "?"}）`;
  bar.style.display = "";
}

$("btn-connect").addEventListener("click", connect);
// 一鍵重啟：停掉舊 bridge，再連線（native host 會用磁碟上的新版拉起）
$("btn-restart-bridge").addEventListener("click", async () => {
  const btn = $("btn-restart-bridge");
  btn.disabled = true;
  btn.textContent = "重啟中…";
  try {
    await call("bridge.shutdown");
  } catch {
    /* 預期：bridge 結束後連線會斷，可能收不到回應 */
  }
  try { ws?.close(); } catch { /* noop */ }
  setConnected(false);
  logLine("已停止舊 bridge，重新連線中…", "tool");
  setTimeout(() => {
    connect();
    btn.disabled = false;
    btn.textContent = "重啟 bridge";
  }, 1200);
});
$("btn-stop-bridge").addEventListener("click", async () => {
  try {
    await call("bridge.shutdown");
  } catch {
    /* 預期：bridge 結束後連線會斷，可能收不到回應 */
  }
  logLine("已要求停止 bridge", "tool");
  try { ws?.close(); } catch { /* noop */ }
  setConnected(false);
});
// 貼上：把剪貼簿內容填入 Notion 頁面輸入框
$("btn-paste").addEventListener("click", async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return logLine("剪貼簿是空的", "tool");
    $("page-id").value = text;
    $("page-id").focus();
    logLine("已貼上剪貼簿內容", "ok");
  } catch (e) {
    logLine(`貼上失敗：${e.message}（可改用 Cmd+V）`, "err");
  }
});
$("btn-load").addEventListener("click", loadCases);
// 重讀：清掉現有清單、強制重新讀取 Notion 最新內容（fetch 已設 no-store，不吃快取）
$("btn-reread").addEventListener("click", () => {
  logLine("重讀 Notion（清除快取）…", "tool");
  testCases = [];
  renderCases();
  loadCases();
});
$("btn-reset").addEventListener("click", () => {
  testCases = [];
  renderCases(); // 清空清單、隱藏工具列、disable 執行/匯出
  $("page-id").value = ""; // 清空頁面網址輸入框
  $("results").innerHTML = ""; // 清掉上一次的測試結果卡
  $("log").innerHTML = ""; // 清掉 log
  lastRunId = null; // 連帶 disable「檢視截圖」
  $("btn-load").disabled = false;
  $("btn-reset").disabled = true;
  $("btn-reread").disabled = true;
  updateActionButtons();
  logLine("已重置（清空案例、結果與 log）", "tool");
});
$("btn-select-all").addEventListener("click", () => setAllCases(true));
$("btn-deselect-all").addEventListener("click", () => setAllCases(false));
$("cases").addEventListener("change", updateCasesCount);
$("btn-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

// 頂部 TAB：AI 測試 / 翻譯比對。翻譯比對頁（iframe）首次切換才載入，
// 避免每次開 side panel 都觸發它的 Notion 欄位讀取。
for (const btn of document.querySelectorAll(".tabs .tab")) {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    for (const b of document.querySelectorAll(".tabs .tab")) b.classList.toggle("active", b === btn);
    $("tab-testing").style.display = tab === "testing" ? "" : "none";
    $("tab-translate").style.display = tab === "translate" ? "" : "none";
    const frame = $("translate-frame");
    if (tab === "translate" && !frame.src) frame.src = frame.dataset.src;
  });
}
$("btn-run").addEventListener("click", async () => {
  const cases = selectedCases();
  if (!cases.length) return logLine("請先勾選測試案例", "err");
  const tab = await getActiveTab();
  logLine(`接管當前分頁執行 ${cases.length} 個案例 → ${tab?.url || "(未知分頁)"}`, "tool");
  $("results").innerHTML = "";
  running = true;
  setTranslateSuspended(true);
  updateActionButtons();
  updateStopBridgeBtn();
  try {
    const agent = $("agent-select")?.value || "claude";
    const { runId } = await call("run.start", {
      cases,
      agent,
      model: MODEL_OPTIONS[agent] ? $("model-select")?.value : undefined,
      mode: $("mode-select")?.value || "remote",
      recording: $("rec-video")?.checked ? "mp4" : "gif",
      target: { url: tab?.url, title: tab?.title, tabId: tab?.id },
    });
    currentRunId = runId;
    lastRunId = runId;
    updateActionButtons();
    logLine(`run 已啟動（${runId}）`, "ok");
  } catch (e) {
    logLine(`啟動失敗：${e.message}`, "err");
    running = false;
    setTranslateSuspended(false);
    updateActionButtons();
    updateStopBridgeBtn();
  }
});

// 檢視截圖：開新分頁瀏覽該 run 的產出（gif 內嵌預覽 + frame 截圖目錄）
$("btn-view-shots").addEventListener("click", () => {
  if (!lastRunId) return;
  const base = ($("ws-url").value.trim() || "ws://localhost:8787")
    .replace(/^ws/, "http")
    .replace(/\/+$/, "");
  const url = `${base}/artifacts/${lastRunId}/`;
  chrome.tabs.create({ url });
});

$("btn-cancel").addEventListener("click", async () => {
  if (!currentRunId) return;
  try {
    await call("run.cancel", { runId: currentRunId });
    logLine("已要求中止", "tool");
  } catch (e) {
    logLine(`中止失敗：${e.message}`, "err");
  }
});

async function refreshChromeStatus() {
  try {
    const s = await call("chrome.status");
    chromeReady = !!s.running;
    $("chrome-status").textContent = s.running
      ? `🟢 ${s.version || "Chrome"}（${s.pages?.length ?? 0} 分頁）`
      : "🔴 未啟動";
  } catch {
    chromeReady = false;
    $("chrome-status").textContent = "🔴 未啟動";
  }
  updateActionButtons();
  updateStopBridgeBtn();
}

// 模式切換：顯示對應的輔助列
$("mode-select").addEventListener("change", applyModeUI);
// 切換 agent → 更新右側 model 顯示（claude 顯示下拉，其它顯示文字）
$("agent-select").addEventListener("change", updateModelUI);
// 記住使用者選的 model（每個 agent 各記一個），下次重繪 / 重連 / 重開都沿用
$("model-select").addEventListener("change", () => {
  selectedModels[$("agent-select")?.value || "claude"] = $("model-select").value;
  chrome.storage.sync.set({ selectedModels });
});

// 從目前 bridge ws url 推導 /cdp-relay 位址
function relayUrl() {
  const base = $("ws-url").value.trim() || "ws://localhost:8787";
  return base.replace(/\/+$/, "") + "/cdp-relay";
}

$("btn-attach").addEventListener("click", async () => {
  attaching = true;
  updateActionButtons();
  logLine("接管當前分頁中…（Chrome 會出現「擴充功能正在偵錯」橫幅，屬正常）", "tool");
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "attachCurrentTab", relayUrl: relayUrl() });
    if (r?.ok) {
      attachReady = true;
      $("attach-status").textContent = `🟢 已接管：${r.title || r.url || ""}`;
      logLine(`已接管當前分頁：${r.url || ""}`, "ok");
    } else {
      logLine(`接管失敗：${r?.error || "未知錯誤"}`, "err");
    }
  } catch (e) {
    logLine(`接管失敗：${e.message}`, "err");
  } finally {
    attaching = false;
    updateActionButtons();
    updateStopBridgeBtn();
  }
});

$("btn-detach").addEventListener("click", async () => {
  attaching = true;
  updateActionButtons();
  try {
    await chrome.runtime.sendMessage({ cmd: "detachTab" });
    attachReady = false;
    $("attach-status").textContent = "🔴 未接管";
    logLine("已解除接管", "tool");
  } finally {
    attaching = false;
    updateActionButtons();
    updateStopBridgeBtn();
  }
});

$("btn-launch-chrome").addEventListener("click", async () => {
  $("btn-launch-chrome").disabled = true;
  logLine("啟動測試用 Chrome…（會自動載入本 extension + 開啟 remote-debugging）", "tool");
  try {
    const r = await call("chrome.launch", {});
    if (r.ok) {
      logLine(
        r.alreadyRunning ? "Chrome 已在執行中" : `已啟動 Chrome：${r.version || ""}`,
        "ok",
      );
      logLine("→ 請在新開的 Chrome 視窗操作要測試的分頁", "tool");
    } else {
      logLine(`啟動失敗：${r.error}`, "err");
    }
  } catch (e) {
    logLine(`啟動失敗：${e.message}`, "err");
  } finally {
    $("btn-launch-chrome").disabled = false;
    refreshChromeStatus();
  }
});

// ── 匯出 pytest 到本地 automatic-testing 專案 ──────────────────────────────
$("btn-export").addEventListener("click", async () => {
  const cases = selectedCases();
  if (!cases.length) return logLine("請先勾選測試案例", "err");
  const product = $("export-product").value;
  logLine(`匯出 ${cases.length} 案例為 pytest（${product}）… 這會請 agent 在本地 AT repo 生成檔案`, "tool");
  exporting = true;
  updateActionButtons(); // disable 匯出、enable 停止
  updateStopBridgeBtn();
  try {
    // 沿用上面測試執行區設定的 agent + model（不另外選）
    const agent = $("agent-select")?.value || "claude";
    const model = MODEL_OPTIONS[agent] ? $("model-select")?.value : undefined;
    // 不設逾時：生成可能很久，中止改用「停止」鈕
    const r = await call("export.toPytest", { cases, product, agent, model }, 0);
    const files = r.files || [];
    $("export-files").innerHTML = files.length
      ? `匯出檔案：<br>` + files.map((f) => `• ${escapeHtml(f)}`).join("<br>")
      : "（agent 未回報異動檔案，請檢查 log）";
    logLine(`匯出完成，異動 ${files.length} 個檔案`, "ok");
  } catch (e) {
    logLine(`匯出失敗：${e.message}`, "err");
  } finally {
    exporting = false;
    updateActionButtons();
    updateStopBridgeBtn();
  }
});

$("btn-export-cancel").addEventListener("click", async () => {
  try {
    await call("export.cancel");
    logLine("已要求停止匯出", "tool");
  } catch (e) {
    logLine(`停止匯出失敗：${e.message}`, "err");
  }
});

// 啟動：先嘗試連 bridge，並帶入預設頁面 ID
(async () => {
  const { token, pageId } = await getNotionSettings();
  if (pageId) $("page-id").value = pageId;
  if (token) $("first-hint").style.display = "none"; // 已設定過 → 不再提示
  applyModeUI(); // 依預設模式設定按鈕顯示 + 動作鈕狀態
  connect();
})();

// side panel 常駐不重載：設定頁存 token 後即時收/顯首次使用提示
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.notionToken) return;
  $("first-hint").style.display = changes.notionToken.newValue ? "none" : "block";
});
