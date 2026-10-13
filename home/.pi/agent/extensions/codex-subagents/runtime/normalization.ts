// Pure validation and text helpers; importable without the Pi runtime.
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_TOOLS, THINKING_LEVELS } from "./constants.js";
import type { AgentCompletionEvent, AgentDefinition, SubagentConfig, ThinkingLevel } from "./types.js";

export function formatAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const errno = error && typeof error === "object" ? (error as { errno?: unknown }).errno : undefined;
  const edquot = os.constants.errno.EDQUOT;
  const quotaExceeded = (typeof edquot === "number" && (errno === edquot || errno === -edquot || message.includes(`system error -${edquot}`)))
    || (error && typeof error === "object" && (error as { code?: unknown }).code === "EDQUOT")
    || /\bEDQUOT\b/.test(message);
  return quotaExceeded && !/disk quota exceeded/i.test(message)
    ? `${message}\nCause: Disk quota exceeded (EDQUOT).`
    : message;
}

export function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Wait canceled.");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export function expandHome(value: string): string {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function stringList(value: unknown): string[] | undefined {
  const entries = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = entries.map((entry) => entry.trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function normalizeProviderAgents(value: unknown): SubagentConfig["providerAgents"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("providerAgents must be an object.");
  const providers = Object.entries(value).map(([provider, tiers]) => {
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) throw new Error(`Invalid providerAgents entry: ${provider}`);
    const routes = Object.entries(tiers).map(([name, value]) => {
      const route = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      if (typeof route.model !== "string" || !route.model.trim() || !isThinkingLevel(route.thinking)) {
        throw new Error(`Invalid providerAgents route: ${provider}/${name}`);
      }
      return [name, { model: route.model.trim(), thinking: route.thinking }] as const;
    });
    return [provider, Object.fromEntries(routes)] as const;
  });
  return Object.fromEntries(providers);
}

export function normalizeConfig(value: unknown): SubagentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const defaultsRaw = raw.defaults && typeof raw.defaults === "object" && !Array.isArray(raw.defaults)
    ? raw.defaults as Record<string, unknown>
    : undefined;
  const defaults = defaultsRaw ? {
    ...(stringList(defaultsRaw.skills) ? { skills: stringList(defaultsRaw.skills) } : {}),
    ...(stringList(defaultsRaw.extensions) ? { extensions: stringList(defaultsRaw.extensions) } : {}),
  } : undefined;
  const retentionDays = typeof raw.retentionDays === "number" && Number.isFinite(raw.retentionDays) && raw.retentionDays >= 0
    ? raw.retentionDays
    : undefined;
  const modelResponseTimeoutMs = typeof raw.modelResponseTimeoutMs === "number"
    && Number.isFinite(raw.modelResponseTimeoutMs)
    && raw.modelResponseTimeoutMs >= 0
    ? raw.modelResponseTimeoutMs
    : undefined;
  return {
    ...(typeof raw.shortcut === "string" && raw.shortcut.trim() ? { shortcut: raw.shortcut.trim() } : {}),
    ...(typeof raw.storageDir === "string" && raw.storageDir.trim() ? { storageDir: raw.storageDir.trim() } : {}),
    ...(retentionDays !== undefined ? { retentionDays } : {}),
    ...(stringList(raw.models) ? { models: stringList(raw.models) } : {}),
    ...(raw.modelsFromEnabledModels === true ? { modelsFromEnabledModels: true } : {}),
    ...(modelResponseTimeoutMs !== undefined ? { modelResponseTimeoutMs } : {}),
    ...(raw.providerAgents !== undefined ? { providerAgents: normalizeProviderAgents(raw.providerAgents) } : {}),
    ...(defaults && Object.keys(defaults).length ? { defaults } : {}),
  };
}

export function normalizeTaskName(name: string): string {
  const normalized = name.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(normalized)) {
    throw new Error("task_name must use letters, digits, underscores, dashes, and optional slash path separators");
  }
  return normalized;
}

export function parseAgentDefinitionText(text: string, fallbackName: string): AgentDefinition {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const attrs: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
      if (entry) attrs[entry[1]] = entry[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return {
    name: attrs.name || fallbackName,
    description: attrs.description,
    hint: attrs.hint || attrs.caller_hint,
    provider: attrs.provider,
    model: attrs.model,
    thinking: isThinkingLevel(attrs.thinking) ? attrs.thinking : undefined,
    tools: attrs.tools,
    skills: stringList(attrs.skills),
    extensions: stringList(attrs.extensions),
    prompt: (match ? text.slice(match[0].length) : text).trim() || undefined,
  };
}

export function normalizeTools(tools: string | undefined): string {
  if (tools === undefined) return DEFAULT_TOOLS;
  return tools.split(",").map((tool) => tool.trim()).filter(Boolean).join(",");
}

export function normalizeList(values?: string[]): string[] | undefined {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
  return normalized.length ? normalized : undefined;
}

export function extractTextFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n\n");
}

export function previewText(text: string | undefined, maxLength = 180): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function canonicalAgentName(target: string): string {
  return target.startsWith("/") ? target : `/${target}`;
}

export function targetMatches(event: AgentCompletionEvent, targets?: Set<string>): boolean {
  return !targets || targets.has(event.agentName);
}

export function consumeFirstMatchingMailboxEvent(events: AgentCompletionEvent[], parentSessionId: string, targets?: Set<string>): AgentCompletionEvent | undefined {
  const index = events.findIndex((event) => event.parentSessionId === parentSessionId && targetMatches(event, targets));
  if (index === -1) return undefined;
  return events.splice(index, 1)[0];
}
