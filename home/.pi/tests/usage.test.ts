import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import usage, {
  abortable, codexAccountId, createUsageLoader, getJson, money, parseCodex, parseOpenRouter, parseRadius, radiusOrigin,
  renderCards, resetLabel, UsageDashboard, type UsageCard,
} from '../agent/extensions/usage.ts';

const theme = {
  fg: (_color: string, value: string) => `\x1b[36m${value}\x1b[39m`,
  bold: (value: string) => `\x1b[1m${value}\x1b[22m`,
} as Theme;
const codex = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_at: 2000000000 },
    secondary_window: { used_percent: 80, limit_window_seconds: 604800, reset_after_seconds: 100 },
  },
};
const radius = { currency: 'USD', balance: { credit_balance: 12, reserved: 2, available: 10 } };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Codex reports plan windows, duration labels, and absolute/relative reset times', () => {
  const card = parseCodex(codex, 1000);
  assert.equal(card.headline, 'plus');
  assert.deepEqual(card.windows, [
    { label: '5h', usedPercent: 35, resetAt: 2000000000000 },
    { label: '7d', usedPercent: 80, resetAt: 101000 },
  ]);
  assert.equal(parseCodex({ rate_limit: { primary_window: { used_percent: 0 } } }).windows?.[0].usedPercent, 0);
  assert.equal(parseCodex({ rate_limit: { primary_window: { used_percent: 100 } } }).windows?.[0].usedPercent, 100);
});

test('missing, malformed, or out-of-range Codex usage is never fabricated as zero', () => {
  for (const value of [undefined, null, {}, { rate_limit: {} }, { rate_limit: { primary_window: { used_percent: '0' } } }, { rate_limit: { primary_window: { used_percent: 101 } } }]) {
    assert.throws(() => parseCodex(value));
  }
  const card = parseCodex({ ...codex, plan_type: 'plus\x1b\n\x07' });
  assert.equal(card.headline, 'plus');
});

test('OpenRouter is account credits minus usage, including zero/negative balances', () => {
  assert.equal(parseOpenRouter({ data: { total_credits: 100, total_usage: 35.25 } }).headline, '$64.75 remaining');
  assert.equal(parseOpenRouter({ data: { total_credits: 0, total_usage: 0 } }).headline, '$0.00 remaining');
  assert.equal(parseOpenRouter({ data: { total_credits: 0, total_usage: 1 } }).headline, '-$1.00 remaining');
  for (const data of [{}, { total_credits: null, total_usage: 0 }, { total_credits: '100', total_usage: 1 }, { total_credits: Infinity, total_usage: 1 }]) {
    assert.throws(() => parseOpenRouter({ data }));
  }
});

test('Radius separates spendable funds from credit balance and reservations', () => {
  const card = parseRadius(radius);
  assert.equal(card.headline, '$10.00 available');
  assert.match(card.details[0], /\$12.00 balance · \$2.00 reserved/);
  assert.equal(parseRadius({ ...radius, balance: { ...radius.balance, available: -1 } }).headline, '-$1.00 available');
  assert.throws(() => parseRadius({ balance: radius.balance }));
  assert.throws(() => parseRadius({ ...radius, balance: {} }));
  assert.equal(money(12.345), '$12.35');
});

test('reset formatting handles elapsed and absent windows', () => {
  assert.equal(resetLabel(undefined, 0), 'reset unknown');
  assert.equal(resetLabel(0, 1), 'reset due');
  assert.equal(resetLabel(1000, 0), 'resets in 1m');
  assert.equal(resetLabel(65 * 60000, 0), 'resets in 1h 5m');
  assert.equal(resetLabel(25 * 3600000, 0), 'resets in 1d 1h');
});

test('transport is read-only, forbids redirects, and passes cancellation', async () => {
  const controller = new AbortController();
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://example.test/balance');
    assert.equal(init?.method, undefined); // fetch default: GET
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, controller.signal);
    assert.deepEqual(init?.headers, { Accept: 'application/json', Authorization: 'Bearer test' });
    return Response.json({ balance: 1 });
  };
  assert.deepEqual(await getJson('https://example.test/balance', { Authorization: 'Bearer test' }, controller.signal, transport), { balance: 1 });
  controller.abort();
  await assert.rejects(getJson('https://example.test/balance', {}, controller.signal, async () => { throw Error('must not fetch'); }), { name: 'AbortError' });
});

test('HTTP failures never expose response body or status text', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(getJson('https://example.test', {}, new AbortController().signal,
      async () => new Response('SECRET body', { status, statusText: 'SECRET status' })), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
  }
  await assert.rejects(getJson('https://example.test', {}, new AbortController().signal,
    async () => new Response('not json')), /Unexpected response format/);
});

test('credential wait is cancellable, including already-aborted signals and late rejection', async () => {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  const promise = abortable(new Promise<void>((_resolve, no) => { reject = no; }), controller.signal);
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  reject(Error('late failure'));
  await tick(); // no unhandled rejection
  await assert.rejects(abortable(Promise.resolve(1), controller.signal), { name: 'AbortError' });
});

test('styled cards and frames always fit narrow/wide terminal widths', async () => {
  const cards = [parseCodex(codex), parseOpenRouter({ data: { total_credits: 10, total_usage: 1 } }), parseRadius(radius),
    { id: 'perplexity', status: 'unavailable', headline: 'Not exposed', details: ['Check the API billing dashboard.'] } as UsageCard];
  const dashboard = new UsageDashboard(theme, async id => cards.find(c => c.id === id)!, () => {}, () => 24, () => {});
  await tick();
  for (const width of [0, 1, 3, 10, 24, 40, 72, 120]) {
    for (const line of renderCards(cards, width, theme)) assert.ok(visibleWidth(line) <= width, `card width ${width}: ${line}`);
    for (const line of dashboard.render(width)) assert.ok(visibleWidth(line) <= width, `frame width ${width}: ${line}`);
  }
  assert.ok(dashboard.render(72).length <= 24);
  dashboard.dispose();
});

test('dashboard loads independently, isolates failure, refreshes once, and aborts on close', async () => {
  let calls = 0;
  let resolve!: (card: UsageCard) => void;
  let signal!: AbortSignal;
  let closed = false;
  const dashboard = new UsageDashboard(theme, async (id, currentSignal) => {
    calls++; signal = currentSignal;
    if (id === 'codex') return new Promise<UsageCard>(yes => { resolve = yes; });
    if (id === 'radius') throw Error('SECRET');
    return { id, status: 'unavailable', headline: 'No key', details: [] };
  }, () => {}, () => 12, () => { closed = true; });
  dashboard.refresh();
  await tick();
  assert.equal(calls, 4);
  assert.equal(dashboard.cards[0].status, 'loading');
  assert.equal(dashboard.cards[2].status, 'error');
  assert.doesNotMatch(JSON.stringify(dashboard.cards), /SECRET/);
  resolve(parseCodex(codex));
  await tick();
  assert.equal(dashboard.cards[0].status, 'ok');
  const top = dashboard.render(50).join('\n');
  dashboard.handleInput('\x1b[B');
  assert.notEqual(dashboard.render(50).join('\n'), top);
  dashboard.handleInput('r');
  assert.equal(calls, 8);
  dashboard.handleInput('\x1b');
  assert.equal(signal.aborted, true);
  assert.equal(closed, true);
  resolve(parseCodex(codex));
  await tick();
  dashboard.refresh();
  assert.equal(calls, 8);
});

const jwt = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' } })).toString('base64url')}.signature`;
const registry = (tokens: Record<string, string> = {}) => ({
  getAll: () => [],
  getProviderAuth: async (id: string) => tokens[id] ? { auth: { apiKey: tokens[id] } } : undefined,
});

test('JWT parsing never accepts an API key, bad claim, or header injection', () => {
  assert.equal(codexAccountId(jwt), 'account-123');
  for (const token of ['sk-not-a-jwt', 'a.b.c', `a.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'bad\r\nid' } })).toString('base64url')}.c`]) {
    assert.equal(codexAccountId(token), undefined);
  }
});

test('Radius origin selection requires HTTPS and rejects URL credentials/query/fragment', () => {
  assert.equal(radiusOrigin('radius.pi.dev/'), 'https://radius.pi.dev');
  assert.equal(radiusOrigin('https://custom.test/v1'), 'https://custom.test');
  for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret']) {
    assert.throws(() => radiusOrigin(url));
  }
});

test('missing credentials and unsupported Perplexity do not make requests', async () => {
  const loader = createUsageLoader(registry(), {}, async () => { throw Error('unexpected network'); });
  for (const id of ['codex', 'openrouter', 'radius', 'perplexity'] as const) {
    assert.equal((await loader(id, new AbortController().signal)).status, 'unavailable');
  }
});

test('Codex uses only its subscription credential and account header', async () => {
  let requests = 0;
  const loader = createUsageLoader(registry({ 'openai-codex': jwt, openai: 'sk-not-subscription' }), {}, async (url, init) => {
    requests++;
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.deepEqual(init?.headers, { Accept: 'application/json', Authorization: `Bearer ${jwt}`, 'ChatGPT-Account-Id': 'account-123' });
    return Response.json(codex);
  });
  assert.equal((await loader('codex', new AbortController().signal)).status, 'ok');
  assert.equal(requests, 1);
  const noCodex = createUsageLoader(registry({ openai: 'sk-only-openai' }), {}, async () => { throw Error('must not fetch'); });
  assert.equal((await noCodex('codex', new AbortController().signal)).status, 'unavailable');
});

test('OpenRouter management key is preferred, used only for credits, with actionable 403', async () => {
  const loader = createUsageLoader(registry({ openrouter: 'stored-inference' }), {
    OPENROUTER_MANAGEMENT_KEY: ' management ', OPENROUTER_API_KEY: 'inference',
  }, async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/credits');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer management');
    return Response.json({ data: { total_credits: 20, total_usage: 5 } });
  });
  assert.equal((await loader('openrouter', new AbortController().signal)).headline, '$15.00 remaining');
  const denied = createUsageLoader(registry({ openrouter: 'ordinary' }), {}, async () => new Response('SECRET', { status: 403 }));
  const card = await denied('openrouter', new AbortController().signal);
  assert.equal(card.status, 'unavailable');
  assert.match(card.details[0], /OPENROUTER_MANAGEMENT_KEY/);
  assert.doesNotMatch(JSON.stringify(card), /SECRET/);
});

test('custom OpenRouter/Codex credentials are never forwarded to official provider origins', async () => {
  for (const id of ['openrouter', 'codex'] as const) {
    let fetched = false;
    const loader = createUsageLoader({ getAll: () => [], getProviderAuth: async () => ({
      auth: { apiKey: jwt, baseUrl: 'https://private.test/v1' },
    }) }, {}, async () => { fetched = true; return Response.json({}); });
    assert.equal((await loader(id, new AbortController().signal)).headline, 'Custom endpoint');
    assert.equal(fetched, false);
  }
});

test('Radius resolves its organization at the configured gateway and reads USD billing', async () => {
  const paths: string[] = [];
  const loader = createUsageLoader(registry({ radius: 'radius-token' }), { PI_RADIUS_GATEWAY: 'https://custom.test' }, async (url, init) => {
    paths.push(String(url));
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer radius-token');
    return Response.json(paths.length === 1 ? { organization: { id: 'org/123' } } : radius);
  });
  assert.equal((await loader('radius', new AbortController().signal)).headline, '$10.00 available');
  assert.deepEqual(paths, ['https://custom.test/v1/context', 'https://custom.test/v1/organizations/org%2F123/billing']);
});

test('Radius honors resolved auth baseUrl rather than leaking a custom token to public Radius', async () => {
  const urls: string[] = [];
  const loader = createUsageLoader({
    getAll: () => [],
    getProviderAuth: async () => ({ auth: { apiKey: 'private', baseUrl: 'https://private.test/v1' } }),
  }, {}, async url => {
    urls.push(String(url));
    return Response.json({ organization: {} });
  });
  assert.equal((await loader('radius', new AbortController().signal)).status, 'error');
  assert.deepEqual(urls, ['https://private.test/v1/context']);
});

test('credential failures are redacted and slow resolution is bounded before fetch', async () => {
  const bad = createUsageLoader({ getAll: () => [], getProviderAuth: async () => { throw Error('SECRET'); } }, {});
  const card = await bad('radius', new AbortController().signal);
  assert.equal(card.status, 'error');
  assert.doesNotMatch(JSON.stringify(card), /SECRET/);
  const hung = createUsageLoader({ getAll: () => [], getProviderAuth: () => new Promise(() => {}) }, {}, async () => { throw Error('must not fetch'); }, 5);
  // AbortSignal.timeout is unref'd, so keep the test process alive until it fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await hung('codex', new AbortController().signal);
    assert.equal(result.status, 'error');
    assert.match(result.details[0], /Timed out/);
    const controller = new AbortController();
    const pending = hung('radius', controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { clearTimeout(keepAlive); }
});

test('dashboard fits very short terminals and safely recalculates layout on resize', async () => {
  let height = 24;
  const dashboard = new UsageDashboard(theme, async id => ({ id, status: 'unavailable', headline: 'Unavailable', details: ['Try again later.'] }), () => {}, () => height, () => {});
  await tick();
  for (height of [24, 10, 8, 5, 2, 1, 30]) {
    dashboard.handleInput('\x1b[B');
    dashboard.invalidate();
    assert.ok(dashboard.render(40).length <= height);
  }
  dashboard.dispose();
});

test('loads through Pi’s real extension loader', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-usage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager: SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [fileURLToPath(new URL('../agent/extensions/usage.ts', import.meta.url))],
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.ok(result.extensions[0].commands.has('usage'));
  assert.equal(result.extensions[0].tools.size, 0);
});

test('/usage registers without I/O and guards non-terminal modes', async () => {
  let command: any;
  let shutdown: any;
  usage({
    registerCommand: (name: string, config: unknown) => { assert.equal(name, 'usage'); command = config; },
    on: (name: string, fn: unknown) => { assert.equal(name, 'session_shutdown'); shutdown = fn; },
  } as any);
  const notices: string[] = [];
  await command.handler('', { mode: 'rpc', hasUI: true, ui: { notify: (message: string) => notices.push(message) } });
  assert.match(notices[0], /interactive/);
  await command.handler('', { mode: 'print', hasUI: false });
  shutdown();
});
