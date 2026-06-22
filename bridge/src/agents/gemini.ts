/**
 * Gemini adapter（Google Gemini CLI）。以 `gemini -p --output-format stream-json --yolo` headless 執行。
 * cwd=AT repo（套用其 GEMINI.md）。
 *
 * 註：Claude 為完整驗證路徑；Gemini 為可插拔示範。chrome-devtools MCP 需於
 * Gemini settings 設定（gemini mcp add），此處以 --allowed-mcp-server-names 放行已設定者。
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { augmentedEnv, commandExists } from "./env.js";
import type { AgentAdapter, AgentResult, AgentRunOptions } from "./types.js";

export class GeminiAdapter implements AgentAdapter {
  readonly name = "gemini";

  isAvailable(): Promise<boolean> {
    return commandExists("gemini");
  }

  run(opts: AgentRunOptions): Promise<AgentResult> {
    const args = ["--output-format", "stream-json", "--yolo"];
    if (opts.model) args.push("-m", opts.model);
    // chrome-devtools 需已於 gemini settings 設定；放行之
    if (opts.mcpConfigPath) args.push("--allowed-mcp-server-names", "chrome-devtools");
    const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
    args.push("-p", fullPrompt);

    return new Promise((resolve) => {
      const child = spawn("gemini", args, { cwd: opts.cwd, env: augmentedEnv() });
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
        const content = evt.content ?? evt.text ?? evt.message;
        if (evt.type === "tool_use" || evt.toolCall) {
          opts.onEvent({ kind: "tool", text: `🔧 ${evt.name ?? evt.toolCall?.name ?? "tool"}`, raw: evt });
        } else if (typeof content === "string" && content.trim()) {
          if (evt.type === "result" || evt.type === "final") finalText = content;
          opts.onEvent({ kind: content && evt.type === "result" ? "result" : "text", text: content, raw: evt });
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
