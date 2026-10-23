import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

// Node's mock.method does not contextually type fetch replacements. Keep that
// boundary here, and assert the POST request shape before inspecting its body.
export function mockFetch(t: TestContext, respond: (url: Parameters<typeof fetch>[0], init: RequestInit & { body: string; signal: AbortSignal }) => Promise<Response>) {
  return t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.ok(init);
    assert.ok(typeof init.body === 'string');
    assert.ok(init.signal instanceof AbortSignal);
    return respond(url, { ...init, body: init.body, signal: init.signal });
  });
}

export function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
