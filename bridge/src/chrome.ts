/**
 * 啟動 / 檢查「測試用 Chrome」。
 * bridge 以 remote-debugging + 自動載入本 extension 的方式啟動 Chrome，
 * 讓使用者免打指令即可一鍵備妥「可被 agent 接管的分頁」。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  CDP_BROWSER_URL,
  CDP_PORT,
  CHROME_BINARY,
  CHROME_USER_DATA_DIR,
  EXTENSION_PATH,
} from "./config.js";
import { probeCdp } from "./mcp.js";

/** 叫出 macOS 原生「選擇資料夾」對話框，回傳絕對路徑。 */
export function pickFolder(
  prompt = "選擇 automatic-testing 專案資料夾",
): Promise<{ path?: string; canceled?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const script = `POSIX path of (choose folder with prompt "${prompt.replace(/"/g, '\\"')}")`;
    const p = spawn("osascript", ["-e", script]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => resolve({ error: e.message }));
    p.on("close", (code) => {
      if (code === 0 && out.trim()) resolve({ path: out.trim().replace(/\/+$/, "") });
      else if (/User canceled|cancel/i.test(err)) resolve({ canceled: true });
      else resolve({ error: err.trim() || `osascript exit ${code}` });
    });
  });
}

/** 輪詢 CDP 直到可連或逾時。 */
async function waitForCdp(timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = await probeCdp(CDP_BROWSER_URL);
    if (p.ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function chromeStatus(): Promise<{
  running: boolean;
  version?: string;
  pages?: { url: string; title: string }[];
}> {
  const p = await probeCdp(CDP_BROWSER_URL);
  return { running: p.ok, version: p.version, pages: p.pages };
}

/**
 * 啟動測試用 Chrome（若已在跑則直接回現況）。
 * 帶 --load-extension 自動載入本 extension。
 */
export async function launchChrome(
  url = "https://example.com",
): Promise<{ ok: boolean; alreadyRunning?: boolean; version?: string; error?: string }> {
  // 已在跑 → 直接回
  const existing = await probeCdp(CDP_BROWSER_URL);
  if (existing.ok) return { ok: true, alreadyRunning: true, version: existing.version };

  if (!existsSync(CHROME_BINARY)) {
    return {
      ok: false,
      error: `找不到 Chrome 執行檔：${CHROME_BINARY}（可用環境變數 CHROME_BINARY 覆寫）`,
    };
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (existsSync(EXTENSION_PATH)) {
    args.push(`--load-extension=${EXTENSION_PATH}`);
  }
  args.push(url);

  const child = spawn(CHROME_BINARY, args, { detached: true, stdio: "ignore" });
  child.unref();

  const ready = await waitForCdp();
  if (!ready) return { ok: false, error: "Chrome 已啟動但 CDP 在逾時內未就緒" };
  const p = await probeCdp(CDP_BROWSER_URL);
  return { ok: true, version: p.version };
}
