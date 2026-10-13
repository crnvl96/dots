import assert from 'node:assert/strict';
import test from 'node:test';

import { describeApiError, postJson } from './client.ts';

const ENV_KEYS = ['PERPLEXITY_API_KEY', 'PERPLEXITY_API_BASE_URL'];

function isolateEnvironment(t, overrides = {}) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  for (const key of ENV_KEYS) {
    if (Object.hasOwn(overrides, key)) process.env[key] = overrides[key];
    else delete process.env[key];
  }
}

function jsonResponse(payload, status = 200, statusText = 'OK') {
  return new Response(JSON.stringify(payload), { status, statusText });
}

test('postJson falls back to the default URL, trims the key, sends JSON headers/body, and sets the timeout signal', async (t) => {
  isolateEnvironment(t, {
    PERPLEXITY_API_KEY: '  test-key  ',
    PERPLEXITY_API_BASE_URL: '  \t ',
  });

  const originalTimeout = AbortSignal.timeout;
  let timeoutMs;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeoutMs = milliseconds;
    return originalTimeout(milliseconds);
  });

  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url, init };
    return jsonResponse({ ok: true });
  });

  assert.deepEqual(await postJson('/v1/search', { query: 'pi' }), { ok: true });
  assert.equal(request.url, 'https://api.perplexity.ai/v1/search');
  assert.equal(request.init.method, 'POST');
  assert.deepEqual({ ...request.init.headers }, {
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  });
  assert.equal(request.init.body, JSON.stringify({ query: 'pi' }));
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(timeoutMs, 60_000);
});

test('postJson trims a configured base URL and API key', async (t) => {
  isolateEnvironment(t, {
    PERPLEXITY_API_KEY: '\tmy-secret\n',
    PERPLEXITY_API_BASE_URL: '  https://proxy.example/api///  ',
  });

  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url, init };
    return jsonResponse({});
  });

  await postJson('/chat/completions', { model: 'test-model' });
  assert.equal(request.url, 'https://proxy.example/api/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer my-secret');
});

test('postJson rejects missing or whitespace-only API keys before fetching', async (t) => {
  isolateEnvironment(t);
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls++;
    return jsonResponse({});
  });

  for (const apiKey of [undefined, '   \t']) {
    if (apiKey === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = apiKey;

    await assert.rejects(
      postJson('/endpoint', {}),
      /PERPLEXITY_API_KEY is not set\. Export it in the environment that starts pi, then restart pi\./,
    );
    assert.equal(fetchCalls, 0);
  }
});

test('postJson combines the caller signal with its timeout and passes cancellation through', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  const controller = new AbortController();
  const abortReason = new DOMException('cancelled by caller', 'AbortError');
  let requestSignal;

  t.mock.method(globalThis, 'fetch', (_url, init) => {
    requestSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  });

  const pending = postJson('/endpoint', {}, controller.signal);
  assert.ok(requestSignal instanceof AbortSignal);
  assert.notEqual(requestSignal, controller.signal);
  assert.equal(requestSignal.aborted, false);
  controller.abort(abortReason);

  await assert.rejects(pending, (error) => error === abortReason);
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason, abortReason);
});

test('postJson translates timeout errors but preserves other fetch errors', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  const timeoutError = new Error('internal timeout');
  timeoutError.name = 'TimeoutError';
  const abortError = new DOMException('aborted', 'AbortError');
  let fetchFailure = timeoutError;
  t.mock.method(globalThis, 'fetch', async () => {
    throw fetchFailure;
  });

  await assert.rejects(postJson('/endpoint', {}), {
    name: 'Error',
    message: 'Perplexity request timed out after 60 seconds.',
  });

  fetchFailure = abortError;
  await assert.rejects(postJson('/endpoint', {}), (error) => error === abortError);
});

test('describeApiError selects error fields in priority order', () => {
  const fallback = 'fallback';
  assert.equal(describeApiError({ error: 'top-level error', message: 'message', detail: 'detail' }, fallback), 'top-level error');
  assert.equal(describeApiError({ error: { message: 'nested error' }, message: 'message' }, fallback), 'nested error');
  assert.equal(describeApiError({ message: 'message', detail: 'detail' }, fallback), 'message');
  assert.equal(describeApiError({ detail: 'detail' }, fallback), 'detail');
  assert.equal(describeApiError({ detail: [{ msg: 'first' }, null, { message: 'ignored' }, { msg: '' }, { msg: 'second' }] }, fallback), 'first; second');
  assert.equal(describeApiError({ detail: [{ message: 'ignored' }, 4] }, fallback), fallback);
  assert.equal(describeApiError(['not', 'a record'], fallback), fallback);
});

test('postJson reports API error details from structured error payloads', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({
    error: { message: 'permission denied' },
    message: 'less specific message',
  }, 403, 'Forbidden'));

  await assert.rejects(postJson('/endpoint', {}), {
    message: 'Perplexity API error 403: permission denied',
  });
});

test('postJson uses trimmed raw text for malformed error JSON', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async () => new Response('  not-json  ', { status: 502, statusText: 'Bad Gateway' }));

  await assert.rejects(postJson('/endpoint', {}), {
    message: 'Perplexity API error 502: not-json',
  });
});

test('postJson truncates raw API errors and falls back to Unknown API error', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  let response = new Response('x'.repeat(1_100), { status: 501, statusText: '' });
  t.mock.method(globalThis, 'fetch', async () => response);

  await assert.rejects(postJson('/endpoint', {}), (error) => (
    error.message === `Perplexity API error 501: ${'x'.repeat(1_000)}`
  ));

  response = new Response(null, { status: 502, statusText: '' });
  await assert.rejects(postJson('/endpoint', {}), {
    message: 'Perplexity API error 502: Unknown API error',
  });
});

test('postJson accepts an empty successful response as an empty object', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204, statusText: 'No Content' }));

  assert.deepEqual(await postJson('/endpoint', {}), {});
});

test('postJson uses status text when an error response is empty', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503, statusText: 'Unavailable' }));

  await assert.rejects(postJson('/endpoint', {}), {
    message: 'Perplexity API error 503: Unavailable',
  });
});

test('postJson rejects malformed successful JSON', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken', { status: 200 }));

  await assert.rejects(postJson('/endpoint', {}), {
    message: 'Perplexity returned an invalid JSON response.',
  });
});

test('postJson rejects successful JSON values that are not records', async (t) => {
  isolateEnvironment(t, { PERPLEXITY_API_KEY: 'test-key' });
  let value;
  t.mock.method(globalThis, 'fetch', async () => jsonResponse(value));
  for (value of [null, [], 'text', 12, true]) {
    await assert.rejects(postJson('/endpoint', {}), {
      message: 'Perplexity returned an invalid JSON response.',
    });
  }
});
