/**
 * Claude adapter：以 `claude -p --output-format stream-json` headless 執行。
 * cwd 設為 AT repo → 自動套用其 CLAUDE.md（測試撰寫 skill / Locators / 等待策略）。
 *
 * 認證：claude CLI 使用自身登入（不依賴 AT .env 的 ANTHROPIC_API_KEY）。
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
async function commandExists(cmd) {
    return new Promise((resolve) => {
        const p = spawn("which", [cmd]);
        p.on("close", (code) => resolve(code === 0));
        p.on("error", () => resolve(false));
    });
}
/** 從 stream-json 的一行事件抽出可讀文字並分類。 */
function interpret(evt) {
    if (!evt || typeof evt !== "object")
        return null;
    switch (evt.type) {
        case "system":
            return { kind: "system", text: `[init] model=${evt.model ?? "?"} tools=${(evt.tools?.length ?? 0)}` };
        case "assistant": {
            const blocks = evt.message?.content ?? [];
            const parts = [];
            let kind = "text";
            for (const b of blocks) {
                if (b.type === "text" && b.text)
                    parts.push(b.text);
                else if (b.type === "tool_use") {
                    kind = "tool";
                    parts.push(`🔧 ${b.name}(${summarizeInput(b.input)})`);
                }
            }
            const text = parts.join("\n").trim();
            return text ? { kind, text } : null;
        }
        case "user": {
            // tool_result（執行結果回饋）
            const blocks = evt.message?.content ?? [];
            const parts = [];
            for (const b of blocks) {
                if (b.type === "tool_result") {
                    const c = Array.isArray(b.content)
                        ? b.content.map((x) => x.text ?? "").join(" ")
                        : String(b.content ?? "");
                    if (c.trim())
                        parts.push(`↳ ${truncate(c.trim(), 200)}`);
                }
            }
            const text = parts.join("\n");
            return text ? { kind: "tool", text } : null;
        }
        case "result":
            return { kind: "result", text: evt.result ?? evt.subtype ?? "(done)" };
        default:
            return null;
    }
}
function summarizeInput(input) {
    if (!input || typeof input !== "object")
        return "";
    const obj = input;
    const keys = ["url", "selector", "uid", "text", "value", "key"];
    for (const k of keys)
        if (obj[k] != null)
            return `${k}=${truncate(String(obj[k]), 60)}`;
    return truncate(JSON.stringify(obj), 60);
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
export class ClaudeAdapter {
    name = "claude";
    isAvailable() {
        return commandExists("claude");
    }
    run(opts) {
        const args = [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
        ];
        if (opts.mcpConfigPath) {
            args.push("--mcp-config", opts.mcpConfigPath, "--strict-mcp-config");
        }
        if (opts.allowedTools?.length)
            args.push("--allowedTools", ...opts.allowedTools);
        if (opts.model)
            args.push("--model", opts.model);
        if (opts.systemPrompt)
            args.push("--append-system-prompt", opts.systemPrompt);
        args.push(opts.prompt);
        return new Promise((resolve) => {
            const child = spawn("claude", args, {
                cwd: opts.cwd,
                env: process.env,
            });
            let finalText = "";
            let ok = false;
            const rl = createInterface({ input: child.stdout });
            rl.on("line", (line) => {
                const trimmed = line.trim();
                if (!trimmed)
                    return;
                let evt;
                try {
                    evt = JSON.parse(trimmed);
                }
                catch {
                    return; // 忽略非 JSON 行（含 partial 噪音）
                }
                const out = interpret(evt);
                if (!out)
                    return;
                if (out.kind === "result") {
                    finalText = out.text;
                    ok = !evt.is_error;
                }
                opts.onEvent({ kind: out.kind, text: out.text, raw: evt });
            });
            child.stderr.on("data", (d) => opts.onEvent({ kind: "stderr", text: d.toString().trim() }));
            if (opts.signal) {
                opts.signal.addEventListener("abort", () => child.kill("SIGTERM"), {
                    once: true,
                });
            }
            child.on("error", (err) => {
                opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
                resolve({ ok: false, finalText: err.message });
            });
            child.on("close", () => resolve({ ok, finalText }));
        });
    }
}
//# sourceMappingURL=claude.js.map