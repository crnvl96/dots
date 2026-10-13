// Defaults shared by configuration, child launches, and tool schemas.
import type { AgentRuntimeStatus } from "./types.js";

export const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_MODEL_RESPONSE_TIMEOUT_MS = 10 * 60_000;
export const ACTIVITY_PERSIST_INTERVAL_MS = 5_000;
export const DEFAULT_THINKING = "high";
export const DEFAULT_TOOLS = "read,bash,grep,find,ls";
export const DEFAULT_SUBAGENT_SYSTEM_PROMPT = "You are a subagent working for a main agent. Work only on the assigned task and follow its scope precisely.";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const FINAL_STATUSES = new Set<AgentRuntimeStatus>(["completed", "failed", "interrupted"]);
