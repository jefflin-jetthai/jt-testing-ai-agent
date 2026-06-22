/**
 * Codex adapter（OpenAI Codex CLI）。以 `codex exec --json` headless 執行。
 * cwd=AT repo（套用其 AGENTS/上下文）；MCP 以 `-c mcp_servers.*` 設定轉譯。
 *
 * 註：Claude 為完整驗證路徑；Codex 為可插拔示範，瀏覽器驅動整合屬實驗性。
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentResult, AgentRunOptions } from "./types.js";

async function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd]);
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

/** 把 mcp.json 轉成 codex 的 `-c mcp_servers.<name>.*` 參數。 */
function mcpToCodexArgs(mcpConfigPath?: string): string[] {
  if (!mcpConfigPath) return [];
  try {
    const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
    const servers = cfg.mcpServers ?? {};
    const args: string[] = [];
    for (const [name, def] of Object.entries<any>(servers)) {
      if (def.command) args.push("-c", `mcp_servers.${name}.command=${JSON.stringify(def.command)}`);
      if (def.args) args.push("-c", `mcp_servers.${name}.args=${JSON.stringify(def.args)}`);
    }
    return args;
  } catch {
    return [];
  }
}

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";

  isAvailable(): Promise<boolean> {
    return commandExists("codex");
  }

  run(opts: AgentRunOptions): Promise<AgentResult> {
    const args = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      opts.cwd,
      ...mcpToCodexArgs(opts.mcpConfigPath),
    ];
    if (opts.model) args.push("-m", opts.model);
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
    args.push(fullPrompt);

    return new Promise((resolve) => {
      const child = spawn("codex", args, { cwd: opts.cwd, env: process.env });
      let finalText = "";

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        const t = line.trim();
        if (!t) return;
        let evt: any;
        try {
          evt = JSON.parse(t);
        } catch {
          opts.onEvent({ kind: "text", text: t });
          return;
        }
        // codex JSONL：盡力抽出可讀訊息
        const msg = evt.msg ?? evt;
        if (msg.type?.includes("tool") || msg.type === "function_call") {
          opts.onEvent({ kind: "tool", text: `🔧 ${msg.name ?? msg.type}`, raw: evt });
        } else if (typeof msg.text === "string") {
          finalText = msg.text;
          opts.onEvent({ kind: "text", text: msg.text, raw: evt });
        } else if (typeof msg.message === "string") {
          opts.onEvent({ kind: "text", text: msg.message, raw: evt });
        }
      });

      child.stderr.on("data", (d) => opts.onEvent({ kind: "stderr", text: d.toString().trim() }));
      opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      child.on("error", (err) => {
        opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
        resolve({ ok: false, finalText: err.message });
      });
      child.on("close", (code) => resolve({ ok: code === 0, finalText }));
    });
  }
}
