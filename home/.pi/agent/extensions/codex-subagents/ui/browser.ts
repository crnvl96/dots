import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type KeyId } from "@earendil-works/pi-tui";
import { loadSubagentConfig } from "../runtime/config.js";
import type { AgentManager } from "../runtime/manager.js";
import type { AgentInfo } from "../runtime/types.js";
import { parentSessionId } from "../tools/helpers.js";
import { SubagentPeekOverlay } from "./peek.js";
import { runtimeLabel } from "./format.js";

function formatColumn(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function registerAgentBrowser(pi: ExtensionAPI, manager: AgentManager) {
  async function openAgentOverlay(ctx: any, task: string, scopeId = parentSessionId(ctx), includeAll = false) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Subagent overlays require interactive TUI mode.", "warning");
      return;
    }
    let info: AgentInfo;
    try { info = manager.getAgentInfo(task, scopeId); }
    catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); return; }

    while (true) {
      const navigation = await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: any) => new SubagentPeekOverlay(tui, theme, info, done), {
        overlay: true,
        overlayOptions: { anchor: "right-center", width: "45%", minWidth: 50, maxHeight: 60, margin: { right: 2, top: 2, bottom: 2 } },
      });
      if (navigation !== "previous" && navigation !== "next") return;

      const currentSessionId = parentSessionId(ctx);
      const entries = manager.listAgents(undefined, currentSessionId, includeAll);
      if (entries.length < 2) return;
      const currentIndex = entries.findIndex((entry) =>
        entry.agent_name === info.canonicalName &&
        (entry.parent_session_id || currentSessionId) === info.parentSessionId
      );
      if (currentIndex === -1) return;
      const offset = navigation === "next" ? 1 : -1;
      const next = entries[(currentIndex + offset + entries.length) % entries.length];
      info = manager.getAgentInfo(next.agent_name, next.parent_session_id || currentSessionId);
    }
  }

  async function pickAgent(ctx: any): Promise<{ task: string; parentSessionId: string; includeAll: boolean } | undefined> {
    const currentSessionId = parentSessionId(ctx);
    return await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: any) => {
      let selected = 0;
      let showAll = false;
      let cached: string[] | undefined;
      let cachedWidth: number | undefined;
      const fg = theme.fg.bind(theme);
      const pageSize = 10;
      const refresh = () => { cached = undefined; tui.requestRender(); };
      const agents = () => manager.listAgents(undefined, currentSessionId, showAll);
      return {
        render(width: number): string[] {
          if (cached && cachedWidth === width) return cached;
          const entries = agents();
          if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
          const scopeLabel = showAll ? "all sessions" : "this session";
          const lines = [fg("accent", "─".repeat(width)), fg("accent", theme.bold(" Subagents")) + fg("dim", ` (${entries.length}, ${scopeLabel})`), ""];
          if (!entries.length) lines.push(fg("dim", showAll ? "No subagents found." : "No subagents for this session. Press tab to show all."));
          const viewStart = entries.length > pageSize ? Math.max(0, Math.min(selected - Math.floor(pageSize / 2), entries.length - pageSize)) : 0;
          const viewEnd = Math.min(viewStart + pageSize, entries.length);
          const statusWidth = 11;
          const durationWidth = 6;
          const thinkingWidth = 7;
          const fixedWidth = 2 + statusWidth + durationWidth + thinkingWidth + 4 + (showAll ? 9 : 0);
          const nameWidth = Math.min(28, Math.max(8, width - fixedWidth - 8));
          const modelWidth = Math.max(0, Math.min(28, width - fixedWidth - nameWidth));
          if (viewStart > 0) lines.push(fg("dim", `  ↑ ${viewStart} more`));
          for (let index = viewStart; index < viewEnd; index++) {
            const entry = entries[index];
            const info = manager.getAgentInfo(entry.agent_name, entry.parent_session_id || currentSessionId);
            const pointer = index === selected ? fg("accent", "› ") : "  ";
            const name = formatColumn(entry.agent_name, nameWidth);
            const sessionId = entry.parent_session_id || "";
            const parent = showAll ? ` ${sessionId.slice(-8)}` : "";
            const details = [
              formatColumn(runtimeLabel(info), durationWidth),
              formatColumn(info.modelId || "unknown", modelWidth),
              formatColumn(info.thinking || "off", thinkingWidth),
            ].join(" ");
            lines.push(pointer + fg(index === selected ? "accent" : "text", name) + " " + fg(entry.agent_status === "failed" ? "error" : entry.agent_status === "completed" ? "success" : "warning", entry.agent_status.padEnd(statusWidth)) + " " + fg("dim", details + parent));
            if (entry.last_task_message) lines.push("  " + fg("dim", truncateToWidth(entry.last_task_message.replace(/\s+/g, " "), Math.max(0, width - 4))));
          }
          if (viewEnd < entries.length) lines.push(fg("dim", `  ↓ ${entries.length - viewEnd} more`));
          lines.push("", fg("dim", "enter: open  tab: this/all sessions  r: refresh  q/esc: close"));
          cached = lines.map((line) => truncateToWidth(line, width));
          cachedWidth = width;
          return cached;
        },
        handleInput(data: string) {
          const entries = agents();
          if (matchesKey(data, "escape") || data === "q") { done(undefined); return; }
          if (matchesKey(data, "tab") || data === "\t") { showAll = !showAll; selected = 0; refresh(); return; }
          if (data === "r") { refresh(); return; }
          if (matchesKey(data, "down") || data === "j") { selected = Math.min(entries.length - 1, selected + 1); refresh(); return; }
          if (matchesKey(data, "up") || data === "k") { selected = Math.max(0, selected - 1); refresh(); return; }
          if (matchesKey(data, "return") && entries[selected]) {
            done({ task: entries[selected].agent_name, parentSessionId: entries[selected].parent_session_id || currentSessionId, includeAll: showAll });
          }
        },
        invalidate() { cached = undefined; },
      };
    });
  }

  const browseAgents = async (ctx: any) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Subagent overlays require interactive TUI mode.", "warning");
      return;
    }
    const selected = await pickAgent(ctx);
    if (selected) await openAgentOverlay(ctx, selected.task, selected.parentSessionId, selected.includeAll);
  };

  const shortcut = loadSubagentConfig().shortcut?.trim();
  if (shortcut) {
    pi.registerShortcut(shortcut as KeyId, {
      description: "Browse subagents",
      handler: browseAgents,
    });
  }

  pi.registerCommand("subagents", {
    description: "Browse subagents",
    handler: async (_args, ctx) => browseAgents(ctx),
  });
}
