import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_SUBAGENT_SYSTEM_PROMPT } from "./constants.js";
import { AGENTS_DIR, CONFIG_PATH, SOCKET_DIR, SUBAGENT_DIR, SYSTEM_PROMPT_PATH, ensurePrivateDir } from "./paths.js";
import { expandHome, normalizeConfig, parseAgentDefinitionText } from "./normalization.js";
import type { AgentDefinition, SubagentConfig } from "./types.js";

export function loadSubagentConfig(): SubagentConfig {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  // Fail closed: invalid routing must never silently inherit the parent's model.
  return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
}

export function getRunsDir(): string {
  const configured = loadSubagentConfig().storageDir;
  if (configured) {
    const expanded = expandHome(configured);
    return path.isAbsolute(expanded) ? expanded : path.resolve(SUBAGENT_DIR, expanded);
  }
  return path.join(SUBAGENT_DIR, "runs");
}

function ensureSystemPromptFile(): void {
  if (fs.existsSync(SYSTEM_PROMPT_PATH)) return;
  try {
    fs.writeFileSync(SYSTEM_PROMPT_PATH, DEFAULT_SUBAGENT_SYSTEM_PROMPT, { flag: "wx", mode: 0o600 });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }
}

export function readSystemPrompt(): string {
  ensureSystemPromptFile();
  const prompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  if (!prompt.trim()) throw new Error(`Subagent system prompt is empty: ${SYSTEM_PROMPT_PATH}`);
  return prompt;
}

export function ensureBaseDirs(): void {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  ensureSystemPromptFile();
  ensurePrivateDir(getRunsDir(), !loadSubagentConfig().storageDir);
  ensurePrivateDir(SOCKET_DIR, true);
}

export function listAgentDefinitions(provider?: string): AgentDefinition[] {
  const routes = loadSubagentConfig().providerAgents;
  if (routes) {
    if (!provider) {
      return [...new Set(Object.values(routes).flatMap((tiers) => Object.keys(tiers)))].map((name) => ({ name }));
    }
    return Object.entries(Object.hasOwn(routes, provider) ? routes[provider] : {}).map(([name, route]) => ({
      name,
      provider,
      model: route.model,
      thinking: route.thinking,
    }));
  }
  ensureBaseDirs();
  const definitions: AgentDefinition[] = [];
  for (const name of fs.readdirSync(AGENTS_DIR)) {
    if (!name.endsWith(".md")) continue;
    try {
      definitions.push(parseAgentDefinitionText(fs.readFileSync(path.join(AGENTS_DIR, name), "utf8"), name.replace(/\.md$/, "")));
    } catch {}
  }
  return definitions.sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentDefinition(name?: string, provider?: string): AgentDefinition | undefined {
  return name ? listAgentDefinitions(provider).find((definition) => definition.name === name) : undefined;
}

export function getAgentDefinitionsDescription(provider?: string): string {
  const definitions = listAgentDefinitions(provider);
  if (!definitions.length) return "None configured, so omit `agent_type`.";
  return definitions.map((definition) => {
    let line = `- \`${definition.name}\`${definition.description ? ` — ${definition.description}` : ""}`;
    if (definition.provider && definition.model) line += ` — model: ${definition.provider}/${definition.model}`;
    if (definition.thinking) line += ` — thinking: ${definition.thinking}`;
    if (definition.extensions?.length) line += ` — extensions: ${definition.extensions.join(", ")}`;
    return definition.hint ? `${line}\n  Caller hint: ${definition.hint}` : line;
  }).join("\n");
}
