import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getAgentDefinition, getAgentDefinitionsDescription, listAgentDefinitions, loadSubagentConfig } from "../runtime/config.js";
import { THINKING_LEVELS } from "../runtime/constants.js";
import type { AgentManager } from "../runtime/manager.js";
import type { ThinkingLevel } from "../runtime/types.js";
import type { SpawnModel } from "./models.js";
import { parentSessionId } from "./helpers.js";
import { textResult } from "./output.js";

export interface SpawnToolState {
  cachedSkills: Array<{ name: string; description: string; filePath: string }>;
  activeContext: any;
  spawnModels: Map<string, SpawnModel>;
}

// Getters deliberately read current state: skills, provider, and routes can change.
export function createSpawnAgentTool(pi: ExtensionAPI, manager: AgentManager, state: SpawnToolState) {
  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    get description() {
      const scoped = Boolean(loadSubagentConfig().providerAgents);
      return `Spawn a fresh-context Pi subagent for a concrete task. Automatic extension, skill, and prompt-template discovery is disabled. Agent templates may explicitly configure a provider/model pair, thinking level, tools, skills, and extensions. Omitted template settings inherit from the parent where applicable.
${state.spawnModels.size ? `
A task may run on a model of its own, without a template: \`model\` takes one of the values its schema lists, and \`thinking\` sets the reasoning effort.
` : ""}
Returns after the child accepts its initial task. Continue with independent work instead of waiting; the child's final response will be delivered automatically when ready. Use \`wait_agent\` or \`wait_all_agents\` only when your next action depends on the subagent response and you have no useful work to do meanwhile.

${scoped ? "`agent_type` is required. Choose one configured tier; its provider, model, and thinking level are fixed by the parent's current provider. Generic agents, other providers, and routing overrides are not allowed." : "`agent_type` is optional. Omit it for a generic subagent. Use a template only when the task matches it."}

Available agent templates:
${scoped && state.activeContext?.model?.provider && !listAgentDefinitions(state.activeContext.model.provider).length ? "No subagent tiers configured for this provider." : getAgentDefinitionsDescription(state.activeContext?.model?.provider)}

Available parent skills that may be added by name:
${state.cachedSkills.length ? state.cachedSkills.map((skill) => `- \`${skill.name}\` — ${skill.description}`).join("\n") : "No model-invocable skills are loaded in the parent session."}`;
    },
    get parameters() {
      const scoped = Boolean(loadSubagentConfig().providerAgents);
      return Type.Object({
        task_name: Type.String({ description: "Task name for the new agent. Use letters, digits, underscores, dashes, and optional slash path separators." }),
        message: Type.String({ description: "Initial task for the new agent." }),
        agent_type: scoped
          ? StringEnum(listAgentDefinitions().map((definition) => definition.name), { description: "Required subagent tier. Provider, model, and thinking are fixed by the parent's provider." })
          : Type.Optional(Type.String({ description: "Optional agent template name from ~/.pi/agent/pi-codex-subagents/agents/." })),
        skills: Type.Optional(Type.Array(Type.String(), { description: "Additional skill names from the loaded parent skills listed in this tool description." })),
        ...(!scoped && state.spawnModels.size
          ? {
              model: Type.Optional(StringEnum([...state.spawnModels.keys()], { description: "Optional model for this one task, for example an independent review by another vendor. Defaults to the template model, otherwise the parent model." })),
              thinking: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Optional thinking level. Defaults to the template level, otherwise the parent level." })),
            }
          : {}),
      });
    },
    async execute(_toolCallId: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      const currentModel = ctx.model;
      if (!currentModel?.provider || !currentModel?.id) throw new Error("spawn_agent failed: the parent has no active provider/model pair.");
      if (loadSubagentConfig().providerAgents) {
        if (params.model !== undefined || params.thinking !== undefined) throw new Error("spawn_agent failed: configured tiers do not allow model or thinking overrides.");
        if (!params.agent_type) throw new Error("spawn_agent failed: agent_type is required.");
        const route = getAgentDefinition(params.agent_type, currentModel.provider);
        if (!route?.model) throw new Error(`spawn_agent failed: tier "${params.agent_type}" is not configured for provider "${currentModel.provider}".`);
        const routedModel = ctx.modelRegistry.getAvailable().find((entry: any) => entry.provider === currentModel.provider && entry.id === route.model);
        if (!routedModel) throw new Error(`spawn_agent failed: ${currentModel.provider}/${route.model} is not currently available. Check authentication for this provider; no fallback will be used.`);
        if (route.thinking && !getSupportedThinkingLevels(routedModel).includes(route.thinking)) {
          throw new Error(`spawn_agent failed: ${currentModel.provider}/${route.model} does not support thinking "${route.thinking}".`);
        }
      }
      const requestedSkills: string[] = params.skills ?? [];
      const loadedSkillPaths = Object.fromEntries(state.cachedSkills.map((skill) => [skill.name, skill.filePath]));
      const unavailableSkills = requestedSkills.filter((skill) => !Object.hasOwn(loadedSkillPaths, skill));
      if (unavailableSkills.length) throw new Error(`spawn_agent failed: skills are not loaded in the parent session: ${unavailableSkills.join(", ")}`);
      const model = params.model ? state.spawnModels.get(params.model) : undefined;
      if (params.model && !model) throw new Error(`spawn_agent failed: model "${params.model}" is not in the configured spawn models: ${[...state.spawnModels.keys()].join(", ") || "none"}`);
      if (model && !ctx.modelRegistry.getAvailable().some((entry: any) => entry.provider === model.provider && entry.id === model.modelId)) {
        throw new Error(`spawn_agent failed: model "${params.model}" is not currently available.`);
      }
      try {
        const result = await manager.spawnAgent({
          task_name: params.task_name,
          message: params.message,
          agent_type: params.agent_type,
          skills: requestedSkills,
          loadedSkillPaths,
          cwd: ctx.cwd,
          parentSessionId: parentSessionId(ctx),
          parentSessionFile: ctx.sessionManager.getSessionFile?.(),
          inheritedProvider: currentModel.provider,
          inheritedModelId: currentModel.id,
          inheritedThinking: pi.getThinkingLevel() as ThinkingLevel,
          inheritedTools: pi.getActiveTools().join(","),
          model,
          thinking: params.thinking,
        });
        const info = manager.getAgentInfo(result.task_name, parentSessionId(ctx));
        return textResult(`Spawned ${result.task_name}.`, {
          ...result,
          provider: info.provider,
          modelId: info.modelId,
          thinking: info.thinking,
        });
      } catch (error) {
        throw new Error(`spawn_agent failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) {
      return new Text(theme.fg("toolTitle", theme.bold("spawn_agent ")) + theme.fg("accent", args.task_name || "?") + theme.fg("dim", (args.agent_type ? ` [${args.agent_type}]` : "") + (args.model ? ` ${args.model}` : "")), 0, 0);
    },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", `✗ ${result.content?.[0]?.text || "failed"}`), 0, 0);
      const model = result.details?.provider && result.details?.modelId
        ? ` · ${result.details.provider}/${result.details.modelId}`
        : "";
      const thinking = result.details?.thinking ? ` · ${result.details.thinking}` : "";
      return new Text(theme.fg("success", `✓ ${result.details?.task_name || "spawned"}${model}${thinking}`), 0, 0);
    },
  };
}
