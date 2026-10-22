import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { discoverAgents, type AgentCatalog } from './definitions.ts';

/** Read fresh at each parent turn, inspection, and launch. No watchers or stale role bodies. */
export function catalogForContext(ctx: Pick<ExtensionContext, 'cwd' | 'isProjectTrusted'>): AgentCatalog {
  return discoverAgents({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() ?? false });
}

export function catalogSummary(catalog: AgentCatalog) {
  const lines = [
    'Named subagent definitions are available to subagents_launch through tasks[].agent. The task name is still a separate, unique job ID.',
    'Choose a matching definition by its description when delegation is justified. The runtime loads its complete instructions automatically; do not read or copy its body just to launch it.',
    'Use subagents_list to refresh the catalog and see source paths or validation diagnostics. Missing/invalid names fail rather than falling back to a generic child.',
    ...catalog.agents.map(({ name, description }) => `- ${JSON.stringify(name)}: ${JSON.stringify(description)}`),
  ];
  if (!catalog.agents.length) lines.push('No valid named agent definitions found. Generic tasks without agent remain available.');
  if (catalog.diagnostics.length) lines.push(`${catalog.diagnostics.length} discovery diagnostic(s); use subagents_list to inspect them.`);
  return lines.join('\n');
}

export function registerAgentCatalog(pi: ExtensionAPI) {
  pi.on('before_agent_start', (event, ctx) => {
    const summary = catalogSummary(catalogForContext(ctx));
    // Structured sections are replaced per turn, so edits/deletions do not accumulate stale catalogs.
    event.systemPromptOptions.sections.subagent_definitions = summary;
    // A prior extension's forced prompt bypasses structured rendering. Preserve it and append the catalog.
    if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
      return { systemPrompt: `${event.systemPrompt}\n\n<subagent_definitions>\n${summary}\n</subagent_definitions>` };
    }
  });
}
