/**
 * Agent CLI 的 PATH 補強。
 * bridge 被 Chrome native host 自動啟動時，繼承的 PATH 很精簡，
 * 常找不到裝在 ~/.local/bin、/opt/homebrew/bin 等處的 CLI（如 claude）。
 * 這裡補上常見安裝路徑，供 which / spawn 使用。
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

export function defaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  const extras = [
    home ? join(home, ".local", "bin") : "",
    home ? join(home, "bin") : "",
    home ? join(home, ".npm-global", "bin") : "",
    home ? join(home, ".antigravity", "antigravity", "bin") : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...extras, env.PATH ?? ""].filter(Boolean).join(":");
}

/** 補強 PATH 後的 env，供 spawn 使用。 */
export function augmentedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: defaultPath(env) };
}

/** 以補強後的 PATH 檢查命令是否存在。 */
export function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd], { env: augmentedEnv() });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}
