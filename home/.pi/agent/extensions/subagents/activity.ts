import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import type { Job } from './contracts.ts';
import { oneLine } from './formatting.ts';

/** Summarize known tools without inspecting output or private reasoning. */
export function toolActivity(name: string, args: unknown) {
  const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const field = (key: string) => typeof input[key] === 'string' ? oneLine(truncateToWidth(oneLine(input[key]), 160)) : '';
  const path = field('path') || field('file_path');
  const command = name === 'bash' ? field('command') : '';
  switch (name) {
    case 'read': return path ? `Reading ${path}` : 'Reading a file';
    case 'edit': return path ? `Editing ${path}` : 'Editing a file';
    case 'write': return path ? `Writing ${path}` : 'Writing a file';
    case 'bash': return command ? `Running ${command}` : 'Running a command';
    case 'grep': return `Searching ${field('pattern') || 'files'}${path ? ` in ${path}` : ''}`;
    case 'find': return `Finding ${field('pattern') || 'files'}${path ? ` in ${path}` : ''}`;
    case 'ls': return `Listing ${path || '.'}`;
    case 'codemode': return 'Running code · tool orchestration';
    case 'subagents_ask': return input.kind === 'decision' ? 'Needs a decision' : 'Found a gap';
    default: return `Using ${oneLine(truncateToWidth(oneLine(name), 80))}`;
  }
}

/** Update only on meaningful transitions so bookkeeping events cannot erase useful activity. */
export function updateActivity(job: Job, event: AgentSessionEvent) {
  if (event.type === 'tool_execution_start') job.tools.set(event.toolCallId, toolActivity(event.toolName, event.args));
  if (event.type === 'tool_execution_end') job.tools.delete(event.toolCallId);
  if (job.status !== 'running') return;
  if (job.tools.size) {
    const tools = [...job.tools.values()];
    job.activity = tools.slice(-2).join(' · ') + (tools.length > 2 ? ` · +${tools.length - 2} more` : '');
    return;
  }
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
    case 'tool_execution_end':
      job.activity = 'Waiting for model';
      break;
    case 'message_update': {
      const type = event.assistantMessageEvent.type;
      if (type.startsWith('thinking')) job.activity = 'Thinking';
      else if (type.startsWith('text')) job.activity = 'Writing response';
      else if (type.startsWith('toolcall')) job.activity = 'Preparing tool call';
      break;
    }
    case 'auto_retry_start':
    case 'summarization_retry_scheduled':
      job.activity = `Retrying · attempt ${event.attempt}/${event.maxAttempts} · backoff ${Math.ceil(event.delayMs / 1000)}s`;
      break;
    case 'compaction_start':
      job.activity = 'Compacting context';
      break;
    case 'compaction_end':
      job.activity = event.errorMessage ? 'Context compaction failed' : event.aborted ? 'Context compaction cancelled' : 'Waiting for model';
      break;
  }
}
