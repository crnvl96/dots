import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import type { SnapshotSchema, TaskSchema } from './schemas.ts';

export type TaskInput = Static<typeof TaskSchema>;
export type Snapshot = Static<typeof SnapshotSchema>;
export type Status = Snapshot['status'];
export type FeedbackKind = 'gap' | 'decision';

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
}

/** One orchestrated child. The AgentSession stays until discard, eviction, or session cleanup. */
export interface Job {
  id: string;
  session?: AgentSession;
  model: string;
  provider: string;
  agentType?: string;
  agentFile?: string;
  prompt: string;
  status: Status;
  startedAt: number;
  finishedAt?: number;
  finishedOrder?: number;
  settled?: boolean;
  activity: string;
  pendingSteers: number;
  hasPrompt?: boolean;
  tools: Map<string, string>;
  error?: string;
  cancelled: boolean;
  unsubscribe?: () => void;
  done?: Promise<void>;
  result?: string;
  fullOutputPath?: string;
  notification: 'pending' | 'queued' | 'failed';
  notificationError?: string;
}

export interface MenuActions {
  jobs: () => Job[];
  subscribe: (listener: () => void) => () => void;
}

export function active(job: Job) {
  return job.status === 'running' || job.status === 'stopping';
}

export function lastAssistantText(messages: readonly AgentMessage[]) {
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  if (last?.role !== 'assistant')
    return {
      text: '',
      error: 'Subagent finished without an assistant response.',
      stopReason: undefined as string | undefined,
    };
  const text = last.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const failed = last.stopReason === 'error' || last.stopReason === 'aborted';
  return {
    text,
    error: failed ? last.errorMessage || `Subagent ${last.stopReason}` : undefined,
    stopReason: last.stopReason,
  };
}
