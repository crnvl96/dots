// Run from home/.pi: npm run test:subagents
// Uses the real in-process Agent with controlled provider streams; no network or pi subprocess.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import fsPromises, { mkdtemp, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { Type } from 'typebox';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Agent } from '@earendil-works/pi-agent-core';
import { CustomEditor, DefaultResourceLoader, SettingsManager, initTheme } from '@earendil-works/pi-coding-agent';
import { KeybindingsManager, TUI_KEYBINDINGS, TuiAltScreen, TuiMainScreen, Text, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { jobStats } from '../formatting.ts';
import extension from '../index.ts';

const parentModel = {
  id: 'parent-model', provider: 'parent-provider', api: 'openai-completions',
  name: 'Parent', reasoning: true, input: ['text'], contextWindow: 100_000, maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const childModel = { ...parentModel, id: 'child-model', provider: 'child-provider' };

async function until(predicate) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail('Expected asynchronous condition was not reached');
}

function harness(t, mode = 'print', renderer) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-subagents-harness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tools = new Map();
  const events = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const widgets = new Map();
  const dialogs = [];
  const inputListeners = new Set();
  const notices = [];
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  let renders = 0;
  const tui = renderer ?? { terminal: { rows: 32, columns: 100 }, requestRender() { renders++; },
    getFocusedComponent() { return undefined; }, hasOverlay() { return false; } };
  const ui = {
    theme,
    setWidget(name, factory) {
      widgets.get(name)?.dispose();
      if (factory) widgets.set(name, factory(tui, theme));
      else widgets.delete(name);
    },
    notify(text, level) { notices.push({ text, level }); },
    custom() { assert.fail('The inline menu must never open a dialog'); },
    getEditorText() { return ''; },
    onTerminalInput(listener) {
      inputListeners.add(listener);
      const unsubscribe = renderer?.addInputListener(listener);
      return () => {
        inputListeners.delete(listener);
        unsubscribe?.();
      };
    },
  };
  initTheme('dark', false);
  const notifications = [];
  const requests = [];
  const nested = [];
  const active = ['read', 'subagents_launch', 'subagents_steer', 'subagents_wait', 'subagents_discard', 'subagents_status'];
  const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
  const ctx = {
    mode, hasUI: mode === 'tui' || mode === 'rpc', ui,
    cwd: directory,
    agentDir: directory,
    model: parentModel,
    thinkingLevel: 'medium',
    getSystemPrompt: () => 'Parent effective system prompt',
    isProjectTrusted: () => true,
    tools: ['read', 'perplexity_search', 'subagents_launch', 'subagents_steer', 'subagents_wait', 'subagents_discard', 'subagents_status'].map((name) => ({
      name, label: name, description: name, parameters: schema,
      execute() { assert.fail('Tools must go through ctx.executeTool, not bypass parent hooks'); },
    })),
    async executeTool(name, args, options) {
      nested.push({ name, args, options });
      return { result: { content: [{ type: 'text', text: 'permission denied' }], details: { checked: true } }, isError: true };
    },
    modelRegistry: {
      find(provider, id) {
        return [parentModel, childModel].find((model) => model.provider === provider && model.id === id);
      },
      streamSimple(model, context, options) {
        const stream = createAssistantMessageEventStream();
        const request = {
          model, context: structuredClone(context), options, stream,
          finish(text = 'done', stopReason = 'stop', extra = {}) {
            const message = {
              role: 'assistant', content: [{ type: 'text', text }],
              api: model.api, provider: model.provider, model: model.id,
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason, timestamp: Date.now(), ...extra,
            };
            stream.push(stopReason === 'error' || stopReason === 'aborted'
              ? { type: 'error', reason: stopReason, error: message }
              : { type: 'done', reason: stopReason, message });
            stream.end();
          },
        };
        options?.signal?.addEventListener('abort', () => request.finish('', 'aborted'), { once: true });
        if (options?.signal?.aborted) queueMicrotask(() => request.finish('', 'aborted'));
        requests.push(request);
        return stream;
      },
    },
  };
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); },
    on(event, handler) { events.set(event, handler); },
    getActiveTools() { return active; },
    getThinkingLevel() { return 'low'; },
    getSettings() { return { retry: { enabled: false }, cacheWarming: 'off', defaultTools: ['read', 'bash', 'edit', 'write'] }; },
    sendMessage(message, options) { notifications.push({ message, options }); },
  };
  extension(pi);
  const call = (name, params, signal) => tools.get(name).execute('parent-call', params, signal, undefined, ctx);
  let nextName = 0;
  // Existing lifecycle fixtures use generated test names; name-contract tests call
  // the raw tool so missing names cannot be hidden by this convenience helper.
  const launch = (tasks, signal) => call('subagents_launch', { tasks: tasks.map(task => ({
    name: `${task.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '') || 'task'}-${++nextName}`,
    ...task,
  })) }, signal);
  const steer = (id, prompt) => call('subagents_steer', { id, prompt });
  t.after(() => events.get('session_shutdown')());
  return { tools, events, commands, shortcuts, widgets, dialogs, notices, tui, inputListeners,
    get renders() { return renders; }, notifications, requests, nested, active, ctx, pi, call, launch, steer };
}

function useChildTools(h, tools) {
  h.ctx.extensionFactories = [(pi) => {
    for (const [name, execute] of Object.entries(tools)) {
      pi.registerTool({
        name, label: name, description: name,
        parameters: Type.Object({ path: Type.Optional(Type.String()) }),
        execute,
      });
    }
  }];
}

function system(request) {
  const message = request.context.messages.find((message) => message.role === 'system') ?? {};
  const sections = message.sections ? Object.values(message.sections).filter(Boolean).join('\n') : '';
  const content = (typeof message.content === 'string' && message.content) ? message.content : sections || request.context.systemPrompt || '';
  return { ...message, content, toolsAdded: message.toolsAdded ?? request.context.tools?.map((tool) => ({ name: tool.name })) ?? [] };
}

function userTexts(request) {
  return request.context.messages.filter((message) => message.role === 'user').map((message) => (
    typeof message.content === 'string' ? message.content : message.content.map((part) => part.text).join('\n')
  ));
}

test('loads through Pi’s real extension loader', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagents-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager: SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [fileURLToPath(new URL('../index.ts', import.meta.url))],
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.deepEqual([...result.extensions[0].tools.keys()], ['subagents_list', 'subagents_launch', 'subagents_steer', 'subagents_wait', 'subagents_discard', 'subagents_status']);
  assert.equal(result.extensions[0].commands.size, 0);
  assert.equal(result.extensions[0].shortcuts.size, 0);
});

test('registers launch, steer, wait, discard and status tools with structured output contracts', (t) => {
  const h = harness(t);
  assert.deepEqual([...h.tools.keys()], ['subagents_list', 'subagents_launch', 'subagents_steer', 'subagents_wait', 'subagents_discard', 'subagents_status']);
  for (const tool of h.tools.values()) assert.equal(tool.outputSchema.type, 'object');
});

test('launch description defaults to direct work and requires a worthwhile delegation benefit', (t) => {
  const { description } = harness(t).tools.get('subagents_launch');
  assert.match(description, /substantial, well-bounded tasks/);
  assert.match(description, /parallel progress, context isolation, or independent verification/);
  assert.match(description, /outweighs startup and coordination overhead/);
  assert.match(description, /Work directly by default; independence alone is not enough/);
  assert.match(description, /Reports arrive automatically/);
});

test('parent delegation guidelines discourage microtasks, idle handoffs, fan-out and duplicate work', (t) => {
  const { promptGuidelines } = harness(t).tools.get('subagents_launch');
  const guidance = promptGuidelines.join('\n');
  assert.match(guidance, /Work directly by default/);
  assert.match(guidance, /outweighs delegation overhead/);
  assert.match(guidance, /user explicitly requests subagents/);
  assert.match(guidance, /Independence alone is not enough/);
  for (const task of ['routine searches', 'a few file reads', 'small edits', 'ordinary test commands', 'tightly coupled planning/implementation/testing']) {
    assert.ok(guidance.includes(task), `Missing keep-local guidance for ${task}`);
  }
  assert.match(guidance, /parallel tool calls for simple concurrency/);
  assert.match(guidance, /Keep the immediate critical path local/);
  assert.match(guidance, /immediately wait unless context isolation or independent verification/);
  assert.match(guidance, /useful non-overlapping work the parent can continue/);
  assert.match(guidance, /normally one or two/);
  assert.match(guidance, /Add more only for clearly justified substantial workstreams/);
  assert.match(guidance, /Do not duplicate delegated work/);
  assert.match(guidance, /bounded outcome.*file ownership.*concise evidence/);
  assert.match(guidance, /does not inherit conversation history/);
  assert.doesNotMatch(guidance, /Use subagents_launch for independent work\./);
  // Retain the background lifecycle and result-validation guidance.
  assert.match(guidance, /automatically resume an idle parent/);
  assert.match(guidance, /Do not declare delegated work complete until you have checked its result/);
  assert.match(guidance, /Check each returned status before continuing/);
  assert.match(guidance, /After reviewing and integrating.*subagents_discard/);
  assert.match(guidance, /never discard unread results/);
});

test('finished jobs retain live sessions until discard and preserve bounded reports', async (t) => {
  const h = harness(t, 'tui');
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'release heavy state' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  const job = menu.actions.jobs().find(job => job.id === id);
  h.ctx.executeTool = async () => ({
    result: { content: [{ type: 'text', text: 'HEAVY_TOOL_PAYLOAD'.repeat(10000) }], details: undefined },
    isError: false,
  });
  h.requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'heavy-read', name: 'read', arguments: { path: 'large.txt' } }],
  });
  await until(() => h.requests.length === 2);
  streamPartial(h.requests[1], 'partial response', 'private reasoning');
  assert.ok(job.agent);
  assert.ok(job.tools.size);
  h.requests[1].finish('small final report');
  const waited = await h.call('subagents_wait', { ids: [id] });
  assert.match(waited.structuredContent.agents[0].result, /small final report/);
  assert.ok(job.agent, 'Finished sessions stay retained until discard or eviction.');
  assert.equal(typeof job.unsubscribe, 'function');
  assert.equal(job.done, undefined);
  assert.equal(screen(menu), '');
  await h.call('subagents_discard', { ids: [id] });
  assert.equal(job.agent, undefined);
  assert.equal(job.unsubscribe, undefined);
  assert.equal(job.tools.size, 0);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  assert.equal(h.notifications.length, 1); // Delivered report is not retracted.
});

test('discard validates the full batch, rejects unfinished jobs and removes only selected finished reports', async (t) => {
  const h = harness(t);
  const { details: { ids: [finished, running] } } = await h.launch([{ prompt: 'finished' }, { prompt: 'still running' }]);
  await until(() => h.requests.length === 2);
  h.requests[0].finish('reviewed answer');
  await h.call('subagents_wait', { ids: [finished] });
  for (const ids of [[], [finished, finished], [finished, 'missing'], [finished, running], [finished.slice(0, 8)]]) {
    await assert.rejects(h.call('subagents_discard', { ids }));
    assert.equal((await h.call('subagents_status', {})).structuredContent.agents.length, 2);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.call('subagents_discard', { ids: [finished] }, controller.signal), { name: 'AbortError' });
  const result = await h.call('subagents_discard', { ids: [finished] });
  assert.deepEqual(result.structuredContent, { ids: [finished] });
  await assert.rejects(h.call('subagents_status', { id: finished }), /Unknown or no longer retained/);
  await assert.rejects(h.call('subagents_wait', { ids: [finished] }), /Unknown or no longer retained/);
  await assert.rejects(h.steer(finished, 'late guidance'), /no longer retained/);
  await assert.rejects(h.call('subagents_discard', { ids: [finished] }), /Unknown or no longer retained/);
  assert.equal(h.requests[1].options.signal.aborted, false);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents.map(job => job.id), [running]);
});

test('discard does not invalidate reports held by an already-running batch wait', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch([{ prompt: 'first' }, { prompt: 'second' }]);
  await until(() => h.requests.length === 2);
  const waiting = h.call('subagents_wait', { ids });
  h.requests[0].finish('first findings');
  await h.call('subagents_wait', { ids: [ids[0]] });
  await h.call('subagents_discard', { ids: [ids[0]] });
  h.requests[1].finish('second findings');
  const result = (await waiting).structuredContent;
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.agents.map(agent => agent.id), ids);
  assert.match(result.agents[0].result, /first findings/);
  assert.match(result.agents[1].result, /second findings/);
});

for (const stopReason of ['error', 'aborted']) {
  test(`failed jobs release agent state and can be discarded even if notification enqueue fails (${stopReason})`, async (t) => {
    const h = harness(t, 'tui');
    t.mock.method(console, 'error', () => {});
    h.pi.sendMessage = () => { throw new Error('enqueue unavailable'); };
    const { details: { ids: [id] } } = await h.launch([{ prompt: 'failure cleanup' }]);
    await until(() => h.requests.length === 1);
    const job = h.widgets.get('subagents.pi').actions.jobs().find(job => job.id === id);
    h.requests[0].finish('recoverable findings', stopReason, { errorMessage: 'provider failed' });
    const result = (await h.call('subagents_wait', { ids: [id] })).structuredContent.agents[0];
    assert.equal(result.notification, 'failed');
    assert.equal(result.status, 'failed');
    assert.match(result.result, /recoverable findings/);
    assert.ok(job.agent);
    assert.equal(typeof job.unsubscribe, 'function');
    await h.call('subagents_discard', { ids: [id] });
    assert.equal(job.agent, undefined);
    assert.equal(job.unsubscribe, undefined);
  });
}

test('launch requires short kebab-case names and uses them unchanged as IDs throughout the lifecycle', async (t) => {
  const h = harness(t, 'tui');
  const taskSchema = h.tools.get('subagents_launch').parameters.properties.tasks.items;
  assert.ok(taskSchema.required.includes('name'));
  assert.equal(taskSchema.properties.name.maxLength, 48);
  assert.match(h.tools.get('subagents_launch').promptGuidelines.join('\n'), /meaningful short kebab-case name/);
  const launched = await h.call('subagents_launch', { tasks: [
    { name: 'review-parser', prompt: 'Full task context that must not appear in the footer' },
    { name: 'write-tests', prompt: 'Another detailed assignment for the child' },
  ] });
  assert.deepEqual(launched.structuredContent.ids, ['review-parser', 'write-tests']);
  assert.deepEqual(launched.structuredContent.agents.map(agent => agent.id), ['review-parser', 'write-tests']);
  await until(() => h.requests.length === 2);
  const widget = screen(h.widgets.get('subagents.pi'));
  assert.match(widget, /review-parser/);
  assert.match(widget, /write-tests/);
  assert.doesNotMatch(widget, /Full task context|Another detailed|Ctrl\+Shift\+A|\/subagents/);
  const steered = await h.steer('review-parser', 'Additional direction');
  assert.equal(steered.structuredContent.accepted, true);
  assert.equal((await h.call('subagents_status', { id: 'review-parser' })).structuredContent.agents[0].id, 'review-parser');
  h.requests[0].finish('first pass');
  h.requests[1].finish('tests complete');
  await until(() => h.requests.length === 3);
  h.requests[2].finish('final parser review');
  const result = await h.call('subagents_wait', { ids: ['review-parser', 'write-tests'] });
  assert.deepEqual(result.structuredContent.agents.map(agent => agent.id), ['review-parser', 'write-tests']);
  assert.match(result.structuredContent.agents[0].result, /Subagent review-parser completed/);
  assert.ok(h.notifications.some(item => item.message.details.id === 'review-parser'));
  await h.call('subagents_discard', { ids: ['review-parser', 'write-tests'] });
  assert.equal(screen(h.widgets.get('subagents.pi')), '');
});

test('invalid, missing and duplicate names reject the whole batch without starting or reserving children', async (t) => {
  const h = harness(t);
  for (const name of [undefined, null, 123, '', ' ', 'Upper-case', 'two words', 'snake_case', '-leading',
    'trailing-', 'double--dash', '1-leading', '日本語', 'line-break\n', 'a'.repeat(49)]) {
    await assert.rejects(h.call('subagents_launch', { tasks: [
      { name: 'valid-task', prompt: 'valid' }, { name, prompt: 'invalid name' },
    ] }), /lowercase kebab-case/);
  }
  await assert.rejects(h.call('subagents_launch', { tasks: [
    { name: 'same-name', prompt: 'one' }, { name: 'same-name', prompt: 'two' },
  ] }), /name already used/);
  await assert.rejects(h.call('subagents_launch', { tasks: [
    { name: 'valid-task', prompt: 'valid' }, { name: 'bad-model', prompt: 'invalid model', model: 'missing' },
  ] }), /Unknown subagent model/);
  assert.equal(h.requests.length, 0);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  const result = await h.call('subagents_launch', { tasks: [{ name: 'valid-task', prompt: 'allowed after failed validation' }] });
  assert.deepEqual(result.structuredContent.ids, ['valid-task']);
  await until(() => h.requests.length === 1);
});

test('names cannot collide across concurrent launches or be reused after discard, but reset with the session', async (t) => {
  const h = harness(t);
  const launch = () => h.call('subagents_launch', { tasks: [{ name: 'review-parser', prompt: 'task' }] });
  const attempts = await Promise.allSettled([launch(), launch()]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('report');
  await h.call('subagents_wait', { ids: ['review-parser'] });
  await h.call('subagents_discard', { ids: ['review-parser'] });
  await assert.rejects(launch(), /name already used/);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  await h.events.get('session_start')();
  assert.deepEqual((await launch()).structuredContent.ids, ['review-parser']);
  await until(() => h.requests.length === 2);
});

test('inline menu has no mouse entry point, commands, shortcuts or dialogs', async (t) => {
  const h = harness(t, 'tui');
  assert.equal(h.commands.size, 0);
  assert.equal(h.shortcuts.size, 0);
  await h.launch([{ name: 'menu-target', prompt: 'private task text' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  assert.equal(menu.handleMouse, undefined);
  assert.equal(menu.handleInput('\r'), false);
  assert.equal(menu.handleInput('guidance'), false);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.inputListeners.size, 1);
  assert.equal(h.notifications.length, 0);
});

test('launch returns IDs without waiting; children run in parallel and notify out of order exactly once', async (t) => {
  const h = harness(t);
  const result = await h.launch([{ prompt: 'first task' }, { prompt: 'second task' }]);
  const [firstId, secondId] = result.details.ids;
  assert.notEqual(firstId, secondId);
  assert.equal(h.notifications.length, 0);
  await until(() => h.requests.length === 2);
  assert.notEqual(h.requests[0].options.sessionId, h.requests[1].options.sessionId);

  h.requests[1].finish('second answer');
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.id, secondId);
  assert.match(h.notifications[0].message.content, /second answer/);
  assert.deepEqual(h.notifications[0].options, { triggerTurn: true, deliverAs: 'steer' });
  assert.equal(h.notifications[0].message.display, true);
  assert.equal(h.notifications[0].message.customType, 'subagents.pi');

  h.requests[0].finish('first answer');
  await until(() => h.notifications.length === 2);
  assert.equal(h.notifications[1].message.details.id, firstId);
  assert.match(h.notifications[1].message.content, /first answer/);
  const late = await h.steer(firstId, 'too late');
  assert.equal(late.structuredContent.accepted, false);
  assert.equal(late.structuredContent.agent.status, 'completed');
  assert.match(late.structuredContent.agent.result, /first answer/);
  assert.equal(h.notifications.length, 2);
});

function writeRole(h, body = 'ROLE_ONLY_TOKEN: zeta-seven', extra = '') {
  const dir = join(h.ctx.cwd, '.agents', 'agents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'fixture-role.md');
  writeFileSync(path, `---\nname: fixture-reviewer\ndescription: Review fixture logic independently.\n${extra}---\n${body}\n`);
  return realpathSync(path);
}

test('named definitions are discoverable without launching jobs or exposing their bodies to the parent', async (t) => {
  const h = harness(t);
  const path = writeRole(h);
  const result = await h.call('subagents_list', {});
  assert.deepEqual(result.structuredContent.agents.find(a => a.name === 'fixture-reviewer'), {
    name: 'fixture-reviewer', description: 'Review fixture logic independently.', filePath: path, source: 'project',
  });
  assert.doesNotMatch(JSON.stringify(result), /zeta-seven/);
  assert.equal(h.requests.length, 0);
  const event = { systemPromptOptions: { sections: { existing: 'preserved' } } };
  h.events.get('before_agent_start')(event, h.ctx);
  assert.match(event.systemPromptOptions.sections.subagent_definitions, /fixture-reviewer/);
  assert.doesNotMatch(event.systemPromptOptions.sections.subagent_definitions, /zeta-seven/);
  assert.equal(event.systemPromptOptions.sections.existing, 'preserved');
  unlinkSync(path);
  h.events.get('before_agent_start')(event, h.ctx);
  assert.doesNotMatch(event.systemPromptOptions.sections.subagent_definitions, /fixture-reviewer/);
});

test('named launch injects its body and source path into the real child system prompt, separate from the task', async (t) => {
  const h = harness(t);
  const path = writeRole(h);
  const result = await h.launch([{ name: 'role-job', agent: 'fixture-reviewer', prompt: 'Review my change.', tools: [], appendSystemPrompt: 'Task appendix' }]);
  await until(() => h.requests.length === 1);
  const prompt = system(h.requests[0]).content;
  assert.match(prompt, /^Parent effective system prompt/);
  assert.ok(prompt.includes(path));
  assert.match(prompt, /ROLE_ONLY_TOKEN: zeta-seven/);
  assert.ok(prompt.indexOf('child Pi session') < prompt.indexOf('ROLE_ONLY_TOKEN'));
  assert.ok(prompt.indexOf('ROLE_ONLY_TOKEN') < prompt.indexOf('Task appendix'));
  assert.deepEqual(userTexts(h.requests[0]), ['Review my change.']);
  assert.deepEqual(system(h.requests[0]).toolsAdded ?? [], []);
  assert.equal(result.structuredContent.agents[0].agentType, 'fixture-reviewer');
  assert.equal(result.structuredContent.agents[0].agentFile, path);
  h.requests[0].finish('role used');
  await until(() => h.notifications.length === 1);
  const status = await h.call('subagents_status', { id: 'role-job' });
  assert.equal(status.structuredContent.agents[0].agentType, 'fixture-reviewer');
});

test('named instructions also load without a parent effective-prompt getter', async (t) => {
  const h = harness(t);
  writeRole(h);
  delete h.ctx.getSystemPrompt;
  await h.launch([{ agent: 'fixture-reviewer', prompt: 'Fallback parent prompt.', tools: [] }]);
  await until(() => h.requests.length === 1);
  assert.match(system(h.requests[0]).content, /ROLE_ONLY_TOKEN: zeta-seven/);
  h.requests[0].finish();
});

test('unknown or invalid roles fail the entire batch without model calls or name reservations', async (t) => {
  const h = harness(t);
  writeRole(h);
  const tasks = [{ name: 'valid-job', agent: 'fixture-reviewer', prompt: 'valid' }, { name: 'invalid-job', agent: 'missing-role', prompt: 'invalid' }];
  await assert.rejects(h.launch(tasks), /Unknown or invalid agent definition.*missing-role/);
  assert.equal(h.requests.length, 0);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  writeRole(h, 'bad configuration', 'permissionMode: bypassPermissions\n');
  await assert.rejects(h.launch([tasks[0]]), /Unknown or invalid agent definition/);
  const invalid = await h.call('subagents_list', {});
  assert.ok(invalid.structuredContent.diagnostics.some(d => d.includes('permissionMode')));
  writeRole(h);
  await h.launch([tasks[0]]); // The failed batch did not reserve valid-job.
  await until(() => h.requests.length === 1);
  h.requests[0].finish();
});

test('trusted-project definitions refresh on launch and do not leak into generic children', async (t) => {
  const h = harness(t);
  const path = writeRole(h, 'FIRST_ROLE_BODY');
  await h.launch([{ agent: 'fixture-reviewer', prompt: 'first', tools: [] }]);
  await until(() => h.requests.length === 1);
  writeRole(h, 'SECOND_ROLE_BODY');
  await h.launch([{ agent: 'fixture-reviewer', prompt: 'second', tools: [] }, { prompt: 'generic', tools: [] }]);
  await until(() => h.requests.length === 3);
  assert.match(system(h.requests[0]).content, /FIRST_ROLE_BODY/);
  assert.doesNotMatch(system(h.requests[0]).content, /SECOND_ROLE_BODY/);
  assert.match(system(h.requests[1]).content, /SECOND_ROLE_BODY/);
  assert.doesNotMatch(system(h.requests[2]).content, /FIRST_ROLE_BODY|SECOND_ROLE_BODY/);
  h.ctx.isProjectTrusted = () => false;
  assert.ok(!(await h.call('subagents_list', {})).structuredContent.agents.some(a => a.name === 'fixture-reviewer'));
  await assert.rejects(h.launch([{ agent: 'fixture-reviewer', prompt: 'untrusted' }]), /Unknown or invalid agent definition/);
  h.ctx.isProjectTrusted = () => true;
  unlinkSync(path);
  await assert.rejects(h.launch([{ agent: 'fixture-reviewer', prompt: 'deleted' }]), /Unknown or invalid agent definition/);
  h.requests.forEach(r => r.finish());
});

test('passes model, provider, thinking, exact tools, system prompt and prompt to the real Agent', async (t) => {
  const h = harness(t);
  await h.launch([{
    prompt: 'my task', provider: childModel.provider, model: childModel.id,
    thinkingLevel: 'high', tools: ['read'], appendSystemPrompt: 'Custom system instructions',
  }]);
  await until(() => h.requests.length === 1);
  const request = h.requests[0];
  assert.equal(request.model, childModel);
  assert.equal(request.options.reasoning, 'high');
  assert.match(system(request).content, /^Parent effective system prompt/);
  assert.match(system(request).content, /Custom system instructions$/);
  assert.deepEqual(system(request).toolsAdded.map((tool) => tool.name).sort(), ['read', 'subagents_ask']);
  assert.deepEqual(userTexts(request), ['my task']);
  request.finish('custom answer');
  await until(() => h.notifications.length === 1);
});

test('inherits model/thinking and all callable tools, without orchestration tools or parent history', async (t) => {
  const h = harness(t);
  await h.launch([{ prompt: 'default task' }, { prompt: 'explicit task', tools: ['read'] }]);
  await until(() => h.requests.length === 2);
  const request = h.requests[0];
  assert.equal(request.model, parentModel);
  assert.equal(request.options.reasoning, 'medium');
  assert.match(system(request).content, /^Parent effective system prompt/);
  assert.match(system(request).content, /child Pi session/);
  assert.match(system(request).content, /do not inherit its conversation history/i);
  assert.ok(system(request).toolsAdded.map((tool) => tool.name).includes('read'));
  assert.ok(system(request).toolsAdded.map((tool) => tool.name).includes('bash'));
  assert.ok(system(request).toolsAdded.map((tool) => tool.name).includes('subagents_ask'));
  assert.deepEqual(system(h.requests[1]).toolsAdded.map((tool) => tool.name).sort(), ['read', 'subagents_ask']);
  assert.deepEqual(userTexts(request), ['default task']);
  h.requests.forEach((request) => request.finish());
  await until(() => h.notifications.length === 2);
});

test('child sessions execute extension and MCP-named tools themselves, independent of the parent active loadout', async (t) => {
  const h = harness(t);
  h.active.splice(0, h.active.length, 'bash', 'codemode', 'subagents_launch');
  const seen = [];
  useChildTools(h, Object.fromEntries(['openrouter_web_search', 'mcp__example__search'].map((name) => [name, async (_id, args, signal) => {
    seen.push({ name, args, signal });
    return { content: [{ type: 'text', text: `${name} ok` }], details: {} };
  }])));
  await h.launch([{ prompt: 'use every callable tool' }]);
  await until(() => h.requests.length === 1);
  const enabled = system(h.requests[0]).toolsAdded.map((tool) => tool.name);
  for (const name of ['read', 'bash', 'edit', 'write', 'openrouter_web_search', 'mcp__example__search', 'subagents_ask']) {
    assert.ok(enabled.includes(name), name);
  }
  h.requests[0].finish('', 'toolUse', {
    content: ['openrouter_web_search', 'mcp__example__search'].map((name, i) => ({
      type: 'toolCall', id: `child-tool-${i}`, name, arguments: { path: 'example.ts' },
    })),
  });
  await until(() => h.requests.length === 2);
  assert.deepEqual(seen.map((call) => call.name).sort(), ['mcp__example__search', 'openrouter_web_search']);
  assert.ok(seen.every((call) => call.signal === h.requests[0].options.signal));
  assert.equal(h.nested.length, 0);
  h.requests[1].finish('child tools ran in the child');
  await until(() => h.notifications.length === 1);
});

test('explicit empty tools are respected and an empty append does not replace the parent prompt; thinking falls back to pi', async (t) => {
  const h = harness(t);
  delete h.ctx.thinkingLevel;
  await h.launch([{ prompt: 'no tools', tools: [], thinkingLevel: 'off', appendSystemPrompt: '   ' }, { prompt: 'fallback' }]);
  await until(() => h.requests.length === 2);
  const empty = h.requests.find((request) => userTexts(request).includes('no tools'));
  const fallback = h.requests.find((request) => userTexts(request).includes('fallback'));
  assert.deepEqual(system(empty).toolsAdded ?? [], []);
  assert.match(system(empty).content, /^Parent effective system prompt/);
  assert.doesNotMatch(system(empty).content, /Custom system instructions/);
  assert.equal(empty.options.reasoning, undefined); // Agent maps off to no reasoning.
  assert.equal(fallback.options.reasoning, 'low');
});

test('parallel launch calls keep independent IDs and state', async (t) => {
  const h = harness(t);
  const results = await Promise.all([h.launch([{ prompt: 'a' }]), h.launch([{ prompt: 'b' }])]);
  assert.notEqual(results[0].details.ids[0], results[1].details.ids[0]);
  await until(() => h.requests.length === 2);
  h.requests.forEach((request) => request.finish());
  await until(() => h.notifications.length === 2);
});

test('steering reaches the running child on its next request, not the parent', async (t) => {
  const h = harness(t);
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'original task' }]);
  await until(() => h.requests.length === 1);
  await h.steer(id, 'focus on tests instead');
  assert.equal(h.requests.length, 1);
  h.requests[0].finish('initial response');
  await until(() => h.requests.length === 2);
  assert.deepEqual(userTexts(h.requests[1]), ['original task', 'focus on tests instead']);
  assert.equal(h.notifications.length, 0);
  h.requests[1].finish('steered final response');
  await until(() => h.notifications.length === 1);
  assert.match(h.notifications[0].message.content, /steered final response/);
  assert.doesNotMatch(h.notifications[0].message.content, /initial response/);
});

test('child tools use the child signal, not the parent launch signal, and preserve error results', async (t) => {
  const h = harness(t);
  const seen = [];
  useChildTools(h, {
    guarded_read: async (_id, args, signal) => {
      seen.push({ args, signal });
      return { content: [{ type: 'text', text: 'permission denied' }], details: { checked: true }, isError: true };
    },
  });
  const controller = new AbortController();
  await h.launch([{ prompt: 'read a file', tools: ['guarded_read'] }], controller.signal);
  await until(() => h.requests.length === 1);
  controller.abort();
  assert.equal(h.requests[0].options.signal.aborted, false);
  h.requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'child-read', name: 'guarded_read', arguments: { path: 'example.ts' } }],
  });
  await until(() => h.requests.length === 2);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].args, { path: 'example.ts' });
  assert.equal(seen[0].signal, h.requests[0].options.signal);
  assert.notEqual(seen[0].signal, controller.signal);
  const toolResult = h.requests[1].context.messages.find((message) => message.role === 'toolResult');
  assert.equal(toolResult.isError, true);
  assert.equal(toolResult.content[0].text, 'permission denied');
  h.requests[1].finish('reported denial');
  await until(() => h.notifications.length === 1);
});

test('steering during a child tool execution waits for that tool, then changes the next turn', async (t) => {
  const h = harness(t);
  let release;
  let toolStarted = false;
  const toolFinished = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  useChildTools(h, {
    slow_read: async () => {
      toolStarted = true;
      await toolFinished;
      return { content: [{ type: 'text', text: 'file read' }], details: {} };
    },
  });
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'inspect files' }]);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'reading', name: 'slow_read', arguments: { path: 'file.ts' } }],
  });
  await until(() => toolStarted);
  await h.steer(id, 'only report the tests');
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 0);
  release();
  await until(() => h.requests.length === 2);
  assert.deepEqual(userTexts(h.requests[1]), ['inspect files', 'only report the tests']);
  h.requests[1].finish('test report');
  await until(() => h.notifications.length === 1);
});

test('validates the entire batch before starting any child', async (t) => {
  const h = harness(t);
  for (const invalid of [
    { prompt: 'bad model', model: 'does-not-exist' },
    { prompt: 'bad provider', provider: 'does-not-exist' },
    { prompt: 'bad tool', tools: ['does-not-exist'] },
    { prompt: 'no recursion', tools: ['subagents_launch'] },
    { prompt: 'no orchestration', tools: ['subagents_steer'] },
    { prompt: 'no sibling inspection', tools: ['subagents_status'] },
    { prompt: 'no sibling waiting', tools: ['subagents_wait'] },
    { prompt: '   ' },
  ]) {
    await assert.rejects(h.launch([{ prompt: 'valid' }, invalid]));
  }
  await assert.rejects(h.launch([]), /At least one/);
  await assert.rejects(h.steer('missing', 'hello'), /not running/);
  await assert.rejects(h.steer('missing', '  '), /must not be blank/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.launch([{ prompt: 'cancelled launch' }], controller.signal), /abort/i);
  assert.equal(h.requests.length, 0);
  assert.equal(h.notifications.length, 0);
});

test('reports provider failure once, including error details and any text response', async (t) => {
  const h = harness(t);
  await h.launch([{ prompt: 'fail' }]);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('partial output', 'error', { errorMessage: 'quota exhausted' });
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.status, 'failed');
  assert.match(h.notifications[0].message.content, /quota exhausted/);
  assert.match(h.notifications[0].message.content, /partial output/);
});

for (const stopReason of ['error', 'aborted']) {
  test(`queued steering cannot restart a provider ${stopReason}`, async (t) => {
    const h = harness(t);
    const { details: { ids: [id] } } = await h.launch([{ prompt: 'must fail once' }]);
    await until(() => h.requests.length === 1);
    await h.steer(id, 'do not implicitly restart after a hard exit');
    h.requests[0].finish('partial output', stopReason, { errorMessage: 'hard exit' });
    await until(() => h.notifications.length === 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.notifications[0].message.details.status, 'failed');
    assert.match(h.notifications[0].message.content, /hard exit/);
    const late = await h.steer(id, 'too late');
    assert.equal(late.structuredContent.accepted, false);
    assert.equal(late.structuredContent.agent.status, 'failed');
    assert.match(late.structuredContent.agent.result, /hard exit/);
    assert.equal(h.requests.length, 1);
  });
}

test('reports a thrown provider exception without an unhandled rejection', async (t) => {
  const h = harness(t);
  h.ctx.modelRegistry.streamSimple = () => { throw new Error('broken provider'); };
  await h.launch([{ prompt: 'fail' }]);
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.status, 'failed');
  assert.match(h.notifications[0].message.content, /broken provider/);
});

for (const event of ['session_shutdown', 'session_start', 'session_tree']) {
  test(`${event} aborts children, suppresses stale notifications, and is idempotent`, async (t) => {
    const h = harness(t);
    const { details: { ids: [id] } } = await h.launch([{ prompt: 'still running' }]);
    await until(() => h.requests.length === 1);
    await h.events.get(event)();
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.notifications.length, 0);
    await assert.rejects(h.steer(id, 'stale'), /not running/);
    await h.events.get(event)();
  });
}

test('large responses are truncated with the complete answer saved to a file', async (t) => {
  const h = harness(t);
  await h.launch([{ prompt: 'long answer' }]);
  await until(() => h.requests.length === 1);
  const answer = 'a long response\n'.repeat(3000);
  h.requests[0].finish(answer);
  await until(() => h.notifications.length === 1);
  const { content, details } = h.notifications[0].message;
  t.after(() => rm(dirname(details.fullOutputPath), { recursive: true, force: true }));
  assert.match(content, /Output truncated/);
  assert.ok(content.length < answer.length);
  const full = await readFile(details.fullOutputPath, 'utf8');
  assert.ok(full.endsWith(answer));
  assert.equal((await fsPromises.stat(details.fullOutputPath)).mode & 0o777, 0o600);
  const retained = (await h.call('subagents_status', { id: details.id })).structuredContent.agents[0];
  assert.equal(retained.fullOutputPath, details.fullOutputPath);
  assert.match(retained.result, /Output truncated/);
  assert.ok(retained.result.length < full.length);
});

function screen(component, width = 96) {
  return component.render(width).map(stripTerminalSequences).join('\n');
}

function streamPartial(request, text, thinking = '') {
  const partial = {
    role: 'assistant', api: request.model.api, provider: request.model.provider, model: request.model.id,
    content: [...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  };
  request.stream.push({ type: 'start', partial: structuredClone(partial) });
  request.stream.push({ type: 'text_delta', contentIndex: thinking ? 1 : 0, delta: text, partial });
  return partial;
}

test('TUI menu animates, advances timers and disappears after completion', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const h = harness(t, 'tui');
  assert.equal(h.widgets.size, 0); // No UI/timers during extension discovery.
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'Explore the repository' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  const initial = screen(menu);
  assert.match(initial, new RegExp(id));
  assert.match(initial, /0:00/);
  t.mock.timers.tick(100);
  assert.notEqual(screen(menu), initial);
  t.mock.timers.tick(60_900);
  assert.match(screen(menu), /1:01/);
  h.requests[0].finish('report');
  await until(() => h.notifications.length === 1);
  assert.equal(screen(menu), '');
  const renders = h.renders;
  t.mock.timers.tick(5000);
  assert.equal(h.renders, renders);
  const status = (await h.call('subagents_status', { id })).structuredContent.agents[0];
  assert.equal(status.elapsedMs, 61_000); // Finished duration is frozen.
});

test('headless orchestration stays independent of terminal UI', async (t) => {
  const h = harness(t);
  await h.launch([{ prompt: 'headless' }]);
  await until(() => h.requests.length === 1);
  assert.equal(h.commands.size, 0);
  assert.equal(h.shortcuts.size, 0);
  assert.equal(h.widgets.size, 0);
  assert.equal(h.dialogs.length, 0);
  h.requests[0].finish('headless result');
  await until(() => h.notifications.length === 1);
});

test('Ctrl+X immediately stops only the selected child and notifies once', async (t) => {
  const h = harness(t, 'tui');
  const { details: { ids } } = await h.launch([{ prompt: 'first child' }, { prompt: 'second child' }]);
  await until(() => h.requests.length === 2);
  const menu = h.widgets.get('subagents.pi');
  assert.equal(menu.handleInput('\x1b[B'), true); // Down selects the second child.
  assert.equal(menu.handleInput('x'), false);
  assert.equal(h.requests[1].options.signal.aborted, false);
  const waiting = h.call('subagents_wait', { ids: [ids[1]] });
  assert.equal(menu.handleInput('\x18'), true);
  assert.equal(h.requests[0].options.signal.aborted, false);
  assert.equal(h.requests[1].options.signal.aborted, true);
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.id, ids[1]);
  assert.equal(h.notifications[0].message.details.status, 'stopped');
  assert.match(h.notifications[0].message.content, /Stopped by user/);
  const waited = (await waiting).structuredContent;
  assert.equal(waited.timedOut, false);
  assert.equal(waited.agents[0].status, 'stopped');
  assert.match(waited.agents[0].result, /Stopped by user/);
  const late = await h.steer(ids[1], 'cannot restart');
  assert.equal(late.structuredContent.accepted, false);
  assert.equal(late.structuredContent.agent.status, 'stopped');
  assert.doesNotMatch(screen(menu), new RegExp(ids[1]));
  h.requests[0].finish('first answer');
  await until(() => h.notifications.length === 2);
  assert.equal(screen(menu), '');
  assert.equal(menu.handleInput('\x18'), false);
  assert.equal(h.notifications.length, 2);
});

test('stopping a running tool cancels its signal and discards queued steering without another turn', async (t) => {
  const h = harness(t, 'tui');
  let release;
  let childSignal;
  const gate = new Promise((resolve) => { release = resolve; });
  useChildTools(h, {
    slow_read: async (_id, _args, signal, onUpdate) => {
      childSignal = signal;
      onUpdate?.({ content: [{ type: 'text', text: 'partial tool output' }], details: undefined });
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
        release = resolve;
      });
      if (signal?.aborted) throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      return { content: [{ type: 'text', text: 'tool finished' }], details: {} };
    },
  });
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'run a tool' }]);
  await until(() => h.requests.length === 1);
  const enabled = system(h.requests[0]).toolsAdded.map((tool) => tool.name);
  assert.ok(enabled.includes('slow_read'), enabled.join(','));
  h.requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'slow-tool', name: 'slow_read', arguments: { path: 'slow.ts' } }],
  });
  try {
    await until(() => childSignal || h.requests.length > 1);
  } catch (error) {
    assert.fail(`${error.message} nested=${JSON.stringify(h.nested)} requests=${h.requests.length}`);
  }
  if (!childSignal) {
    const result = h.requests.at(-1).context.messages.find((message) => message.role === 'toolResult');
    assert.fail(JSON.stringify(result ?? h.requests.at(-1).context.messages.map((message) => message.role)));
  }
  const menu = h.widgets.get('subagents.pi');
  const job = menu.actions.jobs().find(job => job.id === id);
  assert.equal(job.tools.get('slow-tool').running, true);
  assert.match(JSON.stringify(job.tools.get('slow-tool').result), /partial tool output/);
  await h.steer(id, 'queued but must not run');
  assert.equal(menu.handleInput('\x18'), true);
  assert.equal(childSignal.aborted, true);
  assert.match(screen(menu), /stopping/);
  assert.equal(menu.handleInput('\x18'), true); // A stopping job cannot restart or be stopped twice.
  const late = await h.steer(id, 'do not revive this child');
  assert.equal(late.structuredContent.accepted, false);
  assert.equal(late.structuredContent.agent.status, 'stopping');
  release();
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.status, 'stopped');
  assert.ok(h.requests.slice(1).every((request) => request.options.signal.aborted));
  assert.equal(job.pendingSteers, 0);
  assert.equal(screen(menu), '');
});

test('inline menu fits narrow widths, Unicode tasks and short terminals', async (t) => {
  const h = harness(t, 'tui');
  await h.launch(Array.from({ length: 7 }, (_, i) => ({ prompt: `Task ${i} 日本語 👨‍👩‍👧‍👦 \x1b[31mcolors\x1b[0m\nmore` })));
  await until(() => h.requests.length === 7);
  const menu = h.widgets.get('subagents.pi');
  for (const width of [0, 1, 2, 3, 8, 24, 80]) {
    for (const rows of [8, 20, 40]) {
      h.tui.terminal.rows = rows;
      menu.invalidate();
      const lines = menu.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
      assert.ok(lines.length <= rows);
    }
  }
});

test('child counters use actual tool calls and finalized tokens', async (t) => {
  const h = harness(t, 'tui');
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'Inspect usage counters' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  const job = menu.actions.jobs().find(job => job.id === id);
  const partial = streamPartial(h.requests[0], 'Working');
  partial.usage.totalTokens = 999999;
  assert.doesNotMatch(jobStats(job), /tokens/); // No estimates from in-flight snapshots.
  h.requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'counter-read', name: 'read', arguments: { path: 'example.ts' } }],
    usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 1200,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  await until(() => h.requests.length === 2);
  assert.match(jobStats(job), /1 tool use · 1\.2K tokens/);
  h.requests[1].finish('Finished');
  await until(() => h.notifications.length === 1);
  assert.match(jobStats(job), /1 tool use · 1\.2K tokens/);
  assert.equal(screen(menu), '');
});

test('failed children disappear from the menu but remain available through status', async (t) => {
  const h = harness(t, 'tui');
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'Fail safely' }]);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('', 'error', { errorMessage: 'test failure' });
  await until(() => h.notifications.length === 1);
  assert.equal(screen(h.widgets.get('subagents.pi')), '');
  const job = (await h.call('subagents_status', { id })).structuredContent.agents[0];
  assert.equal(job.status, 'failed');
  assert.match(job.error, /test failure/);
});

test('a broken UI observer cannot fail the child agent or produce repeated observer errors', async (t) => {
  const h = harness(t, 'tui');
  await h.launch([{ prompt: 'keep working even if UI fails' }]);
  await until(() => h.requests.length === 1);
  const logged = t.mock.method(console, 'error', () => {});
  t.mock.method(h.tui, 'requestRender', () => { throw new Error('disposed renderer'); });
  streamPartial(h.requests[0], 'still working');
  await until(() => logged.mock.callCount() === 1);
  h.requests[0].finish('successful answer');
  await until(() => h.notifications.length === 1);
  assert.equal(h.notifications[0].message.details.status, 'completed');
  assert.match(h.notifications[0].message.content, /successful answer/);
  assert.equal(logged.mock.callCount(), 1);
});

test('session cleanup removes the menu and input listener and suppresses stale child notifications', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const h = harness(t, 'tui');
  await h.launch([{ prompt: 'cancel on session switch' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  assert.equal(h.inputListeners.size, 1);
  await h.events.get('session_tree')();
  assert.equal(h.widgets.size, 0);
  assert.equal(h.inputListeners.size, 0);
  assert.equal(menu.handleInput('\x18'), false);
  assert.equal(screen(menu), '');
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.notifications.length, 0);
  const renders = h.renders;
  t.mock.timers.tick(5000);
  assert.equal(h.renders, renders);
});

test('history is bounded without evicting running agents, and the menu retains the active child', async (t) => {
  const h = harness(t, 'tui');
  await h.launch([{ name: 'older-finished-child', prompt: 'older finished child' }]);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('older answer');
  await until(() => h.notifications.length === 1);
  const { details: { ids: [runningId] } } = await h.launch([{ prompt: 'keep this child running' }]);
  await until(() => h.requests.length === 2);
  const menu = h.widgets.get('subagents.pi');
  for (let i = 0; i < 24; i++) {
    await h.launch([{ prompt: `finished ${i}` }]);
    await until(() => h.requests.length === i + 3);
    h.requests[i + 2].finish(`answer ${i}`);
    await until(() => h.notifications.length === i + 2);
  }
  assert.match(screen(menu), new RegExp(runningId));
  assert.doesNotMatch(screen(menu), /older-finished-child|finished-\d+/);
  assert.equal(h.requests[1].options.signal.aborted, false);
  const retained = (await h.call('subagents_status', {})).structuredContent.agents;
  assert.equal(retained.length, 21);
  assert.equal(retained.find((job) => job.id === runningId).status, 'running');
  assert.ok(!retained.some((job) => job.prompt === 'older finished child'));
  await assert.rejects(h.launch([{ name: 'older-finished-child', prompt: 'must not reuse evicted name' }]), /name already used/);
});

test('bounded history evicts in completion order even when timestamps tie', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const h = harness(t, 'tui');
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'oldest finished child' }]);
  await until(() => h.requests.length === 1);
  const menu = h.widgets.get('subagents.pi');
  const job = menu.actions.jobs().find(job => job.id === id);
  h.requests[0].finish('Oldest answer');
  await until(() => h.notifications.length === 1);
  const completed = [];
  for (let i = 0; i < 21; i++) {
    const { details: { ids: [nextId] } } = await h.launch([{ prompt: `new child ${i}` }]);
    completed.push(nextId);
    await until(() => h.requests.length === i + 2);
    h.requests[i + 1].finish('new answer');
    await until(() => h.notifications.length === i + 2);
  }
  const retained = (await h.call('subagents_status', {})).structuredContent.agents;
  assert.deepEqual(retained.map(job => job.id), completed.slice(1));
  await assert.rejects(h.call('subagents_status', { id }), /Unknown or no longer retained/);
  assert.equal(job.agent, undefined);
  assert.equal(job.unsubscribe, undefined);
  assert.equal(screen(menu), '');
});

test('pending artifact delivery cannot be pruned or leak a notification into a new session', async (t) => {
  const h = harness(t, 'tui');
  const originalMkdtemp = fsPromises.mkdtemp;
  const originalWrite = fsPromises.writeFile;
  let release;
  let written;
  let blocked = false;
  const directories = [];
  const gate = new Promise((resolve) => { release = resolve; });
  const fileWritten = new Promise((resolve) => { written = resolve; });
  fsPromises.mkdtemp = async (...args) => {
    blocked = true;
    await gate;
    const directory = await originalMkdtemp(...args);
    directories.push(directory);
    return directory;
  };
  fsPromises.writeFile = async (...args) => { const result = await originalWrite(...args); written(); return result; };
  syncBuiltinESMExports();
  try {
    await h.launch([{ prompt: 'delayed large response' }]);
    await until(() => h.requests.length === 1);
    h.requests[0].finish('long output\n'.repeat(3000));
    await until(() => blocked);
    const pending = (await h.call('subagents_status', {})).structuredContent.agents[0];
    assert.equal(pending.status, 'completed');
    assert.equal(pending.notification, 'pending');
    const late = await h.steer(pending.id, 'too late even while output is being saved');
    assert.equal(late.structuredContent.accepted, false);
    assert.match(late.structuredContent.agent.result, /preparing full response file/);
    for (let i = 0; i < 21; i++) {
      await h.launch([{ prompt: `newer ${i}` }]);
      await until(() => h.requests.length === i + 2);
      h.requests[i + 1].finish('small response');
      await until(() => h.notifications.length === i + 1);
    }
    const cleanup = h.events.get('session_tree')();
    release();
    await fileWritten;
    await setImmediate();
    await cleanup;
    assert.equal(h.notifications.length, 21);
    assert.equal(h.widgets.size, 0);
  } finally {
    release();
    fsPromises.mkdtemp = originalMkdtemp;
    fsPromises.writeFile = originalWrite;
    syncBuiltinESMExports();
    await h.events.get('session_shutdown')();
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
  }
});

test('launch returns machine-readable IDs mapped to task prompts and selected models', async (t) => {
  const h = harness(t);
  const output = await h.launch([{ prompt: 'research' }, { prompt: 'tests', model: childModel.id, provider: childModel.provider }]);
  assert.deepEqual(output.structuredContent.ids, output.details.ids);
  const agents = output.structuredContent.agents;
  assert.deepEqual(agents.map((a) => [a.id, a.prompt, a.model, a.provider, a.status]), [
    [output.details.ids[0], 'research', parentModel.id, parentModel.provider, 'running'],
    [output.details.ids[1], 'tests', childModel.id, childModel.provider, 'running'],
  ]);
  assert.ok(agents.every((a) => a.result === null && a.notification === 'pending'));
  await until(() => h.requests.length === 2);
  h.requests.forEach((request) => request.finish('done'));
  await until(() => h.notifications.length === 2);
});

test('status is nonblocking, tracks queued guidance, and only includes a report for an explicit ID', async (t) => {
  const h = harness(t);
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent, { agents: [] });
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'inspect state' }]);
  await until(() => h.requests.length === 1);
  const steered = await h.steer(id, 'additional guidance');
  assert.equal(steered.structuredContent.accepted, true);
  assert.equal(steered.structuredContent.agent.pendingSteers, 1);
  const running = (await h.call('subagents_status', { id })).structuredContent.agents[0];
  assert.equal(running.status, 'running');
  assert.equal(running.pendingSteers, 1);
  assert.equal(running.result, null);
  assert.equal(h.requests.length, 1); // Inspection makes no provider call and never waits for completion.
  h.requests[0].finish('initial answer');
  await until(() => h.requests.length === 2);
  assert.equal((await h.call('subagents_status', { id })).structuredContent.agents[0].pendingSteers, 0);
  h.requests[1].finish('final retrieved report');
  await until(() => h.notifications.length === 1);
  const list = (await h.call('subagents_status', {})).structuredContent.agents;
  assert.equal(list[0].result, null);
  const completed = (await h.call('subagents_status', { id })).structuredContent.agents[0];
  assert.equal(completed.status, 'completed');
  assert.equal(completed.notification, 'queued');
  assert.match(completed.result, /Task: inspect state/);
  assert.match(completed.result, /final retrieved report/);
  assert.equal(h.notifications[0].message.details.prompt, 'inspect state');
  const late = await h.steer(id, 'late guidance');
  assert.equal(late.structuredContent.accepted, false);
  assert.match(late.content[0].text, /was not restarted/);
  assert.equal(late.structuredContent.agent.result, completed.result);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.requests.length, 2);
});

test('status rejects missing/stale IDs and cancellation and clears at session boundaries', async (t) => {
  const h = harness(t);
  await assert.rejects(h.call('subagents_status', { id: 'unknown' }), /Unknown or no longer retained/);
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'old session' }]);
  await until(() => h.requests.length === 1);
  await assert.rejects(h.call('subagents_status', { id }, AbortSignal.abort()), /abort/i);
  await h.events.get('session_tree')();
  assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  await assert.rejects(h.call('subagents_status', { id }), /Unknown or no longer retained/);
});

test('a failed notification enqueue retains the completed report for status and late steering', async (t) => {
  const h = harness(t);
  const logged = t.mock.method(console, 'error', () => {});
  h.pi.sendMessage = () => { throw new Error('synthetic enqueue failure'); };
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'recover report' }]);
  await until(() => h.requests.length === 1);
  h.requests[0].finish('important child findings');
  await until(() => logged.mock.callCount() === 1);
  const job = (await h.call('subagents_status', { id })).structuredContent.agents[0];
  assert.equal(job.status, 'completed');
  assert.equal(job.notification, 'failed');
  assert.equal(job.notificationError, 'synthetic enqueue failure');
  assert.match(job.result, /important child findings/);
  const waited = (await h.call('subagents_wait', { ids: [id] })).structuredContent;
  assert.equal(waited.timedOut, false);
  assert.deepEqual(waited.agents, [job]);
  assert.match((await h.steer(id, 'late guidance')).structuredContent.agent.result, /important child findings/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 0);
});

test('completion reaches a real busy parent Agent on its next turn, after all sibling tools finish', async (t) => {
  const h = harness(t);
  let release;
  let releaseSibling;
  let parentToolStarted = false;
  let siblingStarted = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const siblingGate = new Promise((resolve) => { releaseSibling = resolve; });
  const parent = new Agent({
    initialState: {
      model: parentModel, systemPrompt: 'Parent test',
      tools: [{ name: 'slow_read', label: 'Read', description: 'Controlled tool', parameters: {
        type: 'object', properties: { sibling: { type: 'boolean' } }, required: ['sibling'],
      },
        async execute(_id, args) {
          if (args.sibling) { siblingStarted = true; await siblingGate; }
          else { parentToolStarted = true; await gate; }
          return { content: [{ type: 'text', text: 'parent tool finished' }], details: undefined };
        } }],
    },
    streamFn: (model, context, options) => h.ctx.modelRegistry.streamSimple(model, context, options),
    // Match Pi custom-message conversion without booting another UI/session.
    convertToLlm: (messages) => messages.map((message) => message.role === 'custom'
      ? { role: 'user', content: message.content, timestamp: message.timestamp } : message),
  });
  t.after(async () => { release(); releaseSibling(); parent.abort(); await parent.waitForIdle(); });
  const running = parent.prompt('Keep doing useful work');
  await until(() => h.requests.length === 1);
  h.requests[0].finish('', 'toolUse', { content: [
    { type: 'toolCall', id: 'slow', name: 'slow_read', arguments: { sibling: false } },
    { type: 'toolCall', id: 'sibling', name: 'slow_read', arguments: { sibling: true } },
  ] });
  await until(() => parentToolStarted);
  h.pi.sendMessage = (message, options) => {
    h.notifications.push({ message, options });
    const custom = { ...message, role: 'custom', timestamp: Date.now() };
    // This is the same busy-session routing as AgentSession.sendCustomMessage.
    if (options.deliverAs === 'followUp') parent.followUp(custom);
    else parent.steer(custom);
  };
  await h.launch([{ prompt: 'Return findings while parent is busy' }]);
  await until(() => h.requests.length === 2);
  h.requests[1].finish('USE THESE FINDINGS BEFORE FINALIZING');
  await until(() => h.notifications.length === 1);
  assert.equal(h.requests.length, 2); // No interruption of the parent's running tool.
  release();
  await until(() => siblingStarted);
  await setImmediate();
  assert.equal(h.requests.length, 2); // First tool finished, but its sibling is still running.
  releaseSibling();
  await until(() => h.requests.length === 3);
  const next = h.requests[2].context.messages;
  assert.equal(next.filter((m) => m.role === 'toolResult').length, 2);
  const toolIndex = next.findLastIndex((m) => m.role === 'toolResult');
  const completionIndex = next.findIndex((m) => m.role === 'user' && String(m.content).includes('USE THESE FINDINGS'));
  assert.ok(toolIndex >= 0 && completionIndex > toolIndex, 'completion must arrive after tool results, before the next parent request');
  h.requests[2].finish('Parent incorporated child findings');
  await running;
  assert.equal(h.requests.length, 3); // No redundant post-final follow-up request.
  assert.equal(h.notifications.length, 1);
});

for (const Renderer of [TuiAltScreen, TuiMainScreen]) {
  test(`inline menu integrates with real ${Renderer.name} rendering, input, resize and parent focus`, async (t) => {
    const terminal = {
      columns: 100, rows: 32, kittyProtocolActive: false,
      start(input, resize) { this.input = input; this.resize = resize; },
      stop() {}, write() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
      clearScreen() {}, moveBy() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
    };
    const renderer = new Renderer(terminal);
    const h = harness(t, 'tui', renderer);
    t.after(() => renderer.stop());
    const plain = (text) => text;
    const editor = new CustomEditor(renderer, {
      borderColor: plain,
      selectList: { selectedPrefix: plain, selectedText: plain, description: plain, scrollInfo: plain, noMatch: plain },
    }, new KeybindingsManager(TUI_KEYBINDINGS));
    const submitted = [];
    editor.onSubmit = (text) => submitted.push(text);
    h.ctx.ui.getEditorText = () => editor.getText();
    renderer.addChild(new Text('Parent session remains running', 0, 0));
    renderer.addChild(editor);
    renderer.setFocus(editor);
    renderer.start();
    const rendered = () => (renderer instanceof TuiAltScreen ? renderer.getScreenLines()
      : renderer.captureRenderState().previousLines).map(stripTerminalSequences).join('\n');
    const { details: { ids } } = await h.launch([
      { name: 'first-child', prompt: 'Private first assignment' },
      { name: 'second-child', prompt: 'Private second assignment' },
    ]);
    await until(() => h.requests.length === 2);
    const menu = h.widgets.get('subagents.pi');
    renderer.addChild(menu);
    renderer.renderNow(true);
    assert.match(rendered(), /first-child/);
    assert.match(rendered(), /second-child/);
    assert.doesNotMatch(rendered(), /Private .* assignment/);
    assert.equal(renderer.getFocusedComponent(), editor);

    terminal.input('\x1b[B'); // Empty editor lets the inline menu select the second child.
    terminal.input('Parent draft');
    assert.equal(editor.getText(), 'Parent draft');
    terminal.input('\x18'); // Stop remains available while a parent draft exists.
    assert.equal(h.requests[0].options.signal.aborted, false);
    assert.equal(h.requests[1].options.signal.aborted, true);
    assert.equal(editor.getText(), 'Parent draft');
    assert.equal(renderer.getFocusedComponent(), editor);
    assert.equal(renderer.hasOverlay(), false);
    const stopped = (await h.call('subagents_wait', { ids: [ids[1]] })).structuredContent.agents[0];
    assert.equal(stopped.status, 'stopped');
    assert.equal(h.notifications.length, 1);

    terminal.columns = 48;
    terminal.rows = 18;
    terminal.resize();
    renderer.renderNow(true);
    assert.ok(rendered().split('\n').every((line) => visibleWidth(line) <= 48));
    assert.match(rendered(), /Parent draft/);
    assert.doesNotMatch(rendered(), /second-child/);
    terminal.input('\r');
    assert.deepEqual(submitted, ['Parent draft']);
    assert.equal(h.requests.length, 2); // Enter submits only to the parent, never to a child.
    h.requests[0].finish('first answer');
    await h.call('subagents_wait', { ids: [ids[0]] });
    renderer.renderNow(true);
    assert.equal(screen(menu), '');
    assert.match(rendered(), /Parent session remains running/);
    assert.doesNotMatch(rendered(), /first-child|second-child/);
    assert.equal(renderer.getFocusedComponent(), editor);
    assert.equal(h.notifications.length, 2);
    await h.events.get('session_tree')();
    assert.equal(h.inputListeners.size, 0);
  });
}

test('wait declares required unique IDs, bounded integer timeout and structured results', (t) => {
  const { parameters, outputSchema } = harness(t).tools.get('subagents_wait');
  assert.deepEqual(parameters.required, ['ids']);
  assert.equal(parameters.properties.ids.type, 'array');
  assert.equal(parameters.properties.ids.minItems, 1);
  assert.equal(parameters.properties.ids.uniqueItems, true);
  assert.equal(parameters.properties.ids.items.type, 'string');
  assert.equal(parameters.properties.ids.items.minLength, 1);
  assert.equal(parameters.properties.timeoutMs.type, 'integer');
  assert.equal(parameters.properties.timeoutMs.minimum, 1);
  assert.equal(parameters.properties.timeoutMs.maximum, 2_147_483_647);
  assert.equal(outputSchema.properties.timedOut.type, 'boolean');
  assert.equal(outputSchema.properties.agents.type, 'array');
});

test('wait returns a single report without waiting for unrelated jobs or changing notifications', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch([{ prompt: 'selected' }, { prompt: 'unrelated' }]);
  await until(() => h.requests.length === 2);
  let resolved = false;
  const waiting = h.call('subagents_wait', { ids: [ids[0]] }).then((result) => { resolved = true; return result; });
  await setImmediate();
  assert.equal(resolved, false);
  assert.equal(h.requests.length, 2);
  h.requests[0].finish('selected findings');
  const output = await waiting;
  assert.deepEqual(output.details, output.structuredContent);
  assert.equal(output.structuredContent.timedOut, false);
  assert.equal(output.structuredContent.agents.length, 1);
  const [job] = output.structuredContent.agents;
  assert.equal(job.id, ids[0]);
  assert.equal(job.status, 'completed');
  assert.equal(job.notification, 'queued');
  assert.match(job.result, /selected findings/);
  assert.match(output.content[0].text, /selected findings/);
  assert.equal(h.requests[1].options.signal.aborted, false);
  assert.equal((await h.call('subagents_status', { id: ids[1] })).structuredContent.agents[0].status, 'running');
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].message.details.id, ids[0]);
  assert.deepEqual(h.notifications[0].options, { triggerTurn: true, deliverAs: 'steer' });
  assert.equal(h.requests.length, 2);
  h.requests[1].finish('unrelated findings');
  await until(() => h.notifications.length === 2);
});

test('wait waits for ALL selected jobs, preserves requested order, and can recover already finished reports', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch([{ prompt: 'first' }, { prompt: 'second' }]);
  await until(() => h.requests.length === 2);
  const requested = [ids[1], ids[0]];
  let resolved = false;
  const waiting = h.call('subagents_wait', { ids: requested }).then((result) => { resolved = true; return result; });
  h.requests[1].finish('second result');
  await until(() => h.notifications.length === 1);
  await setImmediate();
  assert.equal(resolved, false);
  h.requests[0].finish('first result');
  const { structuredContent } = await waiting;
  assert.equal(structuredContent.timedOut, false);
  assert.deepEqual(structuredContent.agents.map((job) => job.id), requested);
  assert.ok(structuredContent.agents.every((job) => job.status === 'completed' && job.notification === 'queued'));
  assert.match(structuredContent.agents[0].result, /second result/);
  assert.match(structuredContent.agents[1].result, /first result/);
  for (const timeoutMs of [undefined, 1, 2_147_483_647]) {
    assert.deepEqual((await h.call('subagents_wait', { ids: requested, timeoutMs })).structuredContent, structuredContent);
  }
  assert.equal(h.notifications.length, 2);
  assert.equal(h.requests.length, 2);
});

for (const stopReason of ['error', 'aborted']) {
  test(`wait treats provider ${stopReason} as finished and returns the failure report`, async (t) => {
    const h = harness(t);
    const { details: { ids } } = await h.launch([{ prompt: 'will fail' }]);
    await until(() => h.requests.length === 1);
    const waiting = h.call('subagents_wait', { ids });
    h.requests[0].finish('partial findings', stopReason, { errorMessage: 'provider unavailable' });
    const { structuredContent: result } = await waiting;
    assert.equal(result.timedOut, false);
    assert.equal(result.agents[0].status, 'failed');
    assert.match(result.agents[0].result, /provider unavailable/);
    assert.match(result.agents[0].result, /partial findings/);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.requests.length, 1);
  });
}

test('wait timeout returns completed and running snapshots without stopping children', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch([{ prompt: 'quick' }, { prompt: 'slow' }]);
  await until(() => h.requests.length === 2);
  h.requests[0].finish('quick result');
  await h.call('subagents_wait', { ids: [ids[0]] });
  const { structuredContent: result } = await h.call('subagents_wait', { ids, timeoutMs: 1 });
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.agents.map((job) => job.id), ids);
  assert.deepEqual(result.agents.map((job) => job.status), ['completed', 'running']);
  assert.match(result.agents[0].result, /quick result/);
  assert.equal(result.agents[1].result, null);
  assert.equal(h.requests[1].options.signal.aborted, false);
  h.requests[1].finish('slow result');
  const completed = await h.call('subagents_wait', { ids });
  assert.equal(completed.structuredContent.timedOut, false);
  assert.match(completed.structuredContent.agents[1].result, /slow result/);
  assert.equal(h.notifications.length, 2);
  assert.equal(h.requests.length, 2);
});

test('aborting one wait rejects promptly without stopping jobs or another wait', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch([{ prompt: 'keep working' }]);
  await until(() => h.requests.length === 1);
  await assert.rejects(h.call('subagents_wait', { ids }, AbortSignal.abort()), /abort/i);
  const controller = new AbortController();
  const reason = new Error('cancel only this wait');
  const waiting = h.call('subagents_wait', { ids, timeoutMs: 2_147_483_647 }, controller.signal);
  const rejected = assert.rejects(waiting, (error) => error === reason);
  const otherWait = h.call('subagents_wait', { ids });
  controller.abort(reason);
  await rejected;
  assert.equal(h.requests[0].options.signal.aborted, false);
  assert.equal(h.notifications.length, 0);
  h.requests[0].finish('survived wait cancellation');
  const result = await otherWait;
  assert.equal(result.structuredContent.timedOut, false);
  assert.match(result.structuredContent.agents[0].result, /survived wait cancellation/);
  assert.equal(h.notifications.length, 1);
});

test('wait rejects empty, duplicate, inexact, unknown and malformed IDs and invalid timeouts', async (t) => {
  const h = harness(t);
  const { details: { ids: [id] } } = await h.launch([{ prompt: 'valid retained job' }]);
  await until(() => h.requests.length === 1);
  await assert.rejects(h.call('subagents_wait', { ids: [] }), /At least one/);
  await assert.rejects(h.call('subagents_wait', { ids: [id, id] }), /unique/);
  for (const badId of ['', ' ', 'unknown', id.slice(0, 8), ` ${id}`, `${id} `, null, 123]) {
    await assert.rejects(h.call('subagents_wait', { ids: [id, badId] }), /Unknown or no longer retained/);
  }
  for (const params of [{}, { ids: null }, { ids: id }, { ids: 12 }]) {
    await assert.rejects(h.call('subagents_wait', params));
  }
  for (const timeoutMs of [0, -1, 1.5, 2_147_483_648, NaN, Infinity, '1', null, true]) {
    await assert.rejects(h.call('subagents_wait', { ids: [id], timeoutMs }), /integer between 1 and 2147483647/);
  }
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.signal.aborted, false);
  assert.equal(h.notifications.length, 0);
  await h.events.get('session_tree')();
  await assert.rejects(h.call('subagents_wait', { ids: [id] }), /Unknown or no longer retained/);
});

for (const event of ['session_shutdown', 'session_start', 'session_tree']) {
  test(`${event} cancels pending waits before an uncooperative child tool settles`, async (t) => {
    const h = harness(t);
    let release;
    let childSignal;
    const gate = new Promise((resolve) => { release = resolve; });
    useChildTools(h, {
      slow_read: async (_id, _args, signal) => {
        childSignal = signal;
        await gate;
        return { content: [{ type: 'text', text: 'released' }], details: {} };
      },
    });
    const { details: { ids } } = await h.launch([{ prompt: 'blocked child tool' }]);
    await until(() => h.requests.length === 1);
    h.requests[0].finish('', 'toolUse', {
      content: [{ type: 'toolCall', id: 'blocked', name: 'slow_read', arguments: { path: 'slow.ts' } }],
    });
    await until(() => childSignal);
    let rejected = false;
    const waiting = assert.rejects(h.call('subagents_wait', { ids }), /session changed or shut down/)
      .then(() => { rejected = true; });
    let cleaned = false;
    const cleanup = h.events.get(event)().then(() => { cleaned = true; });
    try {
      await until(() => rejected);
      assert.equal(cleaned, false);
      assert.equal(childSignal.aborted, true);
      assert.equal(h.notifications.length, 0);
    } finally {
      release();
      await cleanup;
      await waiting;
    }
    assert.equal(h.notifications.length, 0);
    assert.deepEqual((await h.call('subagents_status', {})).structuredContent.agents, []);
  });
}

test('an in-flight wait retains selected jobs even after finished-history pruning', async (t) => {
  const h = harness(t);
  const { details: { ids } } = await h.launch(Array.from({ length: 23 }, (_, i) => ({ prompt: `job ${i}` })));
  await until(() => h.requests.length === ids.length);
  let resolved = false;
  const waiting = h.call('subagents_wait', { ids }).then((result) => { resolved = true; return result; });
  for (let i = 0; i < 22; i++) {
    h.requests[i].finish(`result ${i}`);
    await until(() => h.notifications.length === i + 1);
  }
  await setImmediate();
  assert.equal(resolved, false);
  const retained = (await h.call('subagents_status', {})).structuredContent.agents;
  assert.equal(retained.length, 21); // Latest 20 finished plus the last running job.
  assert.ok(!retained.some((job) => job.id === ids[0]));
  await assert.rejects(h.call('subagents_wait', { ids: [ids[0]] }), /Unknown or no longer retained/);
  h.requests[22].finish('result 22');
  const { structuredContent: result } = await waiting;
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.agents.map((job) => job.id), ids);
  result.agents.forEach((job, i) => {
    assert.equal(job.status, 'completed');
    assert.ok(job.result.endsWith(`result ${i}`));
  });
  assert.equal(h.notifications.length, 23);
  assert.equal(h.requests.length, 23);
});

test('wait remains pending through report artifact preparation and returns the final file', async (t) => {
  const h = harness(t);
  const originalWrite = fsPromises.writeFile;
  let release;
  let blocked = false;
  let path;
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.writeFile = async (...args) => {
    path = args[0];
    blocked = true;
    await gate;
    return originalWrite(...args);
  };
  syncBuiltinESMExports();
  try {
    const { details: { ids } } = await h.launch([{ prompt: 'large report' }]);
    await until(() => h.requests.length === 1);
    let resolved = false;
    const waiting = h.call('subagents_wait', { ids }).then((result) => { resolved = true; return result; });
    const answer = 'large report content\n'.repeat(3000);
    h.requests[0].finish(answer);
    await until(() => blocked);
    await setImmediate();
    assert.equal(resolved, false);
    assert.equal(h.notifications.length, 0);
    const { structuredContent: pending } = await h.call('subagents_wait', { ids, timeoutMs: 1 });
    assert.equal(pending.timedOut, true); // Terminal status alone is not settlement.
    assert.equal(pending.agents[0].status, 'completed');
    assert.equal(pending.agents[0].notification, 'pending');
    assert.match(pending.agents[0].result, /preparing full response file/);
    await assert.rejects(h.call('subagents_discard', { ids }), /has not finished execution and report preparation/);
    release();
    const { structuredContent: result } = await waiting;
    assert.equal(result.timedOut, false);
    assert.equal(result.agents[0].fullOutputPath, path);
    assert.equal(result.agents[0].notification, 'queued');
    assert.ok(result.agents[0].result.includes(path));
    assert.doesNotMatch(result.agents[0].result, /preparing full response file/);
    await h.call('subagents_discard', { ids });
    assert.ok((await readFile(path, 'utf8')).endsWith(answer)); // Discard never breaks delivered artifact links.
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].message.details.fullOutputPath, path);
  } finally {
    release();
    fsPromises.writeFile = originalWrite;
    syncBuiltinESMExports();
    await h.events.get('session_shutdown')();
    if (path) await rm(dirname(path), { recursive: true, force: true });
  }
});
