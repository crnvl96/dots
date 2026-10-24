import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { config } from './config.ts';

export const TaskSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: config.nameMaxLength,
    pattern: config.namePattern,
    description:
      'Meaningful short kebab-case name, e.g. review-parser. This is the agent ID for all tools and UI. Must be unique for this session, including discarded agents.',
  }),
  prompt: Type.String({ minLength: 1 }),
  agent: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Named agent definition from subagents_list (frontmatter name, not the unique job name). Its Markdown instructions are loaded automatically into the child system prompt.',
    }),
  ),
  model: Type.Optional(
    Type.String({ minLength: 1, description: 'Model ID; defaults to the parent model ID.' }),
  ),
  provider: Type.Optional(
    Type.String({ minLength: 1, description: 'Defaults to the parent provider.' }),
  ),
  thinkingLevel: Type.Optional(
    StringEnum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const),
  ),
  tools: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        'Exact tool names to enable. Defaults to the same Pi tool set as the parent, including extension, MCP, and codemode tools. [] disables tools. subagents_ask stays available unless the list is empty.',
      uniqueItems: true,
    }),
  ),
  appendSystemPrompt: Type.Optional(
    Type.String({
      description:
        "Text appended after the parent session's effective system prompt. Does not replace it. An empty string is ignored.",
    }),
  ),
});

export const LaunchSchema = Type.Object({ tasks: Type.Array(TaskSchema, { minItems: 1 }) });
export const SteerSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    description: 'Exact kebab-case name assigned at launch (the agent ID).',
  }),
  prompt: Type.String({
    minLength: 1,
    description: 'Guidance delivered after the current assistant turn and its tools finish.',
  }),
});
export const InspectSchema = Type.Object({
  id: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Exact subagent name (its ID). Omit to list retained jobs; supply a name to include its result.',
    }),
  ),
});
export const WaitSchema = Type.Object({
  ids: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
    description:
      'Exact kebab-case names assigned at launch (agent IDs). Waits for all selected jobs.',
  }),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 2_147_483_647,
      description:
        'Optional maximum wait in milliseconds. A timeout returns current snapshots without stopping children. Omit to wait until all reports are ready.',
    }),
  ),
});
export const DiscardSchema = Type.Object({
  ids: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
    description:
      'Exact kebab-case names (agent IDs) of finished subagents whose reports have been reviewed and are no longer needed.',
  }),
});

const NullableString = Type.Union([Type.String(), Type.Null()]);
export const SnapshotSchema = Type.Object({
  id: Type.String(),
  prompt: Type.String(),
  model: Type.String(),
  provider: Type.String(),
  agentType: Type.Optional(Type.String()),
  agentFile: Type.Optional(Type.String()),
  status: StringEnum(['running', 'stopping', 'completed', 'failed', 'stopped'] as const),
  activity: Type.String(),
  pendingSteers: Type.Integer(),
  elapsedMs: Type.Number(),
  notification: StringEnum(['pending', 'queued', 'failed'] as const),
  error: NullableString,
  notificationError: NullableString,
  result: NullableString,
  fullOutputPath: NullableString,
});
