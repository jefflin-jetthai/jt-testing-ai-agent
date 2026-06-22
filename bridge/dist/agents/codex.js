/**
 * Codex adapter（OpenAI Codex CLI）。以 `codex exec --json` headless 執行。
 * cwd=AT repo（套用其 AGENTS/上下文）；MCP 以 `-c mcp_servers.*` 設定轉譯。
 */
import { spawn } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
function defaultPath(env = process.env) {
    const home = env.HOME;
    const extras = [
        home ? join(home, ".local", "bin") : "",
        home ? join(home, "bin") : "",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    return [...extras, env.PATH ?? ""].filter(Boolean).join(":");
}
async function canExecute(path) {
    try {
        await access(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function which(cmd, env) {
    return new Promise((resolve) => {
        const p = spawn("which", [cmd], { env });
        let stdout = "";
        p.stdout.on("data", (d) => (stdout += d.toString()));
        p.on("close", (code) => resolve(code === 0 ? stdout.trim().split("\n")[0] || null : null));
        p.on("error", () => resolve(null));
    });
}
async function resolveCodexCommand(env = process.env) {
    const withPath = { ...env, PATH: defaultPath(env) };
    const configured = env.CODEX_BINARY || env.CODEX_BIN;
    if (configured && (await canExecute(configured)))
        return configured;
    const fromPath = await which("codex", withPath);
    if (fromPath)
        return fromPath;
    const home = env.HOME;
    const candidates = [
        home ? join(home, ".local", "bin", "codex") : "",
        home ? join(home, ".npm-global", "bin", "codex") : "",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
    ].filter(Boolean);
    for (const c of candidates)
        if (await canExecute(c))
            return c;
    return null;
}
/** 把 mcp.json 轉成 codex 的 `-c mcp_servers.<name>.*` 參數。 */
function tomlString(value) {
    return JSON.stringify(String(value));
}
function tomlArray(values) {
    return `[${values.map((v) => tomlString(v)).join(", ")}]`;
}
function tomlKey(key) {
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}
function tomlInlineTable(obj) {
    const entries = Object.entries(obj).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`);
    return `{ ${entries.join(", ")} }`;
}
function mcpToCodexArgs(mcpConfigPath) {
    if (!mcpConfigPath)
        return [];
    try {
        const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
        const servers = cfg.mcpServers ?? {};
        const args = [];
        for (const [name, def] of Object.entries(servers)) {
            if (def.command)
                args.push("-c", `mcp_servers.${name}.command=${tomlString(def.command)}`);
            if (Array.isArray(def.args))
                args.push("-c", `mcp_servers.${name}.args=${tomlArray(def.args)}`);
            if (def.env && typeof def.env === "object") {
                args.push("-c", `mcp_servers.${name}.env=${tomlInlineTable(def.env)}`);
            }
        }
        return args;
    }
    catch {
        return [];
    }
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "..." : s;
}
function summarizeItem(item) {
    if (!item || typeof item !== "object")
        return null;
    if (item.type === "agent_message" && typeof item.text === "string") {
        return { kind: "result", text: item.text };
    }
    if (item.type === "reasoning") {
        const text = item.text ??
            item.summary?.map?.((s) => s.text ?? "").filter(Boolean).join("\n") ??
            "";
        return text ? { kind: "text", text } : null;
    }
    if (item.type?.includes?.("tool") || item.type === "function_call") {
        const name = item.name ?? item.call?.name ?? item.type;
        const input = item.arguments ?? item.input ?? item.call?.arguments;
        const suffix = input ? ` ${truncate(typeof input === "string" ? input : JSON.stringify(input), 120)}` : "";
        return { kind: "tool", text: `${name}${suffix}` };
    }
    if (item.type === "command_execution") {
        return { kind: "tool", text: truncate(item.command ?? JSON.stringify(item), 160) };
    }
    return null;
}
function summarizeEvent(evt) {
    if (!evt || typeof evt !== "object")
        return null;
    if (evt.type === "thread.started")
        return { kind: "system", text: `[codex] thread=${evt.thread_id ?? "started"}` };
    if (evt.type === "turn.started")
        return { kind: "system", text: "[codex] turn started" };
    if (evt.type === "turn.completed")
        return { kind: "system", text: "[codex] turn completed" };
    if (evt.type === "turn.failed" || evt.type === "error") {
        const message = evt.error?.message ?? evt.message ?? JSON.stringify(evt);
        return { kind: "stderr", text: message };
    }
    if (evt.type === "item.completed" || evt.type === "item.started")
        return summarizeItem(evt.item);
    // Backward-compatible parsing for older/newer Codex JSONL envelopes.
    const msg = evt.msg ?? evt;
    if (msg !== evt)
        return summarizeEvent(msg);
    if (msg.type?.includes?.("tool") || msg.type === "function_call") {
        return { kind: "tool", text: msg.name ?? msg.type };
    }
    if (typeof msg.text === "string")
        return { kind: "text", text: msg.text };
    if (typeof msg.message === "string")
        return { kind: "text", text: msg.message };
    return null;
}
function isNoisyCodexWarning(line) {
    return (line === "Reading additional input from stdin..." ||
        /WARN codex_core_plugins::manifest: ignoring interface\.defaultPrompt/.test(line) ||
        /WARN codex_core_skills::loader: ignoring interface\.icon_/.test(line) ||
        /WARN codex_rollout::list: state db discrepancy/.test(line));
}
export class CodexAdapter {
    name = "codex";
    commandPath;
    async command() {
        if (this.commandPath !== undefined)
            return this.commandPath;
        this.commandPath = await resolveCodexCommand();
        return this.commandPath;
    }
    async isAvailable() {
        return Boolean(await this.command());
    }
    async run(opts) {
        const command = await this.command();
        if (!command)
            return { ok: false, finalText: "codex CLI 不存在或不可用" };
        const args = [
            "exec",
            "--json",
            "--ephemeral",
            "--dangerously-bypass-approvals-and-sandbox",
            "-C",
            opts.cwd,
            ...mcpToCodexArgs(opts.mcpConfigPath),
        ];
        if (opts.model)
            args.push("-m", opts.model);
        const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
        args.push(fullPrompt);
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                cwd: opts.cwd,
                env: { ...process.env, PATH: defaultPath(process.env) },
                stdio: ["ignore", "pipe", "pipe"],
            });
            let finalText = "";
            let sawFailure = false;
            const rl = createInterface({ input: child.stdout });
            rl.on("line", (line) => {
                const t = line.trim();
                if (!t)
                    return;
                let evt;
                try {
                    evt = JSON.parse(t);
                }
                catch {
                    opts.onEvent({ kind: "text", text: t });
                    return;
                }
                const out = summarizeEvent(evt);
                if (!out)
                    return;
                if (out.kind === "result")
                    finalText = out.text;
                if (out.kind === "stderr")
                    sawFailure = true;
                opts.onEvent({ kind: out.kind, text: out.kind === "tool" ? `🔧 ${out.text}` : out.text, raw: evt });
            });
            child.stderr.on("data", (d) => {
                for (const line of d.toString().split("\n").map((s) => s.trim()).filter(Boolean)) {
                    if (!isNoisyCodexWarning(line))
                        opts.onEvent({ kind: "stderr", text: line });
                }
            });
            opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
            child.on("error", (err) => {
                opts.onEvent({ kind: "stderr", text: `spawn error: ${err.message}` });
                resolve({ ok: false, finalText: err.message });
            });
            child.on("close", (code) => resolve({ ok: code === 0 && !sawFailure, finalText }));
        });
    }
}
//# sourceMappingURL=codex.js.map