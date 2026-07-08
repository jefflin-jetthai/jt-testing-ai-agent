/**
 * Bridge 設定。所有可調整的路徑 / port 集中於此。
 *
 * 憑證（NOTION_API_KEY / ANTHROPIC_API_KEY ...）不另存，
 * 一律從 AT repo 的 .env 載入（見 loadAtEnv）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

/** 是否為打包版（單一執行檔）。打包版的設定/資料寫到使用者資料夾。 */
const PACKAGED = process.env.JT_PACKAGED === "1";

const APP_NAME = "JT Testing AI Agent";

/** 打包版的使用者資料目錄（跨平台）。 */
function packagedDataDir(): string {
  const home = homedir();
  if (process.platform === "win32")
    return resolve(process.env.APPDATA ?? resolve(home, "AppData", "Roaming"), APP_NAME);
  if (process.platform === "darwin")
    return resolve(home, "Library", "Application Support", APP_NAME);
  return resolve(process.env.XDG_CONFIG_HOME ?? resolve(home, ".config"), APP_NAME); // linux
}

/** 設定/資料目錄：打包版 → 平台使用者資料夾（win:%APPDATA% / mac:~/Library / linux:~/.config）；開發 → bridge 目錄。 */
export const DATA_DIR =
  process.env.JT_DATA_DIR ??
  (PACKAGED ? packagedDataDir() : resolve(fileURLToPath(import.meta.url), "..", ".."));

/** bridge 本地設定檔（由 UI 寫入，例如 AT_REPO_PATH）。 */
export const BRIDGE_CONFIG_FILE = resolve(DATA_DIR, ".jt-bridge.json");

function readBridgeConfig(): Record<string, string> {
  try {
    return existsSync(BRIDGE_CONFIG_FILE)
      ? JSON.parse(readFileSync(BRIDGE_CONFIG_FILE, "utf8"))
      : {};
  } catch {
    return {};
  }
}

/** 合併寫入本地設定檔（UI 設定用）。AT 路徑等為動態讀取，存檔後即時生效。 */
export function saveBridgeConfig(patch: Record<string, string>): void {
  const merged = { ...readBridgeConfig(), ...patch };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(merged, null, 2));
}

/**
 * automatic-testing 本地 clone 路徑。**每次即時讀取設定檔**（改設定後免重啟 bridge 即生效）。
 * 優先序：環境變數 > UI 設定檔 > 空（未設定）。
 */
export function atRepoPath(): string {
  return process.env.AT_REPO_PATH ?? readBridgeConfig().AT_REPO_PATH ?? "";
}

/** 是否已設定且存在可用的 AT repo（決定要不要顯示/允許匯出 pytest）。 */
export function atRepoConfigured(): boolean {
  const p = atRepoPath();
  return Boolean(p) && existsSync(p);
}

/** agent 執行的 cwd：有 AT repo 用它（套用其 CLAUDE.md / .env）；沒有就用家目錄。 */
export function agentCwd(): string {
  return atRepoPath() || homedir();
}

/** Bridge WebSocket / HTTP 監聽 port。 */
export const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8787);

/**
 * 目標 Chrome 的 CDP endpoint。Phase 2 主要機制：
 * 使用者以 `--remote-debugging-port=9222` 啟動 Chrome（extension 也載入其中），
 * chrome-devtools-mcp 透過此 URL 連上、驅動「使用者當前分頁」。
 */
export const CDP_BROWSER_URL =
  process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9222";

/** agent 預設 model（claude）。用 CLI 別名（opus/sonnet/haiku）→ 執行時自動解析成該系列最新版。 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "opus";

/** 從 ~/.codex/config.toml 讀 model（codex 未指定 -m 時即用此）。 */
function readCodexModel(): string | undefined {
  try {
    const p = resolve(homedir(), ".codex", "config.toml");
    if (!existsSync(p)) return undefined;
    return readFileSync(p, "utf8").match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];
  } catch {
    return undefined;
  }
}

/** codex model：env > ~/.codex/config.toml > 顯示用佔位字串。 */
export const CODEX_MODEL = process.env.CODEX_MODEL ?? readCodexModel() ?? "(codex 預設)";

/** antigravity model：adapter 不吃 model 參數，僅供顯示；可用 env 指定。 */
export const ANTIGRAVITY_MODEL = process.env.ANTIGRAVITY_MODEL ?? "(CLI 預設)";

/** 測試用 Chrome 執行檔（可用環境變數覆寫）。 */
export const CHROME_BINARY =
  process.env.CHROME_BINARY ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 測試用 Chrome 的獨立 profile 目錄。 */
export const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ?? "/tmp/jt-chrome";

/** 本 extension 目錄（啟動 Chrome 時自動 --load-extension）。 */
export const EXTENSION_PATH =
  process.env.EXTENSION_PATH ??
  resolve(fileURLToPath(import.meta.url), "..", "..", "..", "extension");

/** CDP debug port（從 CDP_BROWSER_URL 解析）。 */
export const CDP_PORT = Number(new URL(CDP_BROWSER_URL).port || 9222);

/** 預設 agent runtime。 */
export const DEFAULT_AGENT = process.env.DEFAULT_AGENT ?? "claude";

/** 產出物（gif / markdown / 暫存 frames）根目錄。隨 AT repo 設定即時變動。 */
export function artifactsDir(): string {
  if (process.env.ARTIFACTS_DIR) return process.env.ARTIFACTS_DIR;
  const p = atRepoPath();
  return p ? resolve(p, "reports", "ai-agent") : resolve(DATA_DIR, "reports", "ai-agent");
}

/**
 * 把 AT repo 的 .env 載進 process.env（不覆寫已存在的值）。
 * 這樣 bridge 與既有框架共用同一份金鑰設定。
 */
export function loadAtEnv(): void {
  const p = atRepoPath();
  if (!p) return; // 未設定 AT repo → 無 .env 可載
  const envPath = resolve(p, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

/** 啟動時的健康檢查，回傳人類可讀的狀態。 */
export function describeConfig(): Record<string, unknown> {
  const p = atRepoPath();
  const envPath = p ? resolve(p, ".env") : "";
  return {
    atRepoPath: p,
    atRepoExists: Boolean(p) && existsSync(p),
    atRepoConfigured: atRepoConfigured(),
    atEnvExists: Boolean(envPath) && existsSync(envPath),
    notionKeyConfigured: Boolean(process.env.NOTION_API_KEY),
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    bridgePort: BRIDGE_PORT,
    cdpBrowserUrl: CDP_BROWSER_URL,
    defaultAgent: DEFAULT_AGENT,
    claudeModel: CLAUDE_MODEL,
    codexModel: CODEX_MODEL,
    antigravityModel: ANTIGRAVITY_MODEL,
    artifactsDir: artifactsDir(),
  };
}

/** 讀取 AT repo 的 mcp.json（chrome-devtools / notion 等設定），供 agent adapter 重用。 */
export function readAtMcpConfig(): unknown | null {
  const repo = atRepoPath();
  if (!repo) return null;
  const p = resolve(repo, ".vscode", "mcp.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
