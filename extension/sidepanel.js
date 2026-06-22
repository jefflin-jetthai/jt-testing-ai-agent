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

function setConnected(on) {
  $("dot").className = `dot ${on ? "on" : "off"}`;
  $("btn-connect").disabled = on; // 已連線 → 連線鈕 disable
  $("btn-stop-bridge").disabled = !on; // 已連線 → 停止鈕 enable
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

function call(type, payload) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("bridge 未連線"));
    const id = `r${++reqId}`;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, payload }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${type} timeout`));
      }
    }, 120000);
  });
}

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
    } else {
      logLine(`自動啟動失敗：${r.error}`, "err");
      logLine("→ 請先執行一次 bridge/native-host/install.sh <extension id>，或手動 npm run dev", "err");
    }
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
      // 套用 Options 設定的 automatic-testing 路徑
      const { atRepoPath } = await new Promise((r) =>
        chrome.storage.sync.get(["atRepoPath"], r),
      );
      if (atRepoPath && atRepoPath !== cfg.atRepoPath) {
        try {
          const r = await call("config.setAtRepo", { path: atRepoPath });
          if (!r.exists) logLine(`⚠ 設定的 AT 路徑不存在：${atRepoPath}`, "err");
          if (r.needsRestart)
            logLine("AT 路徑已更新，請按「停止 bridge」再「連線」套用", "tool");
        } catch (e) {
          logLine(`設定 AT 路徑失敗：${e.message}`, "err");
        }
      }
      if (!cfg.atRepoExists) logLine("⚠ AT repo 路徑不存在（可於設定指定）", "err");
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
      refreshChromeStatus();
    } catch (e) {
      logLine(`config 讀取失敗：${e.message}`, "err");
    }
  };
  ws.onclose = () => {
    setConnected(false);
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

function handleEvent(msg) {
  const p = msg.payload || {};
  switch (msg.type) {
    case "agent.log": {
      const prefix = p.tcId ? `${p.tcId} ` : "";
      const cls = p.kind === "stderr" ? "err" : p.kind === "tool" ? "tool" : "";
      logLine(`${prefix}${p.text ?? ""}`, cls);
      break;
    }
    case "run.step":
      if (p.phase === "start") logLine(`▶ 開始 ${p.tcId}：${p.title || ""}`, "tool");
      break;
    case "run.result": {
      const ok = p.status === "pass";
      logLine(
        `${ok ? "✅" : p.status === "fail" ? "❌" : "⚠️"} ${p.tcId} ${p.status.toUpperCase()} (${Math.round(
          (p.durationMs || 0) / 1000,
        )}s) — ${p.summary || ""}`,
        ok ? "ok" : "err",
      );
      renderResult(p);
      break;
    }
    case "run.done":
      logLine("◼ 全部測試完成", "ok");
      currentRunId = null;
      $("btn-run").disabled = false;
      $("btn-cancel").style.display = "none";
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

/** 渲染單一 TC 結果卡：狀態、gif 預覽、複製 markdown、寫回 Notion。 */
function renderResult(p) {
  const box = $("results");
  const card = document.createElement("div");
  card.className = "result";
  const ok = p.status === "pass";
  const badge = ok ? "✅ PASS" : p.status === "fail" ? "❌ FAIL" : "⚠️ ERROR";
  card.innerHTML = `
    <div class="result-head">
      <span class="tc">${escapeHtml(p.tcId)}</span>
      <span class="${ok ? "ok" : "err"}">${badge}</span>
      <span class="meta">${Math.round((p.durationMs || 0) / 1000)}s</span>
    </div>
    <div class="meta">${escapeHtml(p.summary || "")}</div>
    ${p.gifUrl ? `<img class="gif" src="${p.gifUrl}" alt="${p.tcId} 錄影" />` : ""}
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
  } catch (e) {
    logLine(`讀取失敗：${e.message}`, "err");
    if (/Token/.test(e.message)) logLine("→ 請按「設定」填入 Notion Token", "err");
  }
}

function renderCases() {
  const box = $("cases");
  box.innerHTML = "";
  for (const tc of testCases) {
    const el = document.createElement("label");
    el.className = "case";
    el.innerHTML = `
      <input type="checkbox" data-block="${tc.blockId}" checked />
      <div>
        <div><span class="tc">${escapeHtml(tc.tcId)}</span> ${escapeHtml(tc.title)}</div>
        <div class="meta">${tc.steps.length} 步驟 · ${tc.expected.length} 確認項目${
          tc.preconditions.length ? " · " + tc.preconditions.length + " 前置" : ""
        }</div>
      </div>`;
    box.appendChild(el);
  }
  const hasNone = testCases.length === 0;
  $("btn-run").disabled = hasNone;
  $("btn-export").disabled = hasNone;
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

$("btn-connect").addEventListener("click", connect);
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
$("btn-load").addEventListener("click", loadCases);
$("btn-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("btn-run").addEventListener("click", async () => {
  const cases = selectedCases();
  if (!cases.length) return logLine("請先勾選測試案例", "err");
  const tab = await getActiveTab();
  logLine(`接管當前分頁執行 ${cases.length} 個案例 → ${tab?.url || "(未知分頁)"}`, "tool");
  $("results").innerHTML = "";
  $("btn-run").disabled = true;
  try {
    const { runId } = await call("run.start", {
      cases,
      agent: $("agent-select")?.value || "claude",
      mode: $("mode-select")?.value || "remote",
      target: { url: tab?.url, title: tab?.title, tabId: tab?.id },
    });
    currentRunId = runId;
    $("btn-cancel").style.display = "inline-block";
    logLine(`run 已啟動（${runId}）`, "ok");
  } catch (e) {
    logLine(`啟動失敗：${e.message}`, "err");
    $("btn-run").disabled = false;
  }
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
    $("chrome-status").textContent = s.running
      ? `🟢 ${s.version || "Chrome"}（${s.pages?.length ?? 0} 分頁）`
      : "🔴 未啟動";
  } catch {
    $("chrome-status").textContent = "";
  }
}

// 模式切換：顯示對應的輔助列
$("mode-select").addEventListener("change", () => {
  const attach = $("mode-select").value === "attach";
  $("row-remote").style.display = attach ? "none" : "flex";
  $("row-attach").style.display = attach ? "flex" : "none";
});

// 從目前 bridge ws url 推導 /cdp-relay 位址
function relayUrl() {
  const base = $("ws-url").value.trim() || "ws://localhost:8787";
  return base.replace(/\/+$/, "") + "/cdp-relay";
}

$("btn-attach").addEventListener("click", async () => {
  $("btn-attach").disabled = true;
  logLine("接管當前分頁中…（Chrome 會出現「擴充功能正在偵錯」橫幅，屬正常）", "tool");
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "attachCurrentTab", relayUrl: relayUrl() });
    if (r?.ok) {
      $("attach-status").textContent = `🟢 已接管：${r.title || r.url || ""}`;
      $("btn-detach").style.display = "inline-block";
      logLine(`已接管當前分頁：${r.url || ""}`, "ok");
    } else {
      logLine(`接管失敗：${r?.error || "未知錯誤"}`, "err");
    }
  } catch (e) {
    logLine(`接管失敗：${e.message}`, "err");
  } finally {
    $("btn-attach").disabled = false;
  }
});

$("btn-detach").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "detachTab" });
  $("attach-status").textContent = "";
  $("btn-detach").style.display = "none";
  logLine("已解除接管", "tool");
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

// ── Phase 5：匯出 pytest → 本地 commit ──────────────────────────────
let exportedFiles = [];
let committedBranch = null;

$("btn-export").addEventListener("click", async () => {
  const cases = selectedCases();
  if (!cases.length) return logLine("請先勾選測試案例", "err");
  const product = $("export-product").value;
  logLine(`匯出 ${cases.length} 案例為 pytest（${product}）… 這會請 agent 在本地 AT repo 生成檔案`, "tool");
  $("btn-export").disabled = true;
  try {
    const r = await call("export.toPytest", { cases, product, agent: $("agent-select").value });
    exportedFiles = r.files || [];
    $("export-files").innerHTML = exportedFiles.length
      ? `異動檔案：<br>` + exportedFiles.map((f) => `• ${escapeHtml(f)}`).join("<br>")
      : "（agent 未回報異動檔案，請檢查 log）";
    $("btn-commit").disabled = exportedFiles.length === 0;
    logLine(`匯出完成，異動 ${exportedFiles.length} 個檔案`, "ok");
  } catch (e) {
    logLine(`匯出失敗：${e.message}`, "err");
  } finally {
    $("btn-export").disabled = false;
  }
});

$("btn-commit").addEventListener("click", async () => {
  if (!exportedFiles.length) return;
  try {
    const r = await call("git.commit", {
      message: $("commit-msg").value,
      files: exportedFiles,
      branch: $("commit-branch").value.trim() || undefined,
    });
    if (r.ok) {
      committedBranch = r.branch;
      $("btn-push").disabled = false;
      logLine(`已建立本地 commit ${r.hash?.slice(0, 8)} @ ${r.branch}（未 push）`, "ok");
    } else {
      logLine(`commit 失敗：${r.error}`, "err");
    }
  } catch (e) {
    logLine(`commit 失敗：${e.message}`, "err");
  }
});

$("btn-push").addEventListener("click", async () => {
  if (!confirm(`確定要 push 到 origin/${committedBranch || "(當前分支)"}？`)) return;
  try {
    const r = await call("git.push", { branch: committedBranch || undefined });
    logLine(r.ok ? `已 push：${r.output}` : `push 失敗：${r.output}`, r.ok ? "ok" : "err");
  } catch (e) {
    logLine(`push 失敗：${e.message}`, "err");
  }
});

// 啟動：先嘗試連 bridge，並帶入預設頁面 ID
(async () => {
  const { token, pageId } = await getNotionSettings();
  if (pageId) $("page-id").value = pageId;
  if (token) $("first-hint").style.display = "none"; // 已設定過 → 不再提示
  connect();
})();
