// Resolve the configured spawn allowlist without importing the Pi runtime.
import { THINKING_LEVELS } from "../runtime/constants.js";
import type { SubagentConfig } from "../runtime/types.js";

export type SpawnModel = { provider: string; modelId: string };

export function exactPair(pattern: string): SpawnModel | undefined {
  const colon = pattern.lastIndexOf(":");
  const reference = colon > 0 && (THINKING_LEVELS as readonly string[]).includes(pattern.slice(colon + 1)) ? pattern.slice(0, colon) : pattern;
  const slash = reference.indexOf("/");
  if (slash <= 0 || /[*?[\]]/.test(reference)) return undefined;
  return { provider: reference.slice(0, slash), modelId: reference.slice(slash + 1) };
}

export function resolveSpawnModels(ctx: any, config: SubagentConfig) {
  const models = new Map<string, SpawnModel>();
  if (config.providerAgents) return models;
  const available = new Set(ctx.modelRegistry.getAvailable().map((model: any) => `${model.provider}/${model.id}`));
  const unavailable: string[] = [];
  for (const entry of config.models ?? []) {
    const pair = exactPair(entry);
    if (pair && available.has(`${pair.provider}/${pair.modelId}`)) models.set(`${pair.provider}/${pair.modelId}`, pair);
    else unavailable.push(entry);
  }
  if (config.modelsFromEnabledModels) {
    for (const { model } of ctx.scopedModels ?? []) models.set(`${model.provider}/${model.id}`, { provider: model.provider, modelId: model.id });
  }
  if (unavailable.length) ctx.ui?.notify?.(`spawn_agent models not available: ${unavailable.join(", ")}`, "warning");
  return models;
}
