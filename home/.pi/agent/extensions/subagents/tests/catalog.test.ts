import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { registerAgentCatalog } from '../catalog.ts';

// Real AgentSession prompt lifecycle; provider is entirely scripted and never makes network calls.
for (const forced of [false, true]) {
  test(`parent catalog refreshes without stale entries or duplicate sections (${forced ? 'forced' : 'structured'} prompt)`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-agent-catalog-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const roleDir = join(dir, '.agents', 'agents');
    await mkdir(roleDir, { recursive: true });
    const file = join(roleDir, 'role.md');
    const writeRole = name => writeFile(file, `---\nname: ${name}\ndescription: Fixture named-agent description.\n---\nBODY_MUST_NOT_REACH_PARENT\n`);
    await writeRole('first-catalog-probe');
    const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off', retry: { enabled: false } }, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir, settingsManager,
      noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [
        ...(forced ? [pi => { pi.on('before_agent_start', () => ({ systemPrompt: 'FORCED_PARENT_PREFIX' })); }] : []),
        registerAgentCatalog,
      ],
    });
    await resourceLoader.reload();
    const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, modelsStorePath: join(dir, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
    const requests = [];
    runtime.registerProvider('catalog-test', {
      baseUrl: 'http://127.0.0.1:9', apiKey: 'scripted', api: 'openai-completions',
      models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple(model, context) {
        requests.push(structuredClone(context));
        const stream = createAssistantMessageEventStream();
        const message = {
          role: 'assistant', content: [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now(),
        };
        queueMicrotask(() => { stream.push({ type: 'done', reason: 'stop', message }); stream.end(); });
        return stream;
      },
    });
    const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModel('catalog-test', 'scripted'), settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(dir), tools: [] });
    t.after(() => session.dispose());
    await session.bindExtensions({});
    for (const [step, expected, absent] of [[1, 'first-catalog-probe', 'second-catalog-probe'], [2, 'second-catalog-probe', 'first-catalog-probe'], [3, null, 'second-catalog-probe']]) {
      if (step === 2) await writeRole('second-catalog-probe');
      if (step === 3) await unlink(file);
      await session.prompt(`Turn ${step}`);
      const systemMessages = requests.at(-1).messages.filter(message => message.role === 'system');
      let prompt = '';
      let sections = {};
      for (const message of systemMessages) {
        if (message.content) { prompt = message.content; sections = {}; }
        if (message.sections) {
          for (const [key, value] of Object.entries(message.sections)) {
            if (value === null) delete sections[key];
            else sections[key] = value;
          }
          prompt = Object.values(sections).join('\n');
        }
      }
      assert.equal(prompt.split('<subagent_definitions>').length - 1, 1);
      if (forced) assert.ok(prompt.startsWith('FORCED_PARENT_PREFIX'));
      if (expected) assert.ok(prompt.includes(expected));
      assert.ok(!prompt.includes(absent));
      assert.ok(!prompt.includes('BODY_MUST_NOT_REACH_PARENT'));
      assert.equal(session.getLastAssistantText(), 'done');
    }
  });
}
