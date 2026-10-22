import type { Agent, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import {
  createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension,
  DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager,
  type AgentSession, type ExtensionAPI, type ExtensionFactory, type ExtensionToolContext, type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import { config } from './config.ts';
import type { TaskInput } from './contracts.ts';
import { askTool } from './feedback.ts';
import { childPromptAppendix } from './prompts.ts';

export interface OpenChildInput {
  task: TaskInput;
  ctx: ExtensionToolContext;
  pi: ExtensionAPI;
  thinkingLevel: ThinkingLevel;
  onAsk: (message: string, kind: 'gap' | 'decision') => void;
}

export interface OpenedChild {
  session: AgentSession;
  agent: Agent;
  modelId: string;
  provider: string;
  hardExit: { hit: boolean };
}

interface HostContext extends ExtensionToolContext {
  agentDir?: string;
  extensionFactories?: InlineExtension[];
}

function parentRuntime(ctx: ExtensionToolContext) {
  const registry = ctx.modelRegistry;
  return {
    streamSimple: (model: Model<any>, context: unknown, options?: unknown) => registry.streamSimple(model, context as never, options as never),
    stream: (model: Model<any>, context: unknown, options?: unknown) =>
      typeof registry.stream === 'function' ? registry.stream(model, context as never, options as never) : registry.streamSimple(model, context as never, options as never),
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

function hardExitExtension(clear: { run: () => void }, hardExit: { hit: boolean }): ExtensionFactory {
  return (pi) => {
    pi.on('agent_end', (event) => {
      const last = [...event.messages].reverse().find((message) => message.role === 'assistant');
      if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
        hardExit.hit = true;
        clear.run();
      }
    });
  };
}

/** Parent effective prompt, then the child appendix, then an optional task append. Never a replacement. */
export function resolveChildSystemPrompt(task: TaskInput, ctx: ExtensionToolContext): string | undefined {
  const parent = ctx.getSystemPrompt?.();
  if (parent === undefined) return undefined;
  return [parent, childPromptAppendix, task.appendSystemPrompt?.trim()].filter(Boolean).join('\n\n');
}

export function resolveModel(task: TaskInput, ctx: ExtensionToolContext) {
  const provider = task.provider ?? ctx.model?.provider;
  const modelId = task.model ?? ctx.model?.id;
  const model = provider && modelId ? ctx.modelRegistry.find(provider, modelId) : undefined;
  if (!model) throw new Error(`Unknown subagent model: ${provider ?? '(unset)'}/${modelId ?? '(unset)'}`);
  return model;
}

/** A full in-memory Pi session. Discovery matches the parent unless the host supplies a directory. */
export async function openChildSession(input: OpenChildInput): Promise<OpenedChild> {
  const host = input.ctx as HostContext;
  const task = input.task;
  if (!task.prompt.trim()) throw new Error('Subagent prompt must not be blank.');
  const model = resolveModel(task, input.ctx);
  const agentDir = host.agentDir || getAgentDir();
  const settings = input.pi.getSettings?.() ?? {};
  const settingsManager = SettingsManager.inMemory(
    { ...settings, cacheWarming: config.childCacheWarming },
    { projectTrusted: input.ctx.isProjectTrusted?.() ?? true },
  );
  const clear = { run: () => {} };
  const hardExit = { hit: false };
  const asked = askTool((feedback) => input.onAsk(feedback.message, feedback.kind));
  const explicitTools = task.tools === undefined ? undefined
    : task.tools.length === 0 ? []
      : [...new Set([...task.tools, config.askTool])];
  const isolated = Boolean(host.agentDir);
  const forcedPrompt = resolveChildSystemPrompt(task, input.ctx);
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
      hardExitExtension(clear, hardExit),
      (pi) => { if (explicitTools === undefined || explicitTools.includes(config.askTool)) pi.registerTool(asked); },
      ...(host.extensionFactories ?? []),
      // After inherited extensions so a rebuilt child prompt cannot replace the parent's text.
      (pi) => {
        if (forcedPrompt === undefined) return;
        pi.on('before_agent_start', () => ({ systemPrompt: forcedPrompt }));
      },
    ],
    ...(forcedPrompt !== undefined
      ? { systemPromptOverride: () => forcedPrompt }
      : { appendSystemPrompt: [childPromptAppendix, task.appendSystemPrompt?.trim()].filter((part): part is string => Boolean(part)) }),
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
    scopedModels: input.ctx.scopedModels?.map((scoped) => ({ model: scoped.model, thinkingLevel: scoped.thinkingLevel })),
    ...(explicitTools ? { tools: explicitTools } : {}),
  });
  await session.bindExtensions({});
  if (explicitTools) {
    const enabled = new Set(session.getActiveToolNames());
    for (const name of task.tools ?? []) {
      if (!enabled.has(name)) throw new Error(`Unavailable subagent tool: ${name}`);
    }
  }
  clear.run = () => session.agent.clearAllQueues();
  return { session, agent: session.agent, modelId: model.id, provider: model.provider, hardExit };
}
