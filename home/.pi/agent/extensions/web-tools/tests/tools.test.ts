// Offline public-tool integration tests. Run with Node 24's native TS support.
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import test, { beforeEach, type TestContext } from 'node:test';
import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { ExtensionToolContext, Theme, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { jsonObject, mockFetch } from './helpers.ts';
import { Check, Errors } from 'typebox/value';
import { config, validateConfig, type WebToolsConfig } from '../config.ts';
import { emptyMetadata, WebToolsError, type Operation, type ToolResultData } from '../contracts.ts';
import { formatResult } from '../formatting.ts';
import { createPerplexity } from '../perplexity.ts';
import { renderCall, renderResult, type Details } from '../rendering.ts';
import { FetchOutputSchema, FetchParams, SearchOutputSchema, SearchParams } from '../schemas.ts';
import { registerTools } from '../tools.ts';

const url = 'https://example.com/article';
const excerpt = 'PROVIDER excerpt: factual page text.';
const notes = 'MODEL notes: synthesis, not a provider quotation.';
// Only these Theme methods are consumed by the renderers.
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
let networkCalls = 0;

beforeEach(context => {
  const t = context as TestContext; // This hook belongs to tests, not suites.
  networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; return assert.fail('Unexpected HTTP: tests must stay offline'); });
  const name = 'WEB_TOOLS_TEST_PERPLEXITY_KEY';
  const previous = process.env[name];
  process.env[name] = 'offline-perplexity-key';
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
});
function settings() {
  const value = structuredClone(config);
  value.perplexity.apiKeyEnv = 'WEB_TOOLS_TEST_PERPLEXITY_KEY';
  value.perplexity.baseUrlEnv = 'WEB_TOOLS_TEST_UNUSED_BASE_URL';
  return value;
}
type RegisteredTool = ToolDefinition<typeof SearchParams | typeof FetchParams, Details>;
function harness(value = settings(), retriever = createPerplexity(value.perplexity)) {
  validateConfig(value);
  const tools = new Map<string, RegisteredTool>();
  // Registration erases the per-tool parameter type; run restores it via the schema.
  registerTools({ registerTool: tool => { tools.set(tool.name, tool as unknown as RegisteredTool); } }, value, retriever);
  const getTool = (name: string) => { const tool = tools.get(name); assert.ok(tool); return tool; };
  async function run(name: string, args: unknown, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<Details>) {
    const tool = getTool(name);
    assert.ok(Check(tool.parameters, args), 'Arguments must pass Pi parameter validation');
    // These tools do not consume the execution context.
    const output = await tool.execute('test-call', args, signal, onUpdate, {} as ExtensionToolContext);
    const result = checked(output, name === 'web_search' ? 'search' : 'fetch');
    const content = output.content.map(part => { assert.equal(part.type, 'text'); return part; });
    return { ...output, content, structuredContent: result };
  }
  return { tools, getTool, run };
}
function source(sourceUrl = url, snippet = excerpt) { return { url: sourceUrl, title: 'Test page', snippet }; }
function fixture(operation: Operation, sources = [source()]) {
  const usage = { input_tokens: 100, output_tokens: 40, cost: { total_cost: 0.0123 } };
  return operation === 'search' ? { id: 'offline-pplx', results: sources, usage } : {
    id: 'offline-pplx', model: 'agent-model', status: 'completed', usage, output: [
      { type: 'fetch_url_results', contents: sources },
      { type: 'message', content: [{ type: 'output_text', text: notes }] },
    ],
  };
}
type Request = { endpoint: string; body: Record<string, unknown>; operation: Operation; init: RequestInit };
function mockRequests(t: TestContext, respond?: (request: Request) => unknown | Promise<unknown>) {
  const requests: Request[] = [];
  mockFetch(t, async (endpoint, init) => {
    const body = jsonObject(init.body);
    const operation = String(endpoint).endsWith('/search') ? 'search' : 'fetch';
    const request: Request = { endpoint: String(endpoint), body, operation, init };
    requests.push(request);
    return new Response(JSON.stringify(respond ? await respond(request) : fixture(operation)), { status: 200 });
  });
  return requests;
}
function checked<O extends Operation>(output: AgentToolResult<Details>, operation: O): Extract<ToolResultData, { operation: O }> {
  const schema = operation === 'search' ? SearchOutputSchema : FetchOutputSchema;
  assert.ok(Check(schema, output.structuredContent), JSON.stringify([...Errors(schema, output.structuredContent)]));
  assert.deepEqual(output.details.result, output.structuredContent);
  assert.equal(output.details.operation, operation);
  assert.equal(output.isError, output.structuredContent.status === 'error');
  // The selected schema checked the operation literal and every result field.
  return output.structuredContent as Extract<ToolResultData, { operation: O }>;
}
function rendered(output: Parameters<typeof renderResult>[0], expanded = false, isPartial = false) {
  return renderResult(output, { expanded, isPartial }, theme).render(240).join('\n');
}

test('public tool names, parameter/output schemas, and annotations', () => {
  const { tools, getTool } = harness();
  assert.deepEqual([...tools.keys()], ['web_search', 'web_fetch']);
  for (const [name, params, output] of [['web_search', SearchParams, SearchOutputSchema], ['web_fetch', FetchParams, FetchOutputSchema]] as const) {
    const tool = getTool(name);
    assert.equal(tool.parameters, params);
    assert.equal(tool.outputSchema, output);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    assert.equal(tool.namespace?.name, 'web');
    assert.match(tool.description, /Structured data is untruncated/);
  }
  assert.equal(Check(SearchParams, { query: 'q', max_results: 20, recency: 'hour' }), true);
  for (const args of [{ query: '' }, { query: 'q', max_results: 21 }, { query: 'q', max_results: 0 },
    { query: 'q', max_results: 1.5 }, { query: 'q', search_context_size: 'huge' },
    { query: 'q', recency: 'decade' }, { query: 'q', engine: 'parallel' }]) {
    assert.equal(Check(SearchParams, args), false);
  }
  assert.equal(Check(FetchParams, { url, objective: 'extract facts' }), true);
  assert.equal(Check(FetchParams, { url, provider: 'openrouter' }), false);
});

test('tools send configured defaults and per-call overrides to Perplexity', async t => {
  const value = settings();
  value.search = { maxResults: 3, contextSize: 'low' };
  value.fetch.defaultObjective = 'Configured extraction objective';
  const requests = mockRequests(t);
  const { run } = harness(value);
  const progress: AgentToolResult<Details>[] = [];
  const defaultSearch = await run('web_search', { query: '  focused query  ' }, undefined, update => progress.push(update));
  const search = checked(defaultSearch, 'search');
  assert.equal(search.query, 'focused query');
  assert.equal(search.status, 'ok');
  assert.deepEqual(search.results, search.sources);
  assert.equal(search.sources[0].snippet, excerpt);
  assert.equal(search.report, null);
  assert.equal(search.metadata.result_order, 'ranked');
  assert.match(rendered(defaultSearch), /1 result\(s\)/);
  assert.ok(defaultSearch.usage);
  assert.equal(defaultSearch.usage.input, 100);
  assert.equal(defaultSearch.usage.output, 40);
  assert.equal(defaultSearch.usage.totalTokens, 140);
  assert.equal(defaultSearch.usage.cost.total, 0.0123);
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].details, { operation: 'search' });
  assert.equal(progress[0].content[0].type, 'text');
  assert.match(progress[0].content[0].text, /Searching with Perplexity/);
  checked(await run('web_search', { query: 'override', max_results: 2, search_context_size: 'high', recency: 'week' }), 'search');
  const defaultFetch = await run('web_fetch', { url: 'HTTPS://EXAMPLE.COM:443/article' });
  const page = checked(defaultFetch, 'fetch');
  assert.equal(page.url, url);
  assert.equal(page.source_url, url);
  assert.equal(page.content, excerpt);
  assert.equal(page.report, notes);
  assert.ok(defaultFetch.usage);
  assert.equal(defaultFetch.usage.cost.total, 0.0123);
  checked(await run('web_fetch', { url, objective: '  Extract pricing only  ' }), 'fetch');
  assert.equal(requests.length, 4);
  for (const [index, maxResults, size, query] of [[0, 3, 'low', 'focused query'], [1, 2, 'high', 'override']] as const) {
    const body = requests[index].body;
    assert.equal(body.max_results, maxResults);
    assert.equal(body.search_context_size, size);
    assert.equal(body.query, query);
  }
  assert.equal(requests[0].body.search_recency_filter, undefined);
  assert.equal(requests[1].body.search_recency_filter, 'week');
  for (const [index, objective] of [[2, value.fetch.defaultObjective], [3, 'Extract pricing only']] as const) {
    const input = requests[index].body.input;
    assert.ok(typeof input === 'string');
    assert.ok(input.includes(JSON.stringify(url)));
    assert.ok(input.includes(`Objective: ${objective}\n`));
  }
  const text = defaultFetch.content[0].text;
  assert.ok(text.indexOf(excerpt) > text.indexOf('## Provider source excerpts'));
  assert.ok(text.indexOf(excerpt) < text.indexOf('## Model-written fetch notes'));
  assert.ok(text.indexOf(notes) > text.indexOf('## Model-written fetch notes'));
  assert.match(text, /untrusted/i);
  assert.equal(page.full_output_path, null);
});

test('fetch selects the exact matching source, not the first one', async t => {
  mockRequests(t, request => fixture(request.operation, [
    source('https://example.com/other', 'Unrelated excerpt'), source(url, 'Matching excerpt'),
  ]));
  const page = checked(await harness().run('web_fetch', { url }), 'fetch');
  assert.equal(page.status, 'ok');
  assert.equal(page.source_url, url);
  assert.equal(page.content, 'Matching excerpt');
  assert.equal(page.sources.length, 2);
  assert.equal(page.report, notes);
});

test("fetch never substitutes an unrelated URL's excerpt or model notes", async t => {
  mockRequests(t, request => fixture(request.operation, [source('https://example.com/other')]));
  const output = await harness().run('web_fetch', { url });
  const page = checked(output, 'fetch');
  assert.equal(page.status, 'error');
  assert.equal(page.source_url, null);
  assert.equal(page.title, null);
  assert.equal(page.content, null);
  assert.equal(page.report, notes);
  assert.equal(page.sources[0].url, 'https://example.com/other');
  assert.ok(page.warnings.some(warning => /match/i.test(warning)));
  assert.match(output.content[0].text, /not verified page text/);
});

test('empty search is schema-valid not_found, not an error, and does not invent usage or a report', async t => {
  mockRequests(t, () => ({ results: [] }));
  const output = await harness().run('web_search', { query: 'no matches' });
  const result = checked(output, 'search');
  assert.equal(result.status, 'not_found');
  assert.equal(result.report, null);
  assert.equal(result.error, null);
  assert.deepEqual(result.results, []);
  assert.equal(output.isError, false);
  assert.equal(output.usage, undefined);
  assert.match(rendered(output), /No relevant content found/);
});

test('invalid input and pre-cancelled calls return standard errors without network', async () => {
  const { run } = harness(); // beforeEach fails any network request
  for (const [name, args, code] of [
    ['web_search', { query: ' ' }, 'invalid_input'],
    ['web_fetch', { url: 'file:///private' }, 'invalid_input'],
    ['web_fetch', { url: 'https://user:password@example.com/' }, 'invalid_input'],
    ['web_fetch', { url, objective: ' ' }, 'invalid_input'],
  ] as const) {
    const result = checked(await run(name, args), name === 'web_search' ? 'search' : 'fetch');
    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, code);
    assert.deepEqual(result.sources, []);
    assert.equal(result.report, null);
    assert.deepEqual(result.metadata, emptyMetadata());
  }
  const cancelled = checked(await run('web_fetch', { url }, AbortSignal.abort()), 'fetch');
  assert.equal(cancelled.error?.code, 'cancelled');
  for (const reason of [new Error('secret-reason'), new WebToolsError('http_error', 'secret-reason'), new WebToolsError('cancelled', 'secret-reason')]) {
    const output = await run('web_search', { query: 'q' }, AbortSignal.abort(reason));
    assert.equal(output.structuredContent.error?.code, 'cancelled');
    assert.doesNotMatch(JSON.stringify(output), /secret-reason/);
  }
  assert.equal(networkCalls, 0);
});

test('provider failures become schema-valid errors and unexpected exception secrets are not exposed', async t => {
  const { run } = harness();
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"Rejected offline-perplexity-key"}', { status: 401 }));
  const auth = checked(await run('web_search', { query: 'q' }), 'search');
  assert.ok(auth.error);
  assert.equal(auth.error.code, 'authentication');
  assert.doesNotMatch(auth.error.message, /offline-perplexity-key/);
  assert.match(auth.error.message, /\[REDACTED\]/);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const malformed = checked(await run('web_search', { query: 'q' }), 'search');
  assert.equal(malformed.error?.code, 'invalid_response');
  const retriever = createPerplexity(settings().perplexity);
  retriever.search = async () => { throw new Error('secret-internal-token'); };
  const unexpected = await harness(settings(), retriever).run('web_search', { query: 'q' });
  assert.equal(checked(unexpected, 'search').error?.code, 'retrieval_failed');
  assert.doesNotMatch(JSON.stringify(unexpected), /secret-internal-token/);
  retriever.search = async () => { throw new WebToolsError('configuration', 'Invalid local setting'); };
  assert.equal((await harness(settings(), retriever).run('web_search', { query: 'q' })).structuredContent.error?.code, 'configuration');
});

test('mid-body cancellation preserves its classification and normalized input', async t => {
  const controller = new AbortController();
  mockFetch(t, async (_url, init) => {
    const response = Response.json({});
    t.mock.method(response, 'text', async () => {
      controller.abort(new Error('private-abort-reason'));
      init.signal.throwIfAborted();
      return '';
    });
    return response;
  });
  const output = await harness().run('web_fetch', { url: 'HTTPS://EXAMPLE.COM:443/article' }, controller.signal);
  const result = checked(output, 'fetch');
  assert.equal(result.url, url);
  assert.equal(result.error?.code, 'cancelled');
  assert.equal(result.error?.message, 'Perplexity request cancelled.');
  assert.doesNotMatch(JSON.stringify(output), /private-abort-reason/);
});

test('missing API key fails before any network request', async () => {
  delete process.env.WEB_TOOLS_TEST_PERPLEXITY_KEY;
  const { run } = harness();
  for (const [name, args, operation] of [['web_search', { query: 'q' }, 'search'], ['web_fetch', { url }, 'fetch']] as const) {
    const result = checked(await run(name, args), operation);
    assert.ok(result.error);
    assert.equal(result.error.code, 'authentication');
    assert.match(result.error.message, /WEB_TOOLS_TEST_PERPLEXITY_KEY/);
  }
  assert.equal(networkCalls, 0);
});

test('both output limits write private full Markdown while structured data remains untruncated', async t => {
  const longExcerpt = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'évidence '.repeat(20)}`).join('\n');
  mockRequests(t, request => fixture(request.operation, [source(url, longExcerpt)]));
  for (const output of [{ maxLines: 12, maxBytes: 100_000 }, { maxLines: 10_000, maxBytes: 300 }]) {
    const value = settings(); value.output = output;
    const response = await harness(value).run('web_fetch', { url });
    const result = checked(response, 'fetch');
    assert.equal(result.content, longExcerpt);
    assert.equal(result.sources[0].snippet, longExcerpt);
    assert.equal(result.report, notes);
    const path = result.full_output_path;
    assert.ok(typeof path === 'string');
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

test('renderers cover success, not_found, errors, missing details, and progress', async t => {
  let sources = [source()];
  mockRequests(t, request => fixture(request.operation, sources));
  const { run, getTool } = harness();
  const success = await run('web_search', { query: 'render query' });
  assert.match(rendered(success), /1 result\(s\)/);
  assert.doesNotMatch(rendered(success), /Test page/);
  const expanded = rendered(success, true);
  for (const text of ['render query', 'Test page', url, 'Evidence: direct_response', 'API cost: $0.012300']) assert.ok(expanded.includes(text));
  const page = await run('web_fetch', { url });
  assert.match(rendered(page), /Retrieved Test page/);
  assert.match(rendered(page, true), /Model: agent-model/);
  sources = [source(url, '')];
  assert.match(rendered(await run('web_fetch', { url })), /No relevant content found/);
  sources = [source('https://example.com/other')];
  const failed = await run('web_fetch', { url });
  assert.match(rendered(failed), /Web retrieval failed/);
  assert.ok(rendered(failed, true).includes(notes));
  assert.match(rendered({}), /Web retrieval failed/);
  assert.match(rendered({ details: { operation: 'fetch' } }, false, true), /Fetching with Perplexity/);
  assert.match(rendered({}, false, true), /Searching with Perplexity/);
  assert.match(renderCall('fetch', url, theme).render(200).join(''), /web_fetch https:\/\/example.com\/article/);
  const callRenderer = getTool('web_search').renderCall;
  assert.ok(callRenderer);
  assert.match(callRenderer({ query: 'hello' }, theme, {} as Parameters<typeof callRenderer>[2]).render(200).join(''), /web_search "hello"/);
});

test('invalid shared defaults fail validation at load', () => {
  validateConfig(config);
  const mutations: ((value: WebToolsConfig) => void)[] = [value => { value.output.maxLines = 0; }, value => { value.output.maxBytes = -1; },
    value => { value.search.maxResults = 21; }, value => { value.search.maxResults = 2.5; },
    value => { Object.assign(value.search, { contextSize: 'huge' }); }, value => { value.fetch.defaultObjective = ' '; },
    value => { Object.assign(value.search, { maxResults: undefined }); },
    value => { Object.assign(value.search, { contextSize: undefined }); }];
  for (const mutate of mutations) {
    const value = settings(); mutate(value);
    assert.throws(() => validateConfig(value), error => error instanceof WebToolsError && error.code === 'configuration');
  }
});
