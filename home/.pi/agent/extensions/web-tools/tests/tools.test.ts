// Offline public-tool integration tests. Run with Node 24's native TS support.
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import test, { beforeEach } from 'node:test';
import { Check, Errors } from 'typebox/value';
import { config } from '../config.ts';
import { emptyMetadata, WebToolsError } from '../contracts.ts';
import { formatResult } from '../formatting.ts';
import { createProviders } from '../providers/index.ts';
import { renderCall, renderResult } from '../rendering.ts';
import { FetchOutputSchema, FetchParams, SearchOutputSchema, SearchParams } from '../schemas.ts';
import { registerTools } from '../tools.ts';

const url = 'https://example.com/article';
const excerpt = 'PROVIDER excerpt: factual page text.';
const report = 'MODEL report: synthesis, not a provider quotation.';
const theme = { fg: (_color, text) => text, bold: text => text };
const context = { modelRegistry: { async getApiKeyForProvider(provider) {
  assert.equal(provider, 'openrouter');
  return 'offline-registry-key';
},
  findOfType(type, provider, id) {
    assert.equal(type, 'classifier'); assert.equal(provider, 'openrouter');
    return { id, provider };
  },
  async classify(model, input, options) {
    assert.equal(options.apiKey, 'offline-registry-key');
    assert.ok(options.signal instanceof AbortSignal);
    return { stopReason: 'stop',
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, { type: 'score', score: 3, confidence: 1 }])),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
  },
} };

beforeEach(t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Unexpected HTTP: tests must stay offline'));
  const name = 'WEB_TOOLS_TEST_PERPLEXITY_KEY';
  const previous = process.env[name];
  process.env[name] = 'offline-perplexity-key';
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
});
function settings() {
  const value = structuredClone(config);
  value.openrouter.apiKeyEnv = 'WEB_TOOLS_TEST_UNUSED_OPENROUTER_KEY';
  value.perplexity.apiKeyEnv = 'WEB_TOOLS_TEST_PERPLEXITY_KEY';
  value.perplexity.baseUrlEnv = 'WEB_TOOLS_TEST_UNUSED_BASE_URL';
  return value;
}
function harness(value = settings(), select?) {
  const providers = createProviders(value);
  const tools = new Map();
  registerTools({ registerTool: tool => tools.set(tool.name, tool) }, value, select ?? (() => providers[value.defaultProvider]));
  return { providers, tools, run: (name, args, signal?, onUpdate?) => tools.get(name).execute('test-call', args, signal, onUpdate, context) };
}
function source(sourceUrl = url, snippet = excerpt) { return { url: sourceUrl, title: 'Test page', snippet }; }
function fixture(provider, operation, sources = [source()]) {
  return provider === 'openrouter' ? {
    id: 'offline-or', model: 'test/model',
    choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ status: 'ok', report }),
      annotations: sources.map(s => ({ type: 'url_citation', url_citation: { url: s.url, title: s.title, content: s.snippet } })),
    } }],
    usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      completion_tokens_details: { reasoning_tokens: 8 }, cost: 0.0123,
      server_tool_use_details: { tool_calls_executed: 1 } },
  } : operation === 'search' ? {
    id: 'offline-pplx', results: sources, usage: { input_tokens: 100, output_tokens: 40, cost: { total_cost: 0.0123 } },
  } : {
    id: 'offline-pplx', status: 'completed', output: [
      { type: 'fetch_url_results', contents: sources },
      { type: 'message', content: [{ type: 'output_text', text: report }] },
    ], usage: { input_tokens: 100, output_tokens: 40, cost: { total_cost: 0.0123 } },
  };
}
function mockRequests(t, respond?) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
    const body = JSON.parse(init.body);
    const provider = String(endpoint).includes('openrouter') ? 'openrouter' : 'perplexity';
    const operation = provider === 'openrouter' ? (body.tools[0].type.endsWith('web_search') ? 'search' : 'fetch')
      : String(endpoint).endsWith('/search') ? 'search' : 'fetch';
    const request = { endpoint: String(endpoint), body, provider, operation, init };
    requests.push(request);
    return new Response(JSON.stringify(respond ? await respond(request) : fixture(provider, operation)), { status: 200 });
  });
  return requests;
}
function checked(output, operation, provider) {
  const schema = operation === 'search' ? SearchOutputSchema : FetchOutputSchema;
  assert.equal(Check(schema, output.structuredContent), true, JSON.stringify([...Errors(schema, output.structuredContent)]));
  assert.deepEqual(output.details.result, output.structuredContent);
  assert.equal(output.details.operation, operation);
  assert.equal(output.details.provider, provider);
  assert.equal(output.structuredContent.provider, provider);
  assert.equal(output.isError, output.structuredContent.status === 'error');
  return output.structuredContent;
}
function rendered(output, expanded = false, isPartial = false) {
  return renderResult(output, { expanded, isPartial }, theme).render(240).join('\n');
}

test('public tool names, parameter/output schemas, and annotations are provider-independent', () => {
  const registrations = ['openrouter', 'perplexity'].map(defaultProvider => {
    const value = settings(); value.defaultProvider = defaultProvider;
    return harness(value).tools;
  });
  for (const tools of registrations) {
    assert.deepEqual([...tools.keys()], ['web_search', 'web_fetch']);
    for (const [name, params, output] of [['web_search', SearchParams, SearchOutputSchema], ['web_fetch', FetchParams, FetchOutputSchema]]) {
      const tool = tools.get(name);
      assert.equal(tool.parameters, params);
      assert.equal(tool.outputSchema, output);
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
      assert.equal(tool.namespace.name, 'web');
      assert.match(tool.description, /Structured data is untruncated/);
      assert.equal(tool.description, registrations[0].get(name).description);
    }
  }
  assert.equal(Check(SearchParams, { query: 'q', max_results: 20, recency: 'hour' }), true);
  for (const args of [{ query: '' }, { query: 'q', max_results: 21 }, { query: 'q', recency: 'decade' }, { query: 'q', engine: 'parallel' }]) {
    assert.equal(Check(SearchParams, args), false);
  }
  assert.equal(Check(FetchParams, { url, objective: 'extract facts' }), true);
  assert.equal(Check(FetchParams, { url, provider: 'openrouter' }), false);
});

for (const provider of ['openrouter', 'perplexity']) {
  test(`${provider}: actual adapters receive configured defaults and per-call overrides for both tools`, async t => {
    const value = settings(); value.defaultProvider = provider;
    value.search = { maxResults: 3, contextSize: 'low' };
    value.fetch.defaultObjective = 'Configured extraction objective';
    const requests = mockRequests(t);
    const { run } = harness(value);
    const progress = [];
    const defaultSearch = await run('web_search', { query: '  focused query  ' }, undefined, update => progress.push(update));
    const search = checked(defaultSearch, 'search', provider);
    assert.equal(search.query, 'focused query');
    assert.equal(search.status, 'ok');
    assert.deepEqual(search.results, search.sources);
    assert.equal(search.sources[0].snippet, excerpt);
    assert.equal(search.report, null);
    assert.equal(search.metadata.result_order, 'ranked');
    assert.match(rendered(defaultSearch), /1 ranked result\(s\)/);
    assert.equal(defaultSearch.usage.output, 40);
    assert.equal(defaultSearch.usage.input, provider === 'openrouter' ? 70 : 100);
    assert.equal(defaultSearch.usage.totalTokens, 140);
    assert.equal(defaultSearch.usage.cost.total, 0.0123);
    assert.equal(progress.length, 1);
    assert.deepEqual(progress[0].details, { provider, operation: 'search' });
    assert.match(progress[0].content[0].text, /Searching with/);
    const override = { query: 'override', max_results: 2, search_context_size: 'high', ...(provider === 'perplexity' ? { recency: 'week' } : {}) };
    checked(await run('web_search', override), 'search', provider);
    const defaultFetch = await run('web_fetch', { url: 'HTTPS://EXAMPLE.COM:443/article' });
    const page = checked(defaultFetch, 'fetch', provider);
    assert.equal(page.url, url);
    assert.equal(page.source_url, url);
    assert.equal(page.content, excerpt);
    assert.equal(page.report, report);
    assert.equal(defaultFetch.usage.cost.total, 0.0123);
    checked(await run('web_fetch', { url, objective: '  Extract pricing only  ' }), 'fetch', provider);
    assert.equal(requests.length, 4);
    for (const [index, maxResults, size] of [[0, 3, 'low'], [1, 2, 'high']]) {
      const body = requests[index].body;
      const sent = provider === 'openrouter' ? body.tools[0].parameters : body;
      assert.equal(sent.max_results, maxResults);
      assert.equal(sent.search_context_size, size);
      const query = provider === 'openrouter' ? JSON.parse(body.messages[1].content).query : body.query;
      assert.equal(query, index ? 'override' : 'focused query');
    }
    if (provider === 'perplexity') assert.equal(requests[1].body.search_recency_filter, 'week');
    for (const [index, objective] of [[2, value.fetch.defaultObjective], [3, 'Extract pricing only']]) {
      if (provider === 'openrouter') assert.deepEqual(JSON.parse(requests[index].body.messages[1].content), { url, objective });
      else {
        assert.ok(requests[index].body.input.includes(JSON.stringify(url)));
        assert.ok(requests[index].body.input.includes(`Objective: ${objective}\n`));
      }
    }
    const text = defaultFetch.content[0].text;
    assert.ok(text.indexOf(excerpt) > text.indexOf('## Provider source excerpts'));
    assert.ok(text.indexOf(excerpt) < text.indexOf('## Model-written retrieval report / notes'));
    assert.ok(text.indexOf(report) > text.indexOf('## Model-written retrieval report / notes'));
    assert.match(text, /untrusted/i);
    assert.equal(page.full_output_path, null);
  });

  test(`${provider}: fetch selects the exact matching source, not the first citation`, async t => {
    const value = settings(); value.defaultProvider = provider;
    mockRequests(t, request => fixture(request.provider, request.operation, [
      source('https://example.com/other', 'Unrelated excerpt'), source(url, 'Matching excerpt'),
    ]));
    const page = checked(await harness(value).run('web_fetch', { url }), 'fetch', provider);
    assert.equal(page.status, 'ok');
    assert.equal(page.source_url, url);
    assert.equal(page.content, 'Matching excerpt');
    assert.equal(page.sources.length, 2);
    assert.equal(page.report, report);
  });

  test(`${provider}: fetch never substitutes an unrelated URL's excerpt or model report`, async t => {
    const value = settings(); value.defaultProvider = provider;
    mockRequests(t, request => fixture(request.provider, request.operation, [source('https://example.com/other')]));
    const output = await harness(value).run('web_fetch', { url });
    const page = checked(output, 'fetch', provider);
    assert.equal(page.source_url, null);
    assert.equal(page.title, null);
    assert.equal(page.content, null);
    assert.equal(page.report, report);
    assert.equal(page.sources[0].url, 'https://example.com/other');
    assert.ok(page.warnings.some(warning => /match/i.test(warning)));
    assert.match(output.content[0].text, /not verified page text/);
  });
}

test('empty direct search is schema-valid not_found, not an error, and does not invent usage or a report', async t => {
  const value = settings(); value.defaultProvider = 'perplexity';
  mockRequests(t, () => ({ results: [] }));
  const output = await harness(value).run('web_search', { query: 'no matches' });
  const result = checked(output, 'search', 'perplexity');
  assert.equal(result.status, 'not_found');
  assert.equal(result.report, null);
  assert.equal(result.error, null);
  assert.deepEqual(result.results, []);
  assert.equal(output.isError, false);
  assert.equal(output.usage, undefined);
  assert.match(rendered(output), /No relevant content found/);
});

test('invalid input, unsupported recency, and pre-cancelled calls return standard errors without network', async () => {
  const { run } = harness(); // beforeEach fails any network request
  for (const [name, args, code] of [
    ['web_search', { query: ' ' }, 'invalid_input'],
    ['web_search', { query: 'q', max_results: 0 }, 'invalid_input'],
    ['web_search', { query: 'q', max_results: 1.5 }, 'invalid_input'],
    ['web_search', { query: 'q', search_context_size: 'huge' }, 'invalid_input'],
    ['web_search', { query: 'q', recency: 'decade' }, 'invalid_input'],
    ['web_search', { query: 'q', recency: 'day' }, 'unsupported_option'],
    ['web_fetch', { url: 'file:///private' }, 'invalid_input'],
    ['web_fetch', { url: 'https://user:password@example.com/' }, 'invalid_input'],
    ['web_fetch', { url, objective: ' ' }, 'invalid_input'],
  ]) {
    const result = checked(await run(name, args), name === 'web_search' ? 'search' : 'fetch', 'openrouter');
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, code);
    assert.deepEqual(result.sources, []);
    assert.equal(result.report, null);
    assert.deepEqual(result.metadata, emptyMetadata());
  }
  const cancelled = checked(await run('web_fetch', { url }, AbortSignal.abort()), 'fetch', 'openrouter');
  assert.equal(cancelled.error.code, 'cancelled');
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('provider failures become schema-valid errors and unexpected exception secrets are not exposed', async t => {
  const { run } = harness();
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"Rejected offline-registry-key"}', { status: 401 }));
  const auth = checked(await run('web_search', { query: 'q' }), 'search', 'openrouter');
  assert.equal(auth.error.code, 'authentication');
  assert.doesNotMatch(auth.error.message, /offline-registry-key/);
  assert.match(auth.error.message, /\[REDACTED\]/);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const malformed = checked(await run('web_fetch', { url }), 'fetch', 'openrouter');
  assert.equal(malformed.error.code, 'invalid_response');
  const provider = createProviders(settings()).openrouter;
  provider.search = async () => { throw new Error('secret-internal-token'); };
  const unexpected = await harness(settings(), () => provider).run('web_search', { query: 'q' });
  assert.equal(checked(unexpected, 'search', 'openrouter').error.code, 'retrieval_failed');
  assert.doesNotMatch(JSON.stringify(unexpected), /secret-internal-token/);
  provider.search = async () => { throw new WebToolsError('configuration', 'Invalid local setting'); };
  assert.equal((await harness(settings(), () => provider).run('web_search', { query: 'q' })).structuredContent.error.code, 'configuration');
});

test('selection errors return schema-valid data without choosing a fallback provider', async () => {
  const { run } = harness(settings(), () => { throw new WebToolsError('configuration', 'Unknown web provider.'); });
  for (const [name, args, operation] of [['web_search', { query: 'q' }, 'search'], ['web_fetch', { url }, 'fetch']]) {
    const output = await run(name, args);
    const result = checked(output, operation, null);
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'configuration');
    assert.match(rendered(output), /\[no provider\]/);
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('both output limits write private full Markdown while structured data remains untruncated', async t => {
  const longExcerpt = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'évidence '.repeat(20)}`).join('\n');
  mockRequests(t, request => fixture(request.provider, request.operation, [source(url, longExcerpt)]));
  for (const output of [{ maxLines: 12, maxBytes: 100_000 }, { maxLines: 10_000, maxBytes: 300 }]) {
    const value = settings(); value.output = output;
    const response = await harness(value).run('web_fetch', { url });
    const result = checked(response, 'fetch', 'openrouter');
    assert.equal(result.content, longExcerpt);
    assert.equal(result.sources[0].snippet, longExcerpt);
    assert.equal(result.report, report);
    const path = result.full_output_path;
    assert.equal(typeof path, 'string');
    t.after(() => rm(dirname(path), { recursive: true, force: true }));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
    assert.equal(await readFile(path, 'utf8'), formatResult(result));
    assert.match(response.content[0].text, /Output truncated/);
    assert.ok(response.content[0].text.includes(path));
    assert.ok(response.content[0].text.length < longExcerpt.length);
    assert.match(rendered(response, true), /\(truncated\)/);
    assert.ok(rendered(response, true).includes(path));
  }
});

test('renderers cover success, report-only, not_found, errors, missing details, and progress', async t => {
  let payload = fixture('openrouter', 'search');
  mockRequests(t, () => payload);
  const { run, tools } = harness();
  const success = await run('web_search', { query: 'render query' });
  assert.match(rendered(success), /\[openrouter\] 1 ranked result\(s\)/);
  assert.doesNotMatch(rendered(success), /Test page/);
  const expanded = rendered(success, true);
  for (const text of ['render query', 'Test page', url, 'Evidence: tool_execution', 'Model: test/model', 'Server tool calls: 1', 'API cost: $0.012300']) assert.ok(expanded.includes(text));
  assert.match(rendered(await run('web_fetch', { url })), /Retrieved Test page/);
  payload = fixture('openrouter', 'search', []);
  assert.match(rendered(await run('web_search', { query: 'q' })), /Web retrieval failed/);
  const reportOnly = await run('web_fetch', { url });
  assert.match(rendered(reportOnly), /Model report only; no matching provider excerpt/);
  assert.equal(reportOnly.structuredContent.content, null);
  for (const status of ['not_found', 'error']) {
    payload.choices[0].message.content = JSON.stringify({ status, report });
    const output = await run('web_search', { query: 'q' });
    checked(output, 'search', 'openrouter');
    assert.equal(output.isError, status === 'error');
    assert.match(rendered(output), status === 'error' ? /Web retrieval failed/ : /No relevant content found/);
    assert.ok(!rendered(output, true).includes(report));
  }
  assert.match(rendered({}), /Web retrieval failed/);
  assert.match(rendered({ details: { operation: 'fetch', provider: 'perplexity' } }, false, true), /Fetching with perplexity/);
  assert.match(rendered({}, false, true), /Searching with web provider/);
  assert.match(renderCall('fetch', url, theme).render(200).join(''), /web_fetch https:\/\/example.com\/article/);
  assert.match(tools.get('web_search').renderCall({ query: 'hello' }, theme).render(200).join(''), /web_search "hello"/);
});

test('each in-flight call snapshots its provider, usage, progress, and historical renderer', async t => {
  const value = settings();
  const providers = createProviders(value);
  let selected = providers.openrouter;
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const requests = mockRequests(t, async request => {
    if (request.provider === 'openrouter') { entered(); await gate; }
    return fixture(request.provider, request.operation);
  });
  const { run } = harness(value, () => selected);
  const updates = [];
  const pending = run('web_search', { query: 'first' }, undefined, update => updates.push(update));
  await started;
  try {
    selected = providers.perplexity;
    checked(await run('web_fetch', { url }), 'fetch', 'perplexity');
    checked(await run('web_search', { query: 'second' }), 'search', 'perplexity');
  } finally { release(); }
  const first = await pending;
  checked(first, 'search', 'openrouter');
  assert.equal(first.usage.cacheRead, 20);
  assert.equal(updates[0].details.provider, 'openrouter');
  assert.match(rendered(first, true), /\[openrouter\]/);
  assert.deepEqual(requests.map(r => [r.provider, r.operation]), [['openrouter', 'search'], ['perplexity', 'fetch'], ['perplexity', 'search']]);
});

test('Sol status-only search, Jev selection, original evidence output, and combined accounting end to end', async t => {
  const originals = [
    source('https://example.com/a', '  Exact\r\nUnicode café 雪\t '),
    source('https://example.com/b', 'Unrelated material'),
    source('https://example.com/c', 'Direct evidence\nwith [links](https://example.com)'),
  ];
  mockRequests(t, () => {
    const data = fixture('openrouter', 'search', originals);
    data.choices[0].message.content = '{"status":"ok"}';
    return data;
  });
  const classifier = t.mock.method(context.modelRegistry, 'classify', async (model, input, options) => {
    assert.equal(model.id, config.openrouter.ranking.model);
    assert.equal(options.apiKey, 'offline-registry-key');
    assert.equal(options.maxRetries, 0);
    assert.equal(input.state.query, 'focused query');
    assert.deepEqual(input.state.results.map(r => r.snippet), originals.map(r => r.snippet));
    return { stopReason: 'stop', answers: {
      result_0: { type: 'score', score: 2 }, result_1: { type: 'score', score: 0.1 },
      result_2: { type: 'score', score: 3 },
    }, usage: { input: 10, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 13,
      cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } } };
  });
  const output = await harness().run('web_search', { query: 'focused query' });
  const result = checked(output, 'search', 'openrouter');
  assert.equal(classifier.mock.callCount(), 1);
  assert.deepEqual(result.sources.map(s => s.snippet), [originals[2].snippet, originals[0].snippet]);
  assert.equal(result.report, null);
  assert.equal(result.metadata.ranking.status, 'ranked');
  assert.equal(result.metadata.ranking.candidates, 3);
  assert.equal(result.metadata.ranking.selected, 2);
  assert.equal(output.usage.input, 80);
  assert.equal(output.usage.output, 42);
  assert.equal(output.usage.totalTokens, 153);
  assert.equal(output.usage.cost.total, 0.0123 + 0.001);
  assert.equal(result.metadata.cost_usd, output.usage.cost.total);
  for (const snippet of [originals[2].snippet, originals[0].snippet]) assert.ok(output.content[0].text.includes(snippet));
  assert.doesNotMatch(output.content[0].text, /Unrelated material|Model-written retrieval report/);
  assert.doesNotMatch(JSON.stringify(output), /offline-registry-key/);
});

test('search ranking failure is explicit, no report is substituted, and missing cost remains unknown', async t => {
  mockRequests(t);
  t.mock.method(context.modelRegistry, 'classify', async () => { throw new Error('private-key'); });
  const output = await harness().run('web_search', { query: 'q' });
  const result = checked(output, 'search', 'openrouter');
  assert.equal(result.status, 'ok');
  assert.equal(result.metadata.ranking.status, 'fallback');
  assert.equal(result.metadata.result_order, 'citation');
  assert.equal(result.metadata.cost_usd, null);
  assert.equal(result.report, null);
  assert.equal(result.sources[0].snippet, excerpt);
  assert.ok(result.warnings.some(w => /ranking unavailable/.test(w)));
  assert.doesNotMatch(JSON.stringify(output), /private-key/);
});

test('cancellation during Jev ranking retains completed retrieval usage', async t => {
  mockRequests(t);
  const controller = new AbortController();
  t.mock.method(context.modelRegistry, 'classify', async (_model, _input, options) => {
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return { stopReason: 'aborted', answers: {} };
  });
  const output = await harness().run('web_search', { query: 'q' }, controller.signal);
  const result = checked(output, 'search', 'openrouter');
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'cancelled');
  assert.deepEqual(result.sources, []);
  assert.equal(result.report, null);
  assert.equal(output.usage.totalTokens, 140);
  assert.equal(output.usage.cost.total, 0.0123);
  assert.equal(result.metadata.cost_usd, null);
});

test('all low scores produce not_found; no excerpts produce error without classifying or leaking Sol prose', async t => {
  let sources = [source()];
  mockRequests(t, () => fixture('openrouter', 'search', sources));
  const classify = t.mock.method(context.modelRegistry, 'classify', async () => ({
    stopReason: 'stop', answers: { result_0: { type: 'score', score: 0 } },
  }));
  const { run } = harness();
  const low = checked(await run('web_search', { query: 'q' }), 'search', 'openrouter');
  assert.equal(low.status, 'not_found');
  assert.deepEqual(low.sources, []);
  assert.equal(low.error, null);
  assert.equal(classify.mock.callCount(), 1);
  sources = [];
  const missing = await run('web_search', { query: 'q' });
  assert.equal(checked(missing, 'search', 'openrouter').error.code, 'retrieval_failed');
  assert.equal(classify.mock.callCount(), 1);
  assert.equal(missing.structuredContent.report, null);
  assert.doesNotMatch(missing.content[0].text, /MODEL report/);
});

test('invalid shared defaults fail locally during registration', () => {
  for (const mutate of [value => { value.output.maxLines = 0; }, value => { value.output.maxBytes = -1; },
    value => { value.search.maxResults = 21; }, value => { value.search.contextSize = 'huge'; },
    value => { value.fetch.defaultObjective = ' '; }]) {
    const value = settings(); mutate(value);
    assert.throws(() => harness(value), error => error instanceof WebToolsError && error.code === 'configuration');
  }
});
