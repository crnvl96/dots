import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { config } from '../config.ts';
import { WebToolsError, type ProviderContext, type SearchInput } from '../contracts.ts';
import { createOpenRouterProvider } from '../providers/openrouter.ts';

const query: SearchInput = { query: '  focused query  ', max_results: 5, search_context_size: 'high' };
const context: ProviderContext = {
  async getApiKey() { return ' test-key '; },
  async classify(model, input, options) {
    assert.equal(options.apiKey, 'test-key');
    return { api: 'typesafe-system-one', provider: 'openrouter', model, timestamp: 0, stopReason: 'stop',
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, { type: 'score', score: 3, confidence: 1 }])),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
  },
};
function settings() {
  return { ...structuredClone(config.openrouter), apiKeyEnv: 'WEB_TOOLS_OPENROUTER_OFFLINE_TEST_KEY', usePiCredentials: true };
}
function citation(url: unknown, content?: unknown, title?: unknown) {
  return { type: 'url_citation', url_citation: { url, content, title } };
}
function payload() {
  return {
    id: 'req-123', model: 'returned/model',
    choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ status: 'ok', report: 'Model synthesis with https://invented.example/ only in report.' }),
      annotations: [citation('https://example.com', 'Provider excerpt', 'Page')],
    } }],
    usage: { server_tool_use_details: { tool_calls_executed: 1 }, prompt_tokens: 100, completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 4 }, total_tokens: 120, cost: 0.125 },
  };
}
function mockApi(t: TestContext, value: unknown = payload(), status = 200) {
  return t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(value), { status }));
}
function code(expected: string) {
  return (error: unknown) => error instanceof WebToolsError && error.code === expected;
}

test('search uses one bounded server tool, status-only output and Jev-selected annotations', async t => {
  const fetch = mockApi(t);
  const s = settings(); s.endpoint = 'https://trusted.example/chat'; s.model = 'custom/model'; s.maxOutputTokens = 1234;
  const signal = new AbortController().signal;
  const provider = createOpenRouterProvider(s);
  const response = await provider.search(query, { ...context, signal });
  assert.equal(provider.id, 'openrouter');
  assert.equal(provider.capabilities.recencyFilter, false);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, s.endpoint);
  assert.equal(init.redirect, 'error');
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(init.body as string);
  assert.equal(body.model, 'custom/model'); assert.equal(body.max_tokens, 1234);
  assert.equal(body.stream, false); assert.equal(body.max_tool_calls, 1);
  assert.deepEqual(body.tools, [{ type: 'openrouter:web_search', parameters: {
    engine: 'parallel', mode: 'advanced', max_results: 5, search_context_size: 'high', max_uses: 1,
  } }]);
  assert.equal(body.messages.length, 2);
  assert.deepEqual(JSON.parse(body.messages[1].content), { query: 'focused query' });
  assert.match(body.messages[0].content, /untrusted data/);
  assert.match(body.messages[0].content, /MUST invoke/);
  assert.equal(body.response_format.json_schema.strict, true);
  const { result, usage } = response;
  assert.equal(result.query, 'focused query'); assert.equal(result.operation, 'search');
  assert.equal(result.results, result.sources);
  assert.deepEqual(result.sources, [{ url: 'https://example.com/', title: 'Page', snippet: 'Provider excerpt', date: null, last_updated: null }]);
  assert.equal(result.report, null); assert.equal(result.error, null);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['status']);
  assert.match(body.messages[0].content, /Do not summarize, rank, filter, rewrite/);
  assert.doesNotMatch(JSON.stringify(response), /invented|test-key/);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.metadata, { ranking: { model: s.ranking.model, status: 'ranked', candidates: 1, selected: 1,
    scores: [{ url: 'https://example.com/', score: 3 }] }, result_order: 'ranked', retrieval_evidence: 'tool_execution',
    model: 'returned/model', request_id: 'req-123', tool_calls: 1, cost_usd: 0.125 });
  assert.deepEqual(usage, { input: 85, output: 20, cacheRead: 10, cacheWrite: 5, reasoning: 4, totalTokens: 120,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } });
});

test('search rejects invalid status responses even with usable provider annotations', async t => {
  for (const content of ['not JSON', 'null', '{}', '{"status":"other"}', '{"status":["ok"]}']) {
    await t.test(content, async t => {
      const data = payload(); data.choices[0].message.content = content;
      mockApi(t, data);
      await assert.rejects(createOpenRouterProvider(settings()).search(query, context), code('invalid_response'));
    });
  }
});

test('annotations are normalized, deduplicated in citation order, safe, and never derived from report', async t => {
  const data = payload();
  data.choices[0].message.annotations = [citation('https://EXAMPLE.com:443', null), citation('https://example.com/', 'duplicate'),
    citation('https://second.example/path', 42, 42), citation('javascript:alert(1)'), citation('https://user:secret@example.com'),
    citation('/relative'), citation(42), { type: 'other', url_citation: { url: 'https://ignored.example', content: null, title: null } }];
  mockApi(t, data);
  const { result } = await createOpenRouterProvider(settings()).search(query, context);
  assert.deepEqual(result.sources.map(s => [s.url, s.title, s.snippet]), [
    ['https://example.com/', 'https://example.com/', null], ['https://second.example/path', 'https://second.example/path', null],
  ]);
  assert.ok(result.warnings.some(w => /No provider source excerpts/.test(w)));
});

test('fetch matches only exact normalized source URL and keeps report separate', async t => {
  const fetch = mockApi(t);
  const s = settings(); s.fetch = { engine: 'exa', maxContentTokens: 2345 };
  const { result } = await createOpenRouterProvider(s).fetch({ url: 'https://EXAMPLE.com:443', objective: '  extract main text  ' }, context);
  assert.equal(result.url, 'https://example.com/'); assert.equal(result.source_url, result.url);
  assert.equal(result.title, 'Page'); assert.equal(result.content, 'Provider excerpt'); assert.notEqual(result.content, result.report);
  const body = JSON.parse((fetch.mock.calls[0].arguments as unknown as [string, RequestInit])[1].body as string);
  assert.deepEqual(body.tools, [{ type: 'openrouter:web_fetch', parameters: { engine: 'exa', max_uses: 1, max_content_tokens: 2345 } }]);
  assert.equal(body.max_tool_calls, 1);
  assert.deepEqual(JSON.parse(body.messages[1].content), { url: result.url, objective: 'extract main text' });
});

test('fetch does not assume redirects, strip fragments, or substitute unrelated citations', async t => {
  mockApi(t);
  const provider = createOpenRouterProvider(settings());
  for (const url of ['https://elsewhere.example/', 'http://example.com/', 'https://example.com/#fragment', 'https://example.com/?q=1']) {
    const { result } = await provider.fetch({ url, objective: 'content' }, context);
    assert.equal(result.source_url, null); assert.equal(result.title, null); assert.equal(result.content, null);
    assert.equal(result.sources.length, 1); assert.ok(result.warnings.some(w => /requested URL/.test(w)));
  }
});

test('fetch report status is authoritative; errors are structured and missing annotations warn', async t => {
  for (const status of ['ok', 'not_found', 'error']) {
    await t.test(status, async t => {
      const data = payload(); data.choices[0].message.content = JSON.stringify({ status, report: 'Retrieval notes' });
      data.choices[0].message.annotations = [];
      mockApi(t, data);
      const { result } = await createOpenRouterProvider(settings()).fetch({ url: 'https://example.com', objective: 'text' }, context);
      assert.equal(result.status, status); assert.deepEqual(result.sources, []);
      assert.equal(result.error?.code ?? null, status === 'error' ? 'retrieval_failed' : null);
      assert.ok(result.warnings.length); assert.equal(result.report, 'Retrieval notes');
    });
  }
});

test('requires execution counters, supports documented aliases and operation-specific fallback', async t => {
  const cases: [unknown, boolean][] = [
    [{ tool_calls_executed: 1 }, true], [{ web_search_requests: 1 }, true],
    [{ tool_calls_executed: 0, web_search_requests: 1 }, true], [{ web_fetch_requests: 1 }, false],
    [{}, false], [{ tool_calls_executed: 0 }, false], [{ tool_calls_executed: -1 }, false],
    [{ tool_calls_executed: '1' }, false], [{ tool_calls_executed: 0.5 }, false], [{ tool_calls_executed: 2 }, false],
  ];
  for (const alias of ['server_tool_use_details', 'server_tool_use']) {
    for (const [counts, valid] of cases) await t.test(`${alias} ${JSON.stringify(counts)}`, async t => {
      const data = { ...payload(), usage: { [alias]: counts } }; mockApi(t, data);
      const call = createOpenRouterProvider(settings()).search(query, context);
      if (valid) assert.equal((await call).result.metadata.tool_calls, 1);
      else await assert.rejects(call, code('invalid_response'));
    });
  }
  await t.test('fetch operation counter', async t => {
    mockApi(t, { ...payload(), usage: { server_tool_use: { web_fetch_requests: 1 } } });
    assert.equal((await createOpenRouterProvider(settings()).fetch({ url: 'https://example.com', objective: 'text' }, context)).result.status, 'ok');
  });
  await t.test('live details take precedence over legacy counters', async t => {
    mockApi(t, { ...payload(), usage: { server_tool_use_details: {}, server_tool_use: { tool_calls_executed: 1 } } });
    await assert.rejects(createOpenRouterProvider(settings()).search(query, context), code('invalid_response'));
  });
});

test('malformed reports, refusal, incomplete completion and missing messages fail closed', async t => {
  const messages = ['not JSON', 'null', '[]', '{}', '{"status":"ok","report":" "}',
    '{"status":["ok"],"report":"text"}', '{"status":"other","report":"text"}', '{"status":"ok","report":42}'];
  const cases: unknown[] = [ {}, { choices: [] }, { choices: [{ message: {} }] },
    ...messages.map(content => ({ ...payload(), choices: [{ finish_reason: 'stop', message: { content } }] })),
    ...['length', 'tool_calls', 'content_filter', null].map(finish_reason => ({ ...payload(), choices: [{ ...payload().choices[0], finish_reason }] })),
    { ...payload(), choices: [{ finish_reason: 'stop', message: { content: [], refusal: null } }] },
    { ...payload(), choices: [{ finish_reason: 'stop', message: { ...payload().choices[0].message, refusal: 'No' } }] },
  ];
  for (const [index, data] of cases.entries()) await t.test(String(index), async t => {
    const fetch = mockApi(t, data);
    await assert.rejects(createOpenRouterProvider(settings()).fetch({ url: 'https://example.com', objective: 'text' }, context), code('invalid_response'));
    assert.equal(fetch.mock.callCount(), 1);
  });
});

test('nullable metadata does not invent model/id/cost; token aliases and invalid usage remain safe', async t => {
  const data = { ...payload(), id: null, model: 42, usage: { server_tool_use: { tool_calls_executed: 1 },
    input_tokens: 12, output_tokens: 3, cost: -1, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: -1 },
    completion_tokens_details: { reasoning_tokens: '4' } } };
  mockApi(t, data);
  const { result, usage } = await createOpenRouterProvider(settings()).search(query, context);
  assert.equal(result.metadata.model, null); assert.equal(result.metadata.request_id, null); assert.equal(result.metadata.cost_usd, null);
  assert.deepEqual(usage, { input: 0, output: 3, cacheRead: 20, cacheWrite: 0, reasoning: 0, totalTokens: 23,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
});

test('credential validation is local, trims env first, and falls back only when enabled', async t => {
  const fetch = mockApi(t);
  const s = settings();
  const previous = process.env[s.apiKeyEnv];
  t.after(() => { if (previous === undefined) delete process.env[s.apiKeyEnv]; else process.env[s.apiKeyEnv] = previous; });
  const getApiKey = t.mock.fn(async (provider: string) => { assert.equal(provider, 'openrouter'); return ' pi-key '; });
  process.env[s.apiKeyEnv] = ' env-key ';
  await createOpenRouterProvider(s).validate({ getApiKey }); assert.equal(getApiKey.mock.callCount(), 0);
  await createOpenRouterProvider(s).search(query, { getApiKey });
  assert.equal(((fetch.mock.calls[0].arguments as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization, 'Bearer env-key');
  process.env[s.apiKeyEnv] = ' ';
  await createOpenRouterProvider(s).validate({ getApiKey }); assert.equal(getApiKey.mock.callCount(), 1);
  s.usePiCredentials = false;
  await assert.rejects(createOpenRouterProvider(s).validate({ getApiKey }), code('authentication'));
  assert.equal(getApiKey.mock.callCount(), 1);
  s.usePiCredentials = true;
  await assert.rejects(createOpenRouterProvider(s).validate({ getApiKey: async () => ' ' }), code('authentication'));
  assert.equal(fetch.mock.callCount(), 1);
});

test('valid engine/mode combinations, ignored Perplexity mode, and fetch engines', async t => {
  const fetch = mockApi(t);
  for (const [engine, modes] of Object.entries({ parallel: ['turbo', 'fast', 'basic', 'advanced'],
    exa: ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'], perplexity: ['advanced'] })) {
    for (const mode of modes) {
      const s = settings(); s.search = { engine, mode } as typeof s.search;
      await createOpenRouterProvider(s).search(query, context);
      const body = JSON.parse((fetch.mock.calls.at(-1)!.arguments as unknown as [string, RequestInit])[1].body as string);
      assert.equal(body.tools[0].parameters.engine, engine);
      assert.equal(body.tools[0].parameters.mode, engine === 'perplexity' ? undefined : mode);
    }
  }
  for (const engine of ['parallel', 'exa', 'openrouter', 'firecrawl'] as const) {
    const s = settings(); s.fetch.engine = engine; await createOpenRouterProvider(s).validate(context);
  }
});

test('bad config and invalid inputs fail locally, including search/fetch revalidation', async t => {
  const fetch = mockApi(t);
  const bad = [ { timeoutMs: 0 }, { maxOutputTokens: 1.5 }, { endpoint: 'file:///tmp/key' }, { endpoint: 'https://user:pass@example.com' },
    { model: ' ' }, { apiKeyEnv: '' }, { usePiCredentials: 'yes' },
    ...[{ model: ' ' }, { maxResults: 0 }, { maxResults: 1.5 }, { minScore: -1 }, { minScore: 4 },
      { minScore: NaN }, { timeoutMs: 0 }].map(change => ({ ranking: { ...settings().ranking, ...change } })),
    { search: { engine: 'native', mode: 'advanced' } }, { search: { engine: 'parallel', mode: 'deep' } },
    { search: { engine: 'exa', mode: 'advanced' } }, { search: { engine: 'toString', mode: 'advanced' } },
    { fetch: { engine: 'auto', maxContentTokens: 5 } }, { fetch: { engine: 'parallel', maxContentTokens: -1 } },
  ];
  for (const change of bad) {
    const provider = createOpenRouterProvider({ ...settings(), ...change } as ReturnType<typeof settings>);
    await assert.rejects(provider.validate(context), code('configuration'));
    await assert.rejects(provider.search(query, context), code('configuration'));
    await assert.rejects(provider.fetch({ url: 'https://example.com', objective: 'text' }, context), code('configuration'));
  }
  const provider = createOpenRouterProvider(settings());
  for (const change of [{ query: ' ' }, { max_results: 0 }, { max_results: 21 }, { max_results: 1.2 }, { search_context_size: 'huge' }]) {
    await assert.rejects(provider.search({ ...query, ...change } as SearchInput, context), code('invalid_input'));
  }
  await assert.rejects(provider.search({ ...query, recency: 'day' }, context), code('unsupported_option'));
  for (const url of ['/path', 'file:///tmp/a', 'https://u:p@example.com']) {
    await assert.rejects(provider.fetch({ url, objective: 'text' }, context), code('invalid_input'));
  }
  await assert.rejects(provider.fetch({ url: 'https://example.com', objective: ' ' }, context), code('invalid_input'));
  assert.equal(fetch.mock.callCount(), 0);
});

test('HTTP failures use shared typed errors and never retry or expose credentials', async t => {
  const fetch = mockApi(t, { error: { message: 'denied test-key' } }, 401);
  await assert.rejects(createOpenRouterProvider(settings()).search(query, context), (error: unknown) => {
    assert.ok(error instanceof WebToolsError); assert.equal(error.code, 'authentication');
    assert.doesNotMatch(error.message, /test-key/); assert.match(error.message, /REDACTED/); return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('pre-aborted context causes no network call', async t => {
  const fetch = mockApi(t);
  await assert.rejects(createOpenRouterProvider(settings()).search(query,
    { ...context, signal: AbortSignal.abort() }), code('cancelled'));
  assert.equal(fetch.mock.callCount(), 0);
});
