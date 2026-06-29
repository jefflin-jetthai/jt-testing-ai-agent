/**
 * Antigravity adapter（Google Antigravity CLI）。
 *
 * 以本機 `antigravity`（或 `agy`）CLI headless 執行；cwd=AT repo。
 *
 * 註：Antigravity 的 headless 呼叫旗標可用環境變數覆寫，避免寫死：
 *   - ANTIGRAVITY_BIN  指定執行檔（預設找 antigravity / agy）
 *   - ANTIGRAVITY_ARGS 指定旗標（JSON 陣列；prompt 會接在最後），預設 ["-p"]
 * 例如：ANTIGRAVITY_ARGS='["agent","run","--prompt"]'
 */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { augmentedEnv, defaultPath } from "./env.js";
import type { AgentAdapter, AgentResult, AgentRunOptions } from "./types.js";

async function canExecute(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd], { env });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => resolve(code === 0 ? out.trim().split("\n")[0] || null : null));
    p.on("error", () => resolve(null));
  });
}

async function resolveCommand(env = process.env): Promise<string | null> {
  const withPath = { ...env, PATH: defaultPath(env) };
  if (env.ANTIGRAVITY_BIN && (await canExecute(env.ANTIGRAVITY_BIN))) return env.ANTIGRAVITY_BIN;
  for (const name of ["agy", "antigravity"]) {
    const hit = await which(name, withPath);
    if (hit) return hit;
  }
  const home = env.HOME;
  const candidates = [
    home ? join(home, ".antigravity", "antigravity", "bin", "agy") : "",
    home ? join(home, ".antigravity", "antigravity", "bin", "antigravity") : "",
  ].filter(Boolean);
  for (const c of candidates) if (await canExecute(c)) return c;
  return null;
}

function baseArgs(): string[] {
  const raw = process.env.ANTIGRAVITY_ARGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* 忽略，用預設 */
    }
  }
  return ["-p"]; // 預設 headless 旗標；可用 ANTIGRAVITY_ARGS 覆寫
}

export class AntigravityAdapter implements AgentAdapter {
  readonly name = "antigravity";
  private cmd: string | null | undefined;

  private async command(): Promise<string | null> {
    if (this.cmd !== undefined) return this.cmd;
    this.cmd = await resolveCommand();
    return this.cmd;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.command());
  }

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const command = await this.command();
    if (!command) return { ok: false, finalText: "antigravity CLI 不存在或不可用" };

    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
    const args = [...baseArgs(), fullPrompt];

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: augmentedEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let finalText = "";
      let errorText = ""; // 失敗訊息（額度/認證等）；finalText 為空時帶出供報告/診斷

      const rl = createInterface({ input: child.stdout! });
      rl.on("line", (line) => {
        const t = line.trim();
        if (!t) return;
        try {
          const evt = JSON.parse(t);
          const content = evt.content ?? evt.text ?? evt.message;
          if (typeof content === "string" && content.trim()) {
            finalText = content;
            opts.onEvent({ kind: "text", text: content, raw: evt });
          }
        } catch {
          finalText = t;
          opts.onEvent({ kind: "text", text: t });
        }
      });

      child.stderr.on("data", (d) => {
        const text = d.toString().trim();
        if (text) errorText = text; // 保留最後一段 stderr（通常即終止錯誤）
        opts.onEvent({ kind: "stderr", text });
      });
      opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      child.on("error", (err) => {
        opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
        resolve({ ok: false, finalText: err.message });
      });
      child.on("close", (code) => resolve({ ok: code === 0, finalText: finalText || errorText }));
    });
  }
}
