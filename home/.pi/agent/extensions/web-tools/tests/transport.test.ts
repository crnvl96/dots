import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebToolsError } from '../contracts.ts';
import { mockFetch } from './helpers.ts';
import { normalizeUrl, postJson } from '../transport.ts';

const options = { url: 'https://api.example.com/', body: { query: 'test' }, apiKey: 'secret-key', timeoutMs: 1_000, provider: 'Test' };
test('transport sends one JSON request, blocks redirects and does not retry', async t => {
  let calls = 0;
  mockFetch(t, async (url, init) => {
    calls++;
    assert.equal(url, options.url);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Authorization: 'Bearer secret-key', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init.body), options.body);
    return Response.json({ message: 'try again' }, { status: 503 });
  });
  await assert.rejects(postJson(options), { code: 'http_error' });
  assert.equal(calls, 1);
});
test('structured errors redact credentials and raw HTML bodies are not echoed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Invalid secret-key' } }, { status: 401 }));
  await assert.rejects(postJson(options), error => {
    assert.ok(error instanceof WebToolsError);
    assert.equal(error.code, 'authentication');
    assert.match(error.message, /\[REDACTED\]/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>secret-key private failure</html>', { status: 502 }));
  await assert.rejects(postJson(options), error => {
    assert.ok(error instanceof WebToolsError);
    assert.equal(error.code, 'http_error');
    assert.doesNotMatch(error.message, /secret-key|private failure/);
    return true;
  });
});
test('transport errors never echo arbitrary headers or exception content', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Authorization: secret-key'); });
  await assert.rejects(postJson(options), { code: 'http_error', message: 'Test network request failed.' });
});
test('malformed successful JSON or nonobject response is invalid_response', async t => {
  for (const value of ['bad JSON', 'null', '[]', '42', '"text"']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(value));
    await assert.rejects(postJson(options), { code: 'invalid_response' });
  }
});
test('pre-cancellation stops before fetch, mid-body cancellation is classified', async t => {
  let calls = 0;
  const pre = new AbortController();
  pre.abort(new Error('sensitive reason'));
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
  await assert.rejects(postJson({ ...options, signal: pre.signal }), { code: 'cancelled' });
  assert.equal(calls, 0);
  const mid = new AbortController();
  mockFetch(t, async (_url, init) => {
    const response = Response.json({});
    t.mock.method(response, 'text', async () => { mid.abort(); init.signal.throwIfAborted(); return ''; });
    return response;
  });
  await assert.rejects(postJson({ ...options, signal: mid.signal }), { code: 'cancelled' });
});
test('timeout covers response-body consumption, not just headers', async t => {
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  mockFetch(t, async (_url, init) => {
    const response = Response.json({});
    t.mock.method(response, 'text', async () => { timeout.abort(); init.signal.throwIfAborted(); return ''; });
    return response;
  });
  await assert.rejects(postJson(options), { code: 'timeout' });
});
test('URL validation canonicalizes HTTP(S), rejects credentials and other protocols', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com:443/a/../b?q=hello world#h'), 'https://example.com/b?q=hello%20world#h');
  for (const url of ['invalid', '/relative', 'file:///tmp/page', 'ftp://example.com/', 'https://user:password@example.com/']) {
    assert.throws(() => normalizeUrl(url), { code: 'invalid_input' });
  }
});
