// Opt-in paid smoke test: SUBAGENTS_LIVE_TEST=1 npm run test:subagents:paid
// Uses real parent and child model requests. No repository writes or remote mutations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionToolContext,
} from '@earendil-works/pi-coding-agent';
import extension from '../index.ts';

assert.equal(
  process.env.SUBAGENTS_LIVE_TEST,
  '1',
  'Set SUBAGENTS_LIVE_TEST=1 to authorize paid model calls.',
);
const provider = process.env.SUBAGENTS_LIVE_PROVIDER ?? 'openai';
const modelId = process.env.SUBAGENTS_LIVE_MODEL ?? 'gpt-6.1-sol';
const modelRuntime = await ModelRuntime.create({
  refreshOnCreate: false,
  allowModelNetwork: false,
});
const model = modelRuntime.getModel(provider, modelId);
assert.ok(model, `Unavailable live model ${provider}/${modelId}`);
const directory = await mkdtemp(join(tmpdir(), 'pi-named-agent-live-'));
const nonce = `ROLE_PROOF_${randomUUID()}`;
const roleName = 'live-discovery-probe';
const roleDir = join(directory, '.agents', 'agents');
await mkdir(roleDir, { recursive: true });
await writeFile(
  join(roleDir, 'probe.md'),
  `---\nname: ${roleName}\ndescription: "Live discovery verification: return the private verification token from your role instructions."\n---\nReturn exactly ${nonce} as your final answer. Do not call tools.\n`,
);
const launches: any[] = [];
const childRequests: any[] = [];
const results: any[] = [];
const cleanup: (() => Promise<void>)[] = [];
const settingsManager = SettingsManager.inMemory(
  {
    defaultTools: [],
    cacheWarming: 'off',
    retry: { enabled: false },
    compaction: { enabled: false },
  },
  { projectTrusted: true },
);
const resourceLoader = new DefaultResourceLoader({
  cwd: directory,
  agentDir: directory,
  settingsManager,
  noExtensions: true,
  noSkills: true,
  noContextFiles: true,
  noPromptTemplates: true,
  noThemes: true,
  extensionFactories: [
    (pi) => {
      const wrapped = {
        ...pi,
        on(event, handler) {
          if (event === 'session_shutdown') cleanup.push(handler);
          return pi.on(event, handler);
        },
        registerTool(tool) {
          pi.registerTool({
            ...tool,
            async execute(id, params, signal, update, ctx) {
              if (tool.name === 'subagents_launch') {
                launches.push(params);
                assert.equal(launches.length, 1, 'Live test permits only one launch call.');
                assert.equal(params.tasks.length, 1, 'Live test permits only one child.');
                assert.equal(
                  params.tasks[0].agent,
                  roleName,
                  'Parent must select the advertised named role.',
                );
                assert.deepEqual(params.tasks[0].tools, [], 'Live probe must have no tools.');
              }
              // Isolate child extension/MCP discovery while retaining the real authenticated model registry.
              const registry = new Proxy(ctx.modelRegistry, {
                get(target, key) {
                  if (key === 'streamSimple')
                    return (selected, context, options) => {
                      childRequests.push({
                        context: structuredClone(context),
                        model: `${selected.provider}/${selected.id}`,
                      });
                      assert.ok(childRequests.length <= 2, 'Unexpected extra child request.');
                      return target.streamSimple(selected, context, options);
                    };
                  const value = Reflect.get(target, key);
                  return typeof value === 'function' ? value.bind(target) : value;
                },
              });
              const result = await tool.execute(id, params, signal, update, {
                ...ctx,
                modelRegistry: registry,
                agentDir: directory,
              } as ExtensionToolContext);
              if (tool.name === 'subagents_wait') results.push(result.structuredContent);
              return result;
            },
          });
        },
      } as ExtensionAPI;
      extension(wrapped);
    },
  ],
});
let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    model,
    thinkingLevel: 'low',
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(directory),
    tools: [
      'subagents_list',
      'subagents_launch',
      'subagents_wait',
      'subagents_status',
      'subagents_discard',
    ],
  }));
  await session.bindExtensions({});
  let parentTurns = 0;
  session.subscribe((event) => {
    if (event.type === 'turn_start' && ++parentTurns > 8) void session!.abort();
  });
  timer = setTimeout(() => {
    void session?.abort();
    void Promise.all(cleanup.map((fn) => fn()));
  }, 120_000);
  await session.prompt(
    'This is an explicit subagent integration test. Use the named agent whose description says live discovery verification. Launch exactly one child with a unique name, agent set to that discovered type, prompt "Perform your verification task.", tools: [], and thinkingLevel: "low". Do not copy or read its definition. Wait using subagents_wait, inspect its status, and report the exact token it returns. Do not launch any other children.',
  );
  assert.equal(
    launches.length,
    1,
    JSON.stringify(
      session.messages
        .filter((message) => message.role === 'assistant' || message.role === 'toolResult')
        .map((message) => ({
          role: message.role,
          content: message.content,
          error: 'errorMessage' in message ? message.errorMessage : undefined,
        })),
    ),
  );
  assert.ok(childRequests.length >= 1);
  assert.ok(
    JSON.stringify(childRequests[0].context).includes(nonce),
    'Runtime must inject the role body before the child request.',
  );
  assert.ok(
    !JSON.stringify(launches).includes(nonce),
    'Parent task must not contain the private role token.',
  );
  assert.ok(
    results.some((result) =>
      result.agents.some((agent) => agent.status === 'completed' && agent.result.includes(nonce)),
    ),
  );
  assert.ok(
    session.getLastAssistantText()?.includes(nonce),
    'Parent must integrate the child report.',
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      provider,
      model: modelId,
      parentTurns,
      childRequests: childRequests.length,
      agent: launches[0].tasks[0].agent,
      checks: [
        'automatic catalog discovery',
        'model-selected named role',
        'runtime system-prompt injection',
        'real child completion',
        'parent synthesis',
      ],
    }),
  );
} finally {
  if (timer) clearTimeout(timer);
  await Promise.all(cleanup.map((fn) => fn()));
  session?.dispose();
  await rm(directory, { recursive: true, force: true });
}
