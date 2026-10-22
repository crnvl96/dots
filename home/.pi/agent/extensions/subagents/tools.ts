import { Type, type Static } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { snapshot } from './formatting.ts';
import { launchDescription, launchGuidelines } from './prompts.ts';
import type { Runtime } from './runtime.ts';
import { statusText, waitText } from './runtime.ts';
import { DiscardSchema, InspectSchema, LaunchSchema, SnapshotSchema, SteerSchema, WaitSchema } from './schemas.ts';

export function registerTools(pi: ExtensionAPI, runtime: Runtime) {
  pi.registerTool({
    name: 'subagents_launch', label: 'Launch subagents',
    description: launchDescription,
    promptGuidelines: launchGuidelines,
    parameters: LaunchSchema,
    outputSchema: Type.Object({ ids: Type.Array(Type.String()), agents: Type.Array(SnapshotSchema) }),
    async execute(_callId, params: Static<typeof LaunchSchema>, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      runtime.attachUI(ctx);
      const prepared = await runtime.launch(params.tasks, signal, ctx);
      const ids = prepared.map((job) => job.id);
      return {
        content: [{ type: 'text', text: `Launched background subagents: ${ids.join(', ')}. Responses will arrive automatically.` }],
        details: { ids },
        structuredContent: { ids, agents: prepared.map((job) => snapshot(job)) },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_steer', label: 'Steer subagent',
    description: 'Send guidance to a running background subagent after its current turn and tools finish. If it has already finished or is stopping, returns accepted:false with its current status and available result; never restarts it.',
    parameters: SteerSchema,
    outputSchema: Type.Object({ accepted: Type.Boolean(), agent: SnapshotSchema }),
    async execute(_callId, params: Static<typeof SteerSchema>, signal) {
      signal?.throwIfAborted();
      const job = runtime.jobs.get(params.id);
      if (!params.prompt.trim()) throw new Error('Steering prompt must not be blank.');
      if (!job) throw new Error(`Subagent is not running or no longer retained: ${params.id}. Use subagents_status to list current jobs.`);
      const accepted = job.status === 'running';
      if (accepted) runtime.steer(job, params.prompt);
      const agent = snapshot(job, !accepted);
      return {
        content: [{ type: 'text', text: accepted ? `Steering queued for subagent ${job.id}.`
          : `Subagent ${job.id} is ${job.status}; guidance was not queued and the child was not restarted.\n\n${job.result ?? 'The final report is not ready yet.'}` }],
        details: { id: job.id, accepted, status: job.status },
        structuredContent: { accepted, agent },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_wait', label: 'Wait for subagents',
    description: 'Wait for all specified background subagents to finish and prepare their reports, without polling or making model calls. Returns results for completed, failed, or stopped jobs. Optional timeout returns current snapshots with timedOut:true. Cancelling the wait or timing out does not stop children. Automatic completion notifications remain enabled. IDs must be exact and retained when the call starts.',
    parameters: WaitSchema,
    outputSchema: Type.Object({ timedOut: Type.Boolean(), agents: Type.Array(SnapshotSchema) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_callId, params: Static<typeof WaitSchema>, signal) {
      signal?.throwIfAborted();
      if (!params.ids.length) throw new Error('At least one subagent ID is required.');
      if (new Set(params.ids).size !== params.ids.length) throw new Error('Subagent IDs must be unique.');
      if (params.timeoutMs !== undefined && (!Number.isInteger(params.timeoutMs) || params.timeoutMs < 1 || params.timeoutMs > 2_147_483_647)) {
        throw new Error('timeoutMs must be an integer between 1 and 2147483647.');
      }
      const selected = params.ids.map((id) => {
        const job = runtime.jobs.get(id);
        if (!job) throw new Error(`Unknown or no longer retained subagent: ${id}`);
        return job;
      });
      const timedOut = await runtime.waitFor(selected, signal, params.timeoutMs);
      const agents = selected.map((job) => snapshot(job, true));
      return {
        content: [{ type: 'text', text: waitText(timedOut, agents) }],
        details: { timedOut, agents }, structuredContent: { timedOut, agents },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_discard', label: 'Discard finished subagents',
    description: 'Discard retained reports for finished subagents after reviewing and integrating their results. Requires exact IDs; the entire batch must have finished execution and report preparation. Does not stop running children, retract queued notifications, delete parent transcript messages, or delete report files. Discarded IDs are no longer queryable.',
    parameters: DiscardSchema,
    outputSchema: Type.Object({ ids: Type.Array(Type.String()) }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async execute(_callId, params: Static<typeof DiscardSchema>, signal) {
      signal?.throwIfAborted();
      if (!params.ids.length) throw new Error('At least one subagent ID is required.');
      if (new Set(params.ids).size !== params.ids.length) throw new Error('Subagent IDs must be unique.');
      const selected = params.ids.map((id) => {
        const job = runtime.jobs.get(id);
        if (!job) throw new Error(`Unknown or no longer retained subagent: ${id}`);
        if (!job.settled || job.status === 'running' || job.status === 'stopping') throw new Error(`Subagent has not finished execution and report preparation: ${id}`);
        return job;
      });
      runtime.discard(selected);
      return {
        content: [{ type: 'text', text: `Discarded finished subagents: ${params.ids.join(', ')}.` }],
        details: { ids: params.ids }, structuredContent: { ids: params.ids },
      };
    },
  });
  pi.registerTool({
    name: 'subagents_status', label: 'Subagent status',
    description: 'Inspect background subagent progress without waiting or making model calls. Omit id to list retained jobs; supply an exact ID to recover its available result. Reports are delivered automatically; use this for diagnostics, not polling. Live child sessions remain until discarded; at most 20 finished reports remain in this runtime until discarded.',
    parameters: InspectSchema,
    outputSchema: Type.Object({ agents: Type.Array(SnapshotSchema) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_callId, params: Static<typeof InspectSchema>, signal) {
      signal?.throwIfAborted();
      const job = params.id ? runtime.jobs.get(params.id) : undefined;
      if (params.id && !job) throw new Error(`Unknown or no longer retained subagent: ${params.id}`);
      const agents = (job ? [job] : [...runtime.jobs.values()]).map((item) => snapshot(item, Boolean(job)));
      return {
        content: [{ type: 'text', text: statusText(agents, Boolean(job)) }],
        details: { agents }, structuredContent: { agents },
      };
    },
  });
}
