/** Agent registry：依名稱取得 adapter（可插拔）。 */
import type { AgentAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { AntigravityAdapter } from "./antigravity.js";

const registry = new Map<string, AgentAdapter>();
registry.set("claude", new ClaudeAdapter());
registry.set("codex", new CodexAdapter());
registry.set("antigravity", new AntigravityAdapter());

/** 回傳目前環境實際可用（CLI 存在）的 agent 名稱。 */
export async function availableAgents(): Promise<string[]> {
  const out: string[] = [];
  for (const [name, a] of registry) if (await a.isAvailable()) out.push(name);
  return out;
}

export function getAgent(name?: string): AgentAdapter {
  const key = (name ?? "claude").toLowerCase();
  const adapter = registry.get(key);
  if (!adapter) {
    throw new Error(`未知或尚未支援的 agent: ${name}（目前支援：${[...registry.keys()].join(", ")}）`);
  }
  return adapter;
}

export function listAgents(): string[] {
  return [...registry.keys()];
}

export type { AgentAdapter } from "./types.js";
