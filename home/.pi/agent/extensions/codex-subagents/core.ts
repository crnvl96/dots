// Compatibility facade for existing integrations and the lifecycle regression suite.
// Prefer a focused runtime module when adding new implementation code.
export {
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_MODEL_RESPONSE_TIMEOUT_MS,
  DEFAULT_THINKING,
  DEFAULT_TOOLS,
  THINKING_LEVELS,
} from "./runtime/constants.js";
export { PACKAGE_BASENAME, SUBAGENT_DIR } from "./runtime/paths.js";
export type * from "./runtime/types.js";
export { getAgentDefinition, getAgentDefinitionsDescription, getRunsDir, listAgentDefinitions, loadSubagentConfig } from "./runtime/config.js";
export { consumeFirstMatchingMailboxEvent, formatAgentError, parseAgentDefinitionText } from "./runtime/normalization.js";
export { getAgent, parentScopeKey, taskStorageKey, writeFullToolOutput } from "./runtime/storage.js";
export { getSocketPath, isPeekActive } from "./runtime/process.js";
export { RpcAssistantStreamState, type RpcAssistantStreamStatus } from "./runtime/stream.js";
export { RpcJsonlDecoder } from "./runtime/jsonl.js";
export { AgentManager } from "./runtime/manager.js";
