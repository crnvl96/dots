// Branch-local selection tests: actual registry/adapters, no paid network.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { config } from '../config.ts';
import { WebToolsError } from '../contracts.ts';
import { createProviders } from '../providers/index.ts';
import { SELECTION_ENTRY, registerSelection } from '../selection.ts';
import { registerTools } from '../tools.ts';

beforeEach(t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Unexpected HTTP: selection is local-only'));
  for (const [name, value] of [['WEB_SELECTION_TEST_PERPLEXITY_KEY', 'offline-key'], ['WEB_SELECTION_TEST_OPENROUTER_KEY', undefined], ['WEB_SELECTION_TEST_BASE_URL', undefined]]) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
});
function saved(provider) { return { type: 'custom', customType: SELECTION_ENTRY, data: { provider } }; }
function harness({ defaultProvider = 'openrouter', flag, mode = 'tui', hasUI = true, branch = [] } = {}) {
  const settings = structuredClone(config);
  settings.defaultProvider = defaultProvider;
  settings.openrouter.apiKeyEnv = 'WEB_SELECTION_TEST_OPENROUTER_KEY';
  settings.perplexity.apiKeyEnv = 'WEB_SELECTION_TEST_PERPLEXITY_KEY';
  settings.perplexity.baseUrlEnv = 'WEB_SELECTION_TEST_BASE_URL';
  const providers = createProviders(settings);
  const flags = new Map();
  const events = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const notifications = [];
  const statuses = [];
  const messages = [];
  const selects = [];
  const state = { branch, flag, key: 'offline-registry-key', choice: undefined, idle: async () => {}, idleCalls: 0 };
  const pi = {
    registerFlag: (name, definition) => flags.set(name, definition),
    getFlag: name => { assert.equal(name, 'web-provider'); return state.flag; },
    on: (name, handler) => events.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (customType, data) => {
      entries.push({ customType, data });
      state.branch = [...state.branch, { type: 'custom', customType, data }];
    },
    sendMessage: message => messages.push(message),
  };
  const ctx = {
    mode, hasUI,
    sessionManager: { getBranch: () => state.branch },
    modelRegistry: { getApiKeyForProvider: async provider => { assert.equal(provider, 'openrouter'); return state.key; } },
    waitForIdle: async () => { state.idleCalls++; await state.idle(); },
    ui: {
      notify: (message, level) => { assert.ok(hasUI, 'headless mode must not notify UI'); notifications.push({ message, level }); },
      setStatus: (key, value) => { assert.equal(mode, 'tui', 'only TUI may set status'); statuses.push({ key, value }); },
      select: async (title, choices) => { assert.ok(hasUI, 'headless mode must not open selector'); selects.push({ title, choices }); return state.choice; },
    },
  };
  const getProvider = registerSelection(pi, settings, providers);
  registerTools(pi, settings, getProvider);
  return { settings, providers, flags, events, commands, tools, entries, notifications, statuses, messages, selects, state, ctx, getProvider,
    emit: name => events.get(name)({}, ctx),
    command: args => commands.get('web').handler(args, ctx),
    run: (name, args) => tools.get(name).execute('selection-test', args, undefined, undefined, ctx),
  };
}

test('registers one command/flag and restores default, CLI, then latest saved branch selection', () => {
  const h = harness({ defaultProvider: 'perplexity' });
  assert.deepEqual([...h.flags.keys()], ['web-provider']);
  assert.equal(h.flags.get('web-provider').type, 'string');
  assert.deepEqual([...h.commands.keys()], ['web']);
  assert.deepEqual([...h.events.keys()], ['session_start', 'session_tree']);
  h.emit('session_start');
  assert.equal(h.getProvider(), h.providers.perplexity);
  h.state.flag = 'openrouter';
  h.emit('session_start');
  assert.equal(h.getProvider(), h.providers.openrouter);
  h.state.branch = [saved('openrouter'), { type: 'custom', customType: 'unrelated', data: { provider: 'invalid' } }, saved('perplexity')];
  h.emit('session_start');
  assert.equal(h.getProvider(), h.providers.perplexity);
  // A bogus CLI value is irrelevant when a branch has a valid saved override.
  h.state.flag = 'invalid';
  h.emit('session_tree');
  assert.equal(h.getProvider(), h.providers.perplexity);
  assert.equal(h.statuses.at(-1).value, 'web: perplexity');
  assert.equal(h.entries.length, 0, 'restoration must not append selection history');
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('session_tree restores the active branch, not the latest global selection', async () => {
  const h = harness();
  h.emit('session_start');
  await h.command('provider perplexity');
  const perplexityBranch = [...h.state.branch];
  await h.command('provider openrouter');
  const openrouterBranch = [...h.state.branch];
  h.state.branch = perplexityBranch;
  h.emit('session_tree');
  assert.equal(h.getProvider().id, 'perplexity');
  h.state.branch = openrouterBranch;
  h.emit('session_tree');
  assert.equal(h.getProvider().id, 'openrouter');
  h.state.branch = [];
  h.emit('session_tree');
  assert.equal(h.getProvider().id, 'openrouter');
  assert.deepEqual(h.entries, [
    { customType: SELECTION_ENTRY, data: { provider: 'perplexity' } },
    { customType: SELECTION_ENTRY, data: { provider: 'openrouter' } },
  ]);
});

test('reset persists a null override and re-evaluates CLI/default on future restoration', async () => {
  const h = harness({ defaultProvider: 'perplexity', flag: 'openrouter', branch: [saved('perplexity')] });
  h.emit('session_start');
  await h.command('provider reset');
  assert.equal(h.getProvider().id, 'openrouter');
  assert.deepEqual(h.entries, [{ customType: SELECTION_ENTRY, data: { provider: null } }]);
  h.state.flag = undefined;
  h.emit('session_tree');
  assert.equal(h.getProvider().id, 'perplexity');
  assert.equal(h.entries.length, 1);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('invalid commands, credentials, provider configuration, and failed reset leave selection/history unchanged', async () => {
  const h = harness();
  h.emit('session_start');
  for (const command of ['provider unknown', 'provider toString', 'provider __proto__', 'provider perplexity extra', 'nonsense']) {
    await h.command(command);
    assert.equal(h.getProvider().id, 'openrouter');
    assert.equal(h.entries.length, 0);
    assert.equal(h.notifications.at(-1).level, 'error');
  }
  delete process.env.WEB_SELECTION_TEST_PERPLEXITY_KEY;
  await h.command('provider perplexity');
  assert.equal(h.getProvider().id, 'openrouter');
  assert.match(h.notifications.at(-1).message, /WEB_SELECTION_TEST_PERPLEXITY_KEY/);
  assert.equal(h.entries.length, 0);
  process.env.WEB_SELECTION_TEST_PERPLEXITY_KEY = 'offline-key';
  h.settings.perplexity.fetch.maxSteps = 0;
  await h.command('provider perplexity');
  assert.equal(h.getProvider().id, 'openrouter');
  assert.equal(h.entries.length, 0);
  h.settings.perplexity.fetch.maxSteps = 2;
  await h.command('provider perplexity');
  assert.equal(h.getProvider().id, 'perplexity');
  h.state.key = undefined;
  await h.command('provider openrouter');
  await h.command('provider reset');
  assert.equal(h.getProvider().id, 'perplexity');
  assert.equal(h.entries.length, 1);
  assert.equal(h.notifications.at(-1).level, 'error');
  h.state.flag = 'bad-default';
  await h.command('provider reset');
  assert.equal(h.getProvider().id, 'perplexity');
  assert.equal(h.entries.length, 1);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('invalid restored selections fail closed until explicit correction or a valid branch restoration', async () => {
  const h = harness({ flag: 'unknown' });
  h.emit('session_start');
  assert.throws(h.getProvider, error => error instanceof WebToolsError && error.code === 'configuration');
  assert.equal(h.statuses.at(-1).value, 'web: configuration error');
  for (const [name, args] of [['web_search', { query: 'no dispatch' }], ['web_fetch', { url: 'https://example.com/' }]]) {
    const output = await h.run(name, args);
    assert.equal(output.isError, true);
    assert.equal(output.structuredContent.provider, null);
    assert.equal(output.structuredContent.error.code, 'configuration');
    assert.equal(output.structuredContent.metadata.retrieval_evidence, 'none');
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  await h.command('status');
  assert.equal(h.notifications.at(-1).level, 'error');
  await h.command('provider perplexity');
  assert.equal(h.getProvider().id, 'perplexity');
  h.state.branch = [saved('missing-provider')];
  h.emit('session_tree');
  assert.throws(h.getProvider, /Unknown web provider/);
  for (const data of [undefined, null, {}, [], { provider: undefined }]) {
    h.state.branch = [{ type: 'custom', customType: SELECTION_ENTRY, data }];
    h.emit('session_tree');
    assert.throws(h.getProvider, error => error.code === 'configuration');
  }
  h.state.branch = [saved('openrouter')];
  h.emit('session_tree');
  assert.equal(h.getProvider().id, 'openrouter');
  assert.equal(h.statuses.at(-1).value, 'web: openrouter');
  assert.equal(h.entries.length, 1);
});

test('noninteractive commands never use UI; status and errors use extension messages', async () => {
  const h = harness({ mode: 'json', hasUI: false });
  h.emit('session_start');
  await h.command('');
  assert.match(h.messages.at(-1).content, /Web provider: openrouter/);
  assert.match(h.messages.at(-1).content, /Recency filter: unsupported/);
  assert.match(h.messages.at(-1).content, /Both web_search and web_fetch/);
  await h.command('provider');
  assert.match(h.messages.at(-1).content, /Specify a provider in noninteractive mode/);
  assert.equal(h.getProvider().id, 'openrouter');
  await h.command('provider perplexity');
  await h.command('status');
  assert.match(h.messages.at(-1).content, /Recency filter: supported/);
  assert.equal(h.getProvider().id, 'perplexity');
  h.state.branch = [saved('invalid')];
  h.emit('session_tree');
  await h.command('status');
  assert.match(h.messages.at(-1).content, /Unknown web provider/);
  assert.ok(h.messages.every(message => message.customType === 'web-tools-status' && message.display === true));
  assert.equal(h.statuses.length, 0);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.selects.length, 0);
});

test('interactive selector cancellation is a no-op, completions work, and non-TUI UI gets no status', async () => {
  const h = harness({ mode: 'rpc', hasUI: true });
  h.emit('session_start');
  await h.command('provider');
  assert.deepEqual(h.selects[0].choices, ['openrouter', 'perplexity', 'reset']);
  assert.equal(h.getProvider().id, 'openrouter');
  assert.equal(h.entries.length, 0);
  assert.equal(h.state.idleCalls, 0);
  h.state.choice = 'perplexity';
  await h.command('provider');
  assert.equal(h.getProvider().id, 'perplexity');
  assert.equal(h.statuses.length, 0);
  assert.equal(h.notifications.at(-1).level, 'info');
  assert.deepEqual(h.commands.get('web').getArgumentCompletions('provider p'), [{ value: 'provider perplexity', label: 'provider perplexity' }]);
  assert.deepEqual(h.commands.get('web').getArgumentCompletions('nonsense'), []);
});

test('provider change waits for idle and validates before appending or switching', async t => {
  const h = harness();
  h.emit('session_start');
  let releaseIdle;
  let releaseValidation;
  let validating;
  const validationStarted = new Promise(resolve => { validating = resolve; });
  h.state.idle = () => new Promise(resolve => { releaseIdle = resolve; });
  const originalValidate = h.providers.perplexity.validate;
  t.mock.method(h.providers.perplexity, 'validate', async context => {
    validating();
    await new Promise(resolve => { releaseValidation = resolve; });
    await originalValidate(context);
  });
  const pending = h.command('provider perplexity');
  assert.equal(h.state.idleCalls, 1);
  assert.equal(h.providers.perplexity.validate.mock.callCount(), 0);
  assert.equal(h.getProvider().id, 'openrouter');
  assert.equal(h.entries.length, 0);
  releaseIdle();
  await validationStarted;
  assert.equal(h.getProvider().id, 'openrouter');
  assert.equal(h.entries.length, 0);
  releaseValidation();
  await pending;
  assert.equal(h.getProvider().id, 'perplexity');
  assert.equal(h.entries.length, 1);
});

test('one command switches BOTH public tools using real adapters without re-registration', async t => {
  const h = harness();
  h.emit('session_start');
  const originalTools = [...h.tools.values()];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
    const body = JSON.parse(init.body);
    const provider = String(endpoint).includes('openrouter') ? 'openrouter' : 'perplexity';
    const operation = provider === 'openrouter' ? (body.tools[0].type.endsWith('web_search') ? 'search' : 'fetch')
      : String(endpoint).endsWith('/search') ? 'search' : 'fetch';
    requests.push({ provider, operation });
    const source = { url: 'https://example.com/', title: 'Page', snippet: 'Provider excerpt' };
    const payload = provider === 'openrouter' ? {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ status: 'ok', report: 'Model report' }),
        annotations: [{ type: 'url_citation', url_citation: { ...source, content: source.snippet } }] } }],
      usage: { server_tool_use_details: { tool_calls_executed: 1 } },
    } : operation === 'search' ? { results: [source] }
      : { status: 'completed', output: [{ type: 'fetch_url_results', contents: [source] }] };
    return new Response(JSON.stringify(payload));
  });
  for (const command of [null, 'provider perplexity', 'provider reset']) {
    if (command) await h.command(command);
    const provider = command === 'provider perplexity' ? 'perplexity' : 'openrouter';
    const search = await h.run('web_search', { query: 'offline query' });
    const fetch = await h.run('web_fetch', { url: 'https://example.com/' });
    for (const output of [search, fetch]) {
      assert.equal(output.isError, false);
      assert.equal(output.details.provider, provider);
      assert.equal(output.structuredContent.provider, provider);
    }
    assert.equal(fetch.structuredContent.content, 'Provider excerpt');
  }
  assert.deepEqual(requests, ['openrouter', 'perplexity', 'openrouter'].flatMap(provider => [
    { provider, operation: 'search' }, { provider, operation: 'fetch' },
  ]));
  assert.deepEqual([...h.tools.values()], originalTools);
  assert.equal(h.entries.length, 2);
});
