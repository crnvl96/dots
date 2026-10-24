import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { truncateHead } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui';
import type { Job, Snapshot } from './contracts.ts';

export function snapshot(job: Job, includeResult = false): Snapshot {
  return {
    id: job.id,
    prompt: job.prompt,
    model: job.model,
    provider: job.provider,
    ...(job.agentType ? { agentType: job.agentType, agentFile: job.agentFile } : {}),
    status: job.status,
    activity: job.activity,
    pendingSteers: job.pendingSteers,
    elapsedMs: Math.max(0, (job.finishedAt ?? Date.now()) - job.startedAt),
    notification: job.notification,
    error: job.error ?? null,
    notificationError: job.notificationError ?? null,
    result: includeResult ? (job.result ?? null) : null,
    fullOutputPath: job.fullOutputPath ?? null,
  };
}

export function oneLine(text: string) {
  return stripTerminalSequences(text)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function elapsed(job: Job) {
  const seconds = Math.max(0, Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export async function boundedReport(job: Job, response: string, error?: string) {
  const full = `Subagent ${job.id} ${job.status}.\nTask: ${truncateToWidth(oneLine(job.prompt), 160)}\n\n${job.status === 'stopped' ? 'Stopped by user.\n\n' : error ? `Error: ${error}\n\n` : ''}${response || '(No text response.)'}`;
  const truncated = truncateHead(full);
  let content = truncated.content;
  job.result =
    content + (truncated.truncated ? '\n\n[Output truncated; preparing full response file.]' : '');
  let fullOutputPath: string | undefined;
  if (truncated.truncated) {
    try {
      const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-'));
      fullOutputPath = join(directory, 'response.md');
      await writeFile(fullOutputPath, full, { encoding: 'utf8', mode: 0o600 });
      content += `\n\n[Output truncated. Full response: ${fullOutputPath}]`;
    } catch {
      fullOutputPath = undefined;
      content += '\n\n[Output truncated; could not save the full response.]';
    }
  }
  return { content, fullOutputPath };
}
