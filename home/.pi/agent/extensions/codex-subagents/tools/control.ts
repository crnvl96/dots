import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentManager } from "../runtime/manager.js";
import { cleanTarget, parentSessionId, parseTargets } from "./helpers.js";
import { boundedTextResult, textResult } from "./output.js";

export function registerControlTools(pi: ExtensionAPI, manager: AgentManager) {
  pi.registerTool({
    name: "wait_agent",
    label: "Wait Agent",
    description: "Wait for one session-owned agent completion, or for the next completion if targets is omitted. Use only when your next action depends on that response; otherwise continue working and let completion arrive automatically. Returns one final response. Use wait_all_agents when every target must finish.",
    parameters: Type.Object({
      targets: Type.Optional(Type.Array(Type.String(), { description: "Agent task names to wait on. Omit to wait for the next completion in this parent session." })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      try {
        const result = await manager.waitAgent(parentSessionId(ctx), parseTargets(params.targets), signal);
        return boundedTextResult(JSON.stringify(result, null, 2), { message: result.message });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`wait_agent failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) {
      const targets = Array.isArray(args.targets) && args.targets.length ? args.targets.join(",") : "any";
      return new Text(theme.fg("toolTitle", theme.bold("wait_agent ")) + theme.fg("accent", targets), 0, 0);
    },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", "✗ wait failed"), 0, 0);
      return new Text(theme.fg("success", result.details?.message || "done"), 0, 0);
    },
  });

  pi.registerTool({
    name: "wait_all_agents",
    label: "Wait All Agents",
    description: "Wait until all targeted session-owned agents reach a final status. Use only when your next action depends on every response; otherwise continue working and let completions arrive automatically. Returns their final text responses.",
    parameters: Type.Object({
      targets: Type.Optional(Type.Array(Type.String(), { description: "Agent task names to wait for. Omit to wait for agents spawned by this extension instance." })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      try {
        const result = await manager.waitAllAgents(parentSessionId(ctx), parseTargets(params.targets), signal);
        return boundedTextResult(JSON.stringify(result, null, 2), { message: result.message });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`wait_all_agents failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) {
      const targets = Array.isArray(args.targets) && args.targets.length ? args.targets.join(",") : "all";
      return new Text(theme.fg("toolTitle", theme.bold("wait_all_agents ")) + theme.fg("accent", targets), 0, 0);
    },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", "✗ wait failed"), 0, 0);
      return new Text(theme.fg("success", result.details?.message || "done"), 0, 0);
    },
  });

  pi.registerTool({
    name: "list_agents",
    label: "List Agents",
    description: "List compact agent names and statuses for the current parent session, newest first with active agents prioritized. Returns 10 by default; use offset for another page or path_prefix to narrow the result. Set include_all only for an explicit read-only historical listing across parent sessions.",
    parameters: Type.Object({
      path_prefix: Type.Optional(Type.String({ description: "Task-path prefix filter without a trailing slash." })),
      include_all: Type.Optional(Type.Boolean({ description: "Include agents from all parent sessions and show parent_session_id. Default false." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum agents to return. Default 10; maximum 100." })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based offset into the compact ordered result. Default 0." })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      const listed = manager.listAgents(params.path_prefix, parentSessionId(ctx), params.include_all === true);
      const ordered = [
        ...listed.filter((agent) => agent.agent_status === "starting" || agent.agent_status === "running"),
        ...listed.filter((agent) => agent.agent_status !== "starting" && agent.agent_status !== "running"),
      ];
      const limit = Number.isInteger(params.limit) ? Math.max(1, Math.min(100, params.limit)) : 10;
      const offset = Number.isInteger(params.offset) ? Math.max(0, params.offset) : 0;
      const agents = ordered.slice(offset, offset + limit).map(({ agent_name, agent_status, parent_session_id }) => ({
        agent_name,
        agent_status,
        ...(parent_session_id ? { parent_session_id } : {}),
      }));
      const nextOffset = offset + agents.length < ordered.length ? offset + agents.length : null;
      const result = { total: ordered.length, returned: agents.length, offset, limit, next_offset: nextOffset, agents };
      return textResult(JSON.stringify(result, null, 2), result);
    },
    renderCall(_args: any, theme: Theme) { return new Text(theme.fg("toolTitle", theme.bold("list_agents")), 0, 0); },
    renderResult(result: any, options: any, theme: Theme) {
      const agents = result.details?.agents || [];
      const total = result.details?.total ?? agents.length;
      if (!options.expanded) return new Text(theme.fg("success", `✓ ${agents.length} of ${total} agents`), 0, 0);
      return new Text(result.content?.[0]?.text || JSON.stringify(result.details, null, 2), 0, 0);
    },
  });

  pi.registerTool({
    name: "read_agent_response",
    label: "Read Agent Response",
    description: "Read one current-session agent's latest final raw text response. Tool calls and intermediate assistant text are excluded.",
    parameters: Type.Object({ target: Type.String({ description: "Session-owned agent task name." }) }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      try {
        const result = manager.readAgentResponse(cleanTarget(params.target), parentSessionId(ctx));
        return boundedTextResult(JSON.stringify(result, null, 2), { agent_name: result.agent_name, status: result.status });
      } catch (error) {
        throw new Error(`read_agent_response failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) {
      return new Text(theme.fg("toolTitle", theme.bold("read_agent_response ")) + theme.fg("accent", args.target || "?"), 0, 0);
    },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", "✗ read failed"), 0, 0);
      return new Text(theme.fg("success", `✓ ${result.details?.agent_name || "response"}`), 0, 0);
    },
  });

  pi.registerTool({
    name: "send_message",
    label: "Send Message",
    description: "Send a message to a session-owned agent. Steers the current run when active; otherwise starts a new turn.",
    parameters: Type.Object({
      target: Type.String({ description: "Session-owned agent task name." }),
      message: Type.String({ description: "Message text to send." }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      try {
        const result = await manager.sendMessage(parentSessionId(ctx), cleanTarget(params.target), params.message);
        return textResult(result.delivery === "steer" ? "Message steered into the running agent." : "Message started a new agent turn.", { target: params.target, ...result });
      } catch (error) {
        throw new Error(`send_message failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) { return new Text(theme.fg("toolTitle", theme.bold("send_message ")) + theme.fg("accent", args.target || "?"), 0, 0); },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", "✗ send failed"), 0, 0);
      return new Text(theme.fg("success", result.details?.delivery === "steer" ? "✓ steered" : "✓ started"), 0, 0);
    },
  });

  pi.registerTool({
    name: "interrupt_agent",
    label: "Interrupt Agent",
    description: "Abort a session-owned agent's current turn while keeping its session available for later send_message calls.",
    parameters: Type.Object({ target: Type.String({ description: "Session-owned agent task name." }) }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      try {
        const result = await manager.interruptAgent(parentSessionId(ctx), cleanTarget(params.target));
        return textResult("Interrupt request handled.", result);
      } catch (error) {
        throw new Error(`interrupt_agent failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    renderCall(args: any, theme: Theme) { return new Text(theme.fg("toolTitle", theme.bold("interrupt_agent ")) + theme.fg("accent", args.target || "?"), 0, 0); },
    renderResult(result: any, _options: any, theme: Theme) {
      if (result.isError) return new Text(theme.fg("error", "✗ interrupt failed"), 0, 0);
      return new Text(theme.fg("warning", `↯ previous: ${result.details?.previous_status || "unknown"}`), 0, 0);
    },
  });
}
