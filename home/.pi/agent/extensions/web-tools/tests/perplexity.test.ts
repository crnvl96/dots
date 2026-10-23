import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { jsonObject, mockFetch } from './helpers.ts';
import { config, validateConfig } from '../config.ts';
import { createPerplexity, parseFetch, parseSearch, toUsage } from '../perplexity.ts';

const searchInput = { query: 'pi release', max_results: 8, search_context_size: 'medium' as const };
const fetchInput = { url: 'https://example.com/', objective: 'Extract main content.' };
function fixture(t: TestContext) {
  const settings = structuredClone(config.perplexity);
  settings.apiKeyEnv = 'WEB_TEST_PERPLEXITY_KEY';
  settings.baseUrlEnv = 'WEB_TEST_PERPLEXITY_BASE';
  const previous = process.env[settings.apiKeyEnv];
  const previousBase = process.env[settings.baseUrlEnv];
  process.env[settings.apiKeyEnv] = ' test-secret ';
  delete process.env[settings.baseUrlEnv];
  t.after(() => {
    if (previous === undefined) delete process.env[settings.apiKeyEnv]; else process.env[settings.apiKeyEnv] = previous;
    if (previousBase === undefined) delete process.env[settings.baseUrlEnv]; else process.env[settings.baseUrlEnv] = previousBase;
  });
  return settings;
}
function pagePayload(snippet = 'Provider page excerpt.') {
  return { id: 'fetch-id', model: 'agent-model', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, cost: { total_cost: 0.02 } }, output: [
    { type: 'fetch_url_results', contents: [{ url: fetchInput.url, title: 'Example', snippet }] },
    { type: 'message', content: [{ type: 'output_text', text: 'Separate model notes.' }] },
  ] };
}
test('search uses direct API, configurable base/key, forwards controls, and sends no conversation', async t => {
  const settings = fixture(t);
  process.env[settings.baseUrlEnv] = ' https://proxy.example/v1/// ';
  const provider = createPerplexity(settings);
  let count = 0;
  mockFetch(t, async (url, init) => {
    count++;
    assert.equal(url, 'https://proxy.example/v1/search');
    assert.deepEqual(init.headers, { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), { query: searchInput.query, max_results: 3, search_context_size: 'high', search_recency_filter: 'month' });
    return Response.json({ id: 'search-id', results: [{ title: 'Result', url: 'https://example.com', snippet: 'Source excerpt', date: '2026-01-01' }] });
  });
  const output = await provider.search({ ...searchInput, max_results: 3, search_context_size: 'high', recency: 'month' });
  assert.equal(count, 1);
  assert.equal(output.result.report, null);
  assert.equal(output.result.metadata.retrieval_evidence, 'direct_response');
  assert.equal(output.result.metadata.result_order, 'ranked');
  assert.equal(output.result.metadata.model, null);
  assert.equal(output.result.metadata.cost_usd, null);
  assert.equal(output.result.results[0].date, '2026-01-01');
  assert.equal(output.result.results[0].url, 'https://example.com/');
  assert.equal(output.usage, undefined);
});
test('fetch request isolates inputs, only exposes fetch_url and obeys config', async t => {
  const settings = fixture(t);
  settings.fetch.preset = 'custom-preset';
  settings.fetch.maxSteps = 3;
  settings.fetch.maxOutputTokens = 400;
  const provider = createPerplexity(settings);
  mockFetch(t, async (url, init) => {
    assert.equal(url, 'https://api.perplexity.ai/v1/agent');
    const body = jsonObject(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'max_output_tokens', 'max_steps', 'preset', 'store', 'tools']);
    assert.equal(body.preset, 'custom-preset');
    assert.equal(body.max_steps, 3);
    assert.equal(body.max_output_tokens, 400);
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, [{ type: 'fetch_url', max_urls: 1 }]);
    assert.ok(typeof body.input === 'string');
    assert.ok(typeof body.instructions === 'string');
    assert.match(body.input, /https:\/\/example.com\//);
    assert.match(body.input, /Extract main content/);
    assert.match(body.instructions, /untrusted data/);
    return Response.json(pagePayload());
  });
  const output = await provider.fetch(fetchInput);
  assert.equal(output.result.status, 'ok');
  assert.equal(output.result.content, 'Provider page excerpt.');
  assert.equal(output.result.report, 'Separate model notes.');
  assert.equal(output.result.metadata.retrieval_evidence, 'tool_result');
  assert.equal(output.usage?.totalTokens, 15);
  assert.equal(output.usage?.cost.total, 0.02);
});
test('missing and whitespace credentials fail before network', async t => {
  const settings = fixture(t);
  const provider = createPerplexity(settings);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected'); });
  for (const key of ['', '   ']) {
    process.env[settings.apiKeyEnv] = key;
    await assert.rejects(provider.search(searchInput), { code: 'authentication' });
    await assert.rejects(provider.fetch(fetchInput), { code: 'authentication' });
  }
  assert.equal(calls, 0);
});
test('invalid Perplexity settings and API roots are configuration errors at load', t => {
  const settings = fixture(t);
  for (const mutate of [(s: typeof settings) => { s.timeoutMs = 0; }, (s: typeof settings) => { s.fetch.maxSteps = 1.5; },
    (s: typeof settings) => { s.fetch.maxOutputTokens = -1; }, (s: typeof settings) => { s.fetch.preset = ' '; }]) {
    const value = structuredClone(config);
    mutate(value.perplexity);
    assert.throws(() => validateConfig(value), { code: 'configuration' });
  }
  for (const root of ['not a url', 'ftp://example.com', 'https://user:pass@example.com']) {
    process.env[settings.baseUrlEnv] = root;
    assert.throws(() => createPerplexity(settings), { code: 'configuration' });
  }
  process.env[settings.baseUrlEnv] = '';
  assert.throws(() => createPerplexity({ ...settings, baseUrl: 'invalid' }), { code: 'configuration' });
});
test('blank base override uses configured base URL', async t => {
  const settings = fixture(t);
  process.env[settings.baseUrlEnv] = '   ';
  const provider = createPerplexity(settings);
  mockFetch(t, async url => {
    assert.equal(url, 'https://api.perplexity.ai/search');
    return Response.json({ results: [] });
  });
  assert.equal((await provider.search(searchInput)).result.status, 'not_found');
});
test('search rejects malformed payload, filters malformed sources, preserves empty excerpts and dates', () => {
  for (const payload of [{}, { results: null }, { results: [null, { url: 'invalid', snippet: '' }] }]) {
    assert.throws(() => parseSearch(searchInput, payload), { code: 'invalid_response' });
  }
  const result = parseSearch(searchInput, { results: [null, { url: 'https://example.com', title: '', snippet: '', date: 1, last_updated: 'today' }] });
  assert.equal(result.status, 'ok');
  assert.equal(result.results[0].snippet, '');
  assert.equal(result.results[0].title, 'https://example.com/');
  assert.equal(result.results[0].date, null);
  assert.equal(result.results[0].last_updated, 'today');
  assert.equal(result.warnings.length, 1);
});
test('notes alone are kept as reports but cannot establish retrieval', () => {
  const result = parseFetch(fetchInput, { output: [{ type: 'message', content: [{ type: 'output_text', text: 'I fetched the page.' }] }] });
  assert.equal(result.status, 'error');
  assert.equal(result.error?.code, 'retrieval_failed');
  assert.equal(result.content, null);
  assert.equal(result.report, 'I fetched the page.');
  assert.equal(result.metadata.retrieval_evidence, 'none');
});
test('fetch looks past unrelated first source, normalizes URLs and never assumes redirects', () => {
  const payload = pagePayload();
  payload.output[0].contents!.unshift({ url: 'https://elsewhere.example/', title: 'Unrelated', snippet: 'Wrong page' });
  payload.output[0].contents![1].url = 'https://EXAMPLE.com:443';
  const result = parseFetch(fetchInput, payload);
  assert.equal(result.sources.length, 2);
  assert.equal(result.source_url, fetchInput.url);
  assert.equal(result.content, 'Provider page excerpt.');
  const unrelated = parseFetch({ ...fetchInput, url: 'https://redirect.example/' }, payload);
  assert.equal(unrelated.status, 'error');
  assert.equal(unrelated.content, null);
  assert.equal(unrelated.source_url, null);
  assert.equal(unrelated.sources.length, 2);
});
test('empty fetched snippet is not_found, not invented from model notes', () => {
  for (const snippet of ['', '   \n']) {
    const result = parseFetch(fetchInput, pagePayload(snippet));
    assert.equal(result.status, 'not_found');
    assert.equal(result.content, snippet);
    assert.equal(result.report, 'Separate model notes.');
  }
});
for (const status of ['failed', 'in_progress', 'incomplete', 'queued', 'unknown']) {
  test(`fetch status ${status} is an error even with an excerpt`, () => {
    assert.equal(parseFetch(fetchInput, { ...pagePayload(), status }).status, 'error');
  });
}
test('missing final status needs tool-result evidence; malformed output is not successful', () => {
  const { status: _status, ...payload } = pagePayload();
  assert.equal(parseFetch(fetchInput, payload).status, 'ok');
  for (const output of [undefined, [], [null], [{ type: 'fetch_url_results', contents: [{ url: 'file:///secret', snippet: 'bad' }] }]]) {
    assert.equal(parseFetch(fetchInput, { output }).status, 'error');
  }
});
test('usage keeps provider total and does not fabricate unknown metadata', () => {
  assert.equal(toUsage({}), undefined);
  assert.equal(toUsage({ usage: { cost: { total_cost: -1 } } }), undefined);
  assert.equal(toUsage({ usage: { cost: { total_cost: 0 } } })?.cost.total, 0);
  assert.equal(toUsage({ usage: { prompt_tokens: 10, completion_tokens: 4 } })?.totalTokens, 14);
});
