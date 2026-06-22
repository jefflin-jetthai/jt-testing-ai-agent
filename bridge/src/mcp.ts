/**
 * 產生給 agent 用的 MCP 設定檔（暫存）。
 * 目前掛 chrome-devtools-mcp，連到使用者以 --remote-debugging-port 啟動的 Chrome，
 * 讓 agent 能驅動「當前分頁」。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_PORT, CDP_BROWSER_URL } from "./config.js";

/** chrome-devtools MCP 工具的 allowedTools glob。 */
export const CHROME_DEVTOOLS_TOOLS = ["mcp__chrome-devtools"];

/** 自建 browser-mcp 工具的 allowedTools glob（attach 模式用）。 */
export const JT_BROWSER_TOOLS = ["mcp__jt-browser"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_MCP_PATH = resolve(__dirname, "..", "browser-mcp.mjs");

/**
 * attach 模式的 MCP 設定：掛自建 jt-browser（Runtime.evaluate based），
 * 經 bridge /agent-cdp → extension chrome.debugger 驅動當前分頁。繞開 puppeteer。
 */
export function writeBrowserMcpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "jt-ai-bmcp-"));
  const path = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      "jt-browser": {
        command: "node",
        args: [BROWSER_MCP_PATH],
        env: { JT_BRIDGE_CDP_URL: `ws://localhost:${BRIDGE_PORT}/agent-cdp` },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

export function writeMcpConfig(browserUrl: string = CDP_BROWSER_URL): string {
  const dir = mkdtempSync(join(tmpdir(), "jt-ai-mcp-"));
  const path = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest", "--browser-url", browserUrl],
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

/** 檢查 CDP endpoint 是否可連，並回傳分頁清單（給目標分頁比對 / 錯誤提示）。 */
export async function probeCdp(
  browserUrl: string = CDP_BROWSER_URL,
): Promise<{ ok: boolean; version?: string; pages?: { url: string; title: string }[]; error?: string }> {
  try {
    const ver = (await fetch(`${browserUrl}/json/version`).then((r) => r.json())) as {
      Browser?: string;
    };
    const list = await fetch(`${browserUrl}/json/list`)
      .then((r) => r.json())
      .catch(() => []);
    const pages = (Array.isArray(list) ? list : [])
      .filter((t: any) => t.type === "page")
      .map((t: any) => ({ url: t.url, title: t.title }));
    return { ok: true, version: ver.Browser, pages };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
