/**
 * Bridge 設定。所有可調整的路徑 / port 集中於此。
 *
 * 憑證（NOTION_API_KEY / ANTHROPIC_API_KEY ...）不另存，
 * 一律從 AT repo 的 .env 載入（見 loadAtEnv）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
/** bridge 本地設定檔（由 UI 寫入，例如 AT_REPO_PATH）。 */
export const BRIDGE_CONFIG_FILE = resolve(fileURLToPath(import.meta.url), "..", "..", ".jt-bridge.json");
function readBridgeConfig() {
    try {
        return existsSync(BRIDGE_CONFIG_FILE)
            ? JSON.parse(readFileSync(BRIDGE_CONFIG_FILE, "utf8"))
            : {};
    }
    catch {
        return {};
    }
}
const FILE_CONFIG = readBridgeConfig();
/** 合併寫入本地設定檔（UI 設定用）。下次啟動 bridge 生效。 */
export function saveBridgeConfig(patch) {
    const merged = { ...readBridgeConfig(), ...patch };
    writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(merged, null, 2));
}
/**
 * automatic-testing 本地 clone 路徑。
 * 優先序：環境變數 > UI 設定檔 > 預設。
 */
export const AT_REPO_PATH = process.env.AT_REPO_PATH ??
    FILE_CONFIG.AT_REPO_PATH ??
    "/Users/jefflin/gitProject/automatic-testing";
/** Bridge WebSocket / HTTP 監聽 port。 */
export const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8787);
/** CDP proxy 監聽 port（給 chrome-devtools-mcp 的 --browser-url 用）。 */
export const CDP_PROXY_PORT = Number(process.env.CDP_PROXY_PORT ?? 9333);
/**
 * 目標 Chrome 的 CDP endpoint。Phase 2 主要機制：
 * 使用者以 `--remote-debugging-port=9222` 啟動 Chrome（extension 也載入其中），
 * chrome-devtools-mcp 透過此 URL 連上、驅動「使用者當前分頁」。
 */
export const CDP_BROWSER_URL = process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9222";
/** agent 預設 model（claude）。 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
/** 測試用 Chrome 執行檔（可用環境變數覆寫）。 */
export const CHROME_BINARY = process.env.CHROME_BINARY ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** 測試用 Chrome 的獨立 profile 目錄。 */
export const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR ?? "/tmp/jt-chrome";
/** 本 extension 目錄（啟動 Chrome 時自動 --load-extension）。 */
export const EXTENSION_PATH = process.env.EXTENSION_PATH ??
    resolve(fileURLToPath(import.meta.url), "..", "..", "..", "extension");
/** CDP debug port（從 CDP_BROWSER_URL 解析）。 */
export const CDP_PORT = Number(new URL(CDP_BROWSER_URL).port || 9222);
/** 預設 agent runtime。 */
export const DEFAULT_AGENT = process.env.DEFAULT_AGENT ?? "claude";
/** 產出物（gif / markdown / 暫存 frames）根目錄。 */
export const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? resolve(AT_REPO_PATH, "reports", "ai-agent");
/**
 * 把 AT repo 的 .env 載進 process.env（不覆寫已存在的值）。
 * 這樣 bridge 與既有框架共用同一份金鑰設定。
 */
export function loadAtEnv() {
    const envPath = resolve(AT_REPO_PATH, ".env");
    if (existsSync(envPath)) {
        loadDotenv({ path: envPath });
    }
}
/** 啟動時的健康檢查，回傳人類可讀的狀態。 */
export function describeConfig() {
    const envPath = resolve(AT_REPO_PATH, ".env");
    return {
        atRepoPath: AT_REPO_PATH,
        atRepoExists: existsSync(AT_REPO_PATH),
        atEnvExists: existsSync(envPath),
        notionKeyConfigured: Boolean(process.env.NOTION_API_KEY),
        anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
        bridgePort: BRIDGE_PORT,
        cdpProxyPort: CDP_PROXY_PORT,
        cdpBrowserUrl: CDP_BROWSER_URL,
        defaultAgent: DEFAULT_AGENT,
        artifactsDir: ARTIFACTS_DIR,
    };
}
/** 讀取 AT repo 的 mcp.json（chrome-devtools / notion 等設定），供 agent adapter 重用。 */
export function readAtMcpConfig() {
    const p = resolve(AT_REPO_PATH, ".vscode", "mcp.json");
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=config.js.map