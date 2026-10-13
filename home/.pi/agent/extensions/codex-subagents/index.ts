import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { AgentManager } from "./runtime/manager.js";
import { loadSubagentConfig } from "./runtime/config.js";
import type { AgentCompletionEvent } from "./runtime/types.js";
import { parentSessionId } from "./tools/helpers.js";
import { boundedText } from "./tools/output.js";
import { resolveSpawnModels } from "./tools/models.js";
import { createSpawnAgentTool, type SpawnToolState } from "./tools/spawn.js";
import { registerControlTools } from "./tools/control.js";
import { registerAgentBrowser } from "./ui/browser.js";

// Wire one manager to this extension instance's tools, session events, and UI.
export default function (pi: ExtensionAPI) {
  const widgetKey = "pi-codex-subagents";
  const completionMessageType = "pi-codex-subagent-completion";
  const state: SpawnToolState = { cachedSkills: [], activeContext: undefined, spawnModels: new Map() };
  let cachedSkillsSignature = "";
  const activeAgents = new Set<string>();

  const isCurrentSession = (parentId: string) => {
    try { return state.activeContext && parentSessionId(state.activeContext) === parentId; }
    catch { return false; }
  };

  const refreshAgentWidget = () => {
    if (!state.activeContext || state.activeContext.mode !== "tui") return;
    const running = [...activeAgents];
    if (!running.length) {
      state.activeContext.ui.setWidget(widgetKey, undefined);
      return;
    }
    const label = running.length === 1
      ? `${running[0]} running`
      : `${running.length} subagents running`;
    state.activeContext.ui.setWidget(widgetKey, (_tui: any, theme: Theme) => ({
      render(width: number) {
        const marker = "◌ ";
        const suffix = " · /subagents";
        if (width <= visibleWidth(marker) + visibleWidth(suffix)) {
          return [truncateToWidth(theme.fg("dim", "/subagents"), width, "")];
        }
        const available = width - visibleWidth(marker) - visibleWidth(suffix);
        const clippedLabel = truncateToWidth(label, available, "…");
        return [
          theme.fg("accent", marker) + theme.fg("text", clippedLabel) + theme.fg("dim", suffix),
        ];
      },
      invalidate() {},
    }));
  };

  const deliverCompletion = (event: AgentCompletionEvent) => {
    if (!isCurrentSession(event.parentSessionId)) return;
    const payload = JSON.stringify({
      agent_name: event.agentName,
      status: event.status,
      ...(event.finalResponse !== undefined ? { final_response: event.finalResponse } : {}),
      ...(event.error ? { error: event.error } : {}),
    }, null, 2);
    const bounded = boundedText(payload, DEFAULT_MAX_BYTES - 1024, DEFAULT_MAX_LINES - 4);
    pi.sendMessage({
      customType: completionMessageType,
      content: `<subagent_notification>\n${bounded.text}\n</subagent_notification>`,
      display: true,
      details: {
        agent_name: event.agentName,
        status: event.status,
        ...(bounded.fullOutputPath ? { fullOutputPath: bounded.fullOutputPath } : {}),
      },
    }, { deliverAs: "steer", triggerTurn: true });
  };

  const manager = new AgentManager({
    onActivityChange: (event) => {
      if (!isCurrentSession(event.parentSessionId)) return;
      if (event.active) activeAgents.add(event.agentName);
      else activeAgents.delete(event.agentName);
      refreshAgentWidget();
    },
    onUnclaimedCompletion: deliverCompletion,
  });

  pi.registerMessageRenderer(completionMessageType, (message: any, { expanded }: any, theme: Theme) => {
    const status = message.details?.status;
    const color = status === "completed" ? "success" : status === "failed" ? "error" : "warning";
    let text = theme.fg(color, `${status === "completed" ? "✓" : "✗"} ${message.details?.agent_name || "subagent"} ${status || "finished"}`);
    if (expanded && typeof message.content === "string") text += `\n${theme.fg("dim", message.content)}`;
    return new Text(text, 0, 0);
  });

  const spawnAgentTool = createSpawnAgentTool(pi, manager, state);

  pi.on("session_start", async (_event: any, ctx: any) => {
    state.activeContext = ctx;
    activeAgents.clear();
    try { state.spawnModels = resolveSpawnModels(ctx, loadSubagentConfig()); }
    catch (error: any) { ctx.ui?.notify?.(`spawn_agent model resolution failed, keeping the previous list: ${error?.message || error}`, "warning"); }
    pi.registerTool(spawnAgentTool);
    await manager.ready();
    if (state.activeContext !== ctx) return;
    for (const entry of manager.listAgents(undefined, parentSessionId(ctx))) {
      if (entry.agent_status === "starting" || entry.agent_status === "running") activeAgents.add(entry.agent_name);
    }
    refreshAgentWidget();
  });

  pi.on("model_select", async (_event, ctx) => {
    state.activeContext = ctx;
    pi.registerTool(spawnAgentTool);
  });

  pi.on("before_agent_start", async (event: any, ctx: any) => {
    state.activeContext = ctx;
    const skills = event?.systemPromptOptions?.skills;
    const nextSkills = Array.isArray(skills)
      ? skills
          .filter((skill: any) => !skill?.disableModelInvocation && typeof skill?.name === "string" && typeof skill?.filePath === "string")
          .map((skill: any) => ({ name: skill.name, description: String(skill.description || ""), filePath: skill.filePath }))
      : [];
    const signature = JSON.stringify(nextSkills);
    if (signature !== cachedSkillsSignature) {
      state.cachedSkills = nextSkills;
      cachedSkillsSignature = signature;
      pi.registerTool(spawnAgentTool);
    }
  });

  pi.on("session_shutdown", async () => {
    if (state.activeContext?.mode === "tui") state.activeContext.ui.setWidget(widgetKey, undefined);
    state.activeContext = undefined;
    activeAgents.clear();
    await manager.shutdown();
  });

  pi.registerTool(spawnAgentTool);

  registerControlTools(pi, manager);
  registerAgentBrowser(pi, manager);
}
