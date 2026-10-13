// Data contracts: persisted records, launch parameters, and parent notifications.
import type { THINKING_LEVELS } from "./constants.js";

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type AgentRuntimeStatus = "starting" | "running" | "completed" | "failed" | "interrupted";

export interface SubagentConfig {
  shortcut?: string;
  storageDir?: string;
  retentionDays?: number;
  models?: string[];
  modelsFromEnabledModels?: boolean;
  modelResponseTimeoutMs?: number;
  providerAgents?: Record<string, Record<string, { model: string; thinking: ThinkingLevel }>>;
  defaults?: {
    skills?: string[];
    extensions?: string[];
  };
}

export interface AgentDefinition {
  name: string;
  description?: string;
  hint?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string;
  skills?: string[];
  extensions?: string[];
  prompt?: string;
}

export interface ChildProcessOwnership {
  pid: number;
  processIdentity: string;
  token: string;
  ownerPid: number;
  ownerProcessIdentity?: string;
  startedAt: number;
}

export interface AgentInfo {
  id: string;
  taskName: string;
  canonicalName: string;
  parentSessionId: string;
  parentSessionFile?: string;
  agentType?: string;
  provider: string;
  modelId: string;
  model: string;
  thinking?: ThinkingLevel;
  tools?: string;
  skills?: string[];
  skillPaths?: string[];
  extensions?: string[];
  extensionPaths?: string[];
  cwd: string;
  sessionFile: string;
  infoFile: string;
  logFile: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  lastActivity?: number;
  messageCount: number;
  status: AgentRuntimeStatus;
  lastTaskMessage?: string;
  finalResponse?: string;
  error?: string;
  childProcess?: ChildProcessOwnership;
}

export interface AgentListEntry {
  agent_name: string;
  agent_status: AgentRuntimeStatus;
  last_task_message: string | null;
  parent_session_id?: string;
}

export interface AgentResponseEntry {
  agent_name: string;
  status: AgentRuntimeStatus;
  finalResponse?: string;
  error?: string;
  last_task_message: string | null;
}

export interface SpawnAgentParams {
  task_name: string;
  message: string;
  agent_type?: string;
  skills?: string[];
  loadedSkillPaths?: Record<string, string>;
  cwd: string;
  parentSessionId: string;
  parentSessionFile?: string;
  inheritedProvider: string;
  inheritedModelId: string;
  inheritedThinking?: ThinkingLevel;
  inheritedTools?: string;
  model?: { provider: string; modelId: string };
  thinking?: ThinkingLevel;
}

export interface AgentCompletionEvent {
  id: string;
  parentSessionId: string;
  agentName: string;
  status: AgentRuntimeStatus;
  finalResponse?: string;
  error?: string;
  createdAt: number;
}

export interface AgentActivityEvent {
  parentSessionId: string;
  agentName: string;
  active: boolean;
}

export interface AgentManagerOptions {
  onActivityChange?: (event: AgentActivityEvent) => void;
  onUnclaimedCompletion?: (event: AgentCompletionEvent) => void;
  modelResponseTimeoutMs?: number;
}

export interface PeekMarker { pid: number; startedAt: number; token: string }
