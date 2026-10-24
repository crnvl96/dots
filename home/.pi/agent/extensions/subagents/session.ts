import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionToolContext,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import { config } from './config.ts';
import { lastAssistantText, type TaskInput } from './contracts.ts';
import { definitionPrompt, type AgentDefinition } from './definitions.ts';
import { askTool } from './feedback.ts';
import { childPromptAppendix } from './prompts.ts';

export interface OpenChildInput {
  task: TaskInput;
  definition?: AgentDefinition;
  ctx: ExtensionToolContext;
  pi: ExtensionAPI;
  thinkingLevel: ThinkingLevel;
  onAsk: (message: string, kind: 'gap' | 'decision') => void;
}

export interface OpenedChild {
  session: AgentSession;
  modelId: string;
  provider: string;
}

interface HostContext extends ExtensionToolContext {
  agentDir?: string;
  extensionFactories?: InlineExtension[];
}

function parentRuntime(ctx: ExtensionToolContext) {
  const registry = ctx.modelRegistry;
  return {
    streamSimple: (model: Model<any>, context: unknown, options?: unknown) =>
      registry.streamSimple(model, context as never, options as never),
    stream: (model: Model<any>, context: unknown, options?: unknown) =>
      typeof registry.stream === 'function'
        ? registry.stream(model, context as never, options as never)
        : registry.streamSimple(model, context as never, options as never),
    hasConfiguredAuth: () => true,
    checkAuth: async () => undefined,
    isUsingOAuth: () => false,
    getModel: (provider: string, id: string) => registry.find(provider, id),
    getAuth: async (provider: string) => {
      const apiKey = await registry.getApiKeyForProvider?.(provider);
      return apiKey ? { auth: { apiKey } } : undefined;
    },
    getProvider: (provider: string) => registry.getProvider?.(provider),
    getError: () => undefined,
  };
}

/** dispose() alone does not run extension cleanup in Pi 1.4.0. */
export async function closeChildSession(session: AgentSession) {
  try {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  } finally {
    session.dispose();
  }
}

/** Preserve the parent prompt; the selected role is inserted by the runtime, not read on request by the model. */
export function resolveChildSystemPrompt(
  task: TaskInput,
  ctx: ExtensionToolContext,
  definition?: AgentDefinition,
): string | undefined {
  const parent = ctx.getSystemPrompt?.();
  if (parent === undefined) return undefined;
  return [parent, ...childPromptParts(task, definition)].filter(Boolean).join('\n\n');
}

function childPromptParts(task: TaskInput, definition?: AgentDefinition) {
  return [
    childPromptAppendix,
    definition && definitionPrompt(definition),
    task.appendSystemPrompt?.trim(),
  ].filter((part): part is string => Boolean(part));
}

export function resolveModel(task: TaskInput, ctx: ExtensionToolContext) {
  const provider = task.provider ?? ctx.model?.provider;
  const modelId = task.model ?? ctx.model?.id;
  const model = provider && modelId ? ctx.modelRegistry.find(provider, modelId) : undefined;
  if (!model)
    throw new Error(`Unknown subagent model: ${provider ?? '(unset)'}/${modelId ?? '(unset)'}`);
  return model;
}

/** A full in-memory Pi session. Discovery matches the parent unless the host supplies a directory. */
export async function openChildSession(input: OpenChildInput): Promise<OpenedChild> {
  const host = input.ctx as HostContext;
  const task = input.task;
  if (task.agent && input.definition?.name !== task.agent)
    throw new Error(`Agent definition was not resolved: ${task.agent}`);
  if (!task.prompt.trim()) throw new Error('Subagent prompt must not be blank.');
  const model = resolveModel(task, input.ctx);
  const agentDir = host.agentDir || getAgentDir();
  const settings = input.pi.getSettings?.() ?? {};
  const settingsManager = SettingsManager.inMemory(
    { ...settings, cacheWarming: config.childCacheWarming },
    { projectTrusted: input.ctx.isProjectTrusted?.() ?? true },
  );
  const clear = { run: () => {} };
  const asked = askTool((feedback) => input.onAsk(feedback.message, feedback.kind));
  const explicitTools =
    task.tools === undefined
      ? undefined
      : task.tools.length === 0
        ? []
        : [...new Set([...task.tools, config.askTool])];
  const isolated = Boolean(host.agentDir);
  const forcedPrompt = resolveChildSystemPrompt(task, input.ctx, input.definition);
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.ctx.cwd,
    agentDir,
    settingsManager,
    noSkills: isolated,
    noContextFiles: isolated,
    extensionFactories: [
      createCodemodeExtension({ mode: 'on' }),
      createToolSearchExtension(),
      // The MCP extension reads getAgentDir(), not the session directory. Isolated children
      // (tests and embeds that pass agentDir) must not connect to the user's live servers.
      ...(isolated ? [] : [createMcpExtension()]),
      (pi) => {
        // Queued guidance must not restart a failed run. SDK retries still decide recovery.
        pi.on('agent_end', (event) => {
          if (lastAssistantText(event.messages).error) clear.run();
        });
      },
      (pi) => {
        if (explicitTools === undefined || explicitTools.includes(config.askTool))
          pi.registerTool(asked);
      },
      ...(host.extensionFactories ?? []),
      // After inherited extensions so a rebuilt child prompt cannot replace the parent's text.
      (pi) => {
        if (forcedPrompt === undefined) return;
        pi.on('before_agent_start', () => ({ systemPrompt: forcedPrompt }));
      },
    ],
    ...(forcedPrompt !== undefined
      ? { systemPromptOverride: () => forcedPrompt }
      : { appendSystemPrompt: childPromptParts(task, input.definition) }),
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: input.ctx.cwd,
    agentDir,
    model,
    thinkingLevel: task.thinkingLevel ?? input.thinkingLevel,
    modelRuntime: parentRuntime(input.ctx) as never,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(input.ctx.cwd),
    scopedModels: input.ctx.scopedModels?.map((scoped) => ({
      model: scoped.model,
      thinkingLevel: scoped.thinkingLevel,
    })),
    ...(explicitTools ? { tools: explicitTools } : {}),
  });
  try {
    await session.bindExtensions({});
    if (explicitTools) {
      const enabled = new Set(session.getActiveToolNames());
      for (const name of task.tools ?? []) {
        if (!enabled.has(name)) throw new Error(`Unavailable subagent tool: ${name}`);
      }
    }
    clear.run = () => session.agent.clearAllQueues();
    return { session, modelId: model.id, provider: model.provider };
  } catch (error) {
    await closeChildSession(session);
    throw error;
  }
}
