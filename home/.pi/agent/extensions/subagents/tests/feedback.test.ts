import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import extension from '../index.ts';

const model = {
  id: 'parent-model', provider: 'parent-provider', api: 'openai-completions', name: 'Parent',
  reasoning: true, input: ['text'], contextWindow: 100_000, maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function until(predicate) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail('Expected asynchronous condition was not reached');
}

test('a child ask reaches the parent immediately, before the child finishes', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-subagents-ask-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tools = new Map();
  const notifications = [];
  const requests = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on() {},
    getThinkingLevel: () => 'low',
    getSettings: () => ({ retry: { enabled: false }, cacheWarming: 'off' }),
    sendMessage(message, options) { notifications.push({ message, options }); },
  };
  extension(pi);
  const ctx = {
    mode: 'print', cwd: directory, agentDir: directory, model, thinkingLevel: 'medium',
    isProjectTrusted: () => true,
    ui: { theme: {}, setWidget() {}, notify() {} },
    tools: [],
    modelRegistry: {
      find: () => model,
      streamSimple(selected, _context, options) {
        const stream = createAssistantMessageEventStream();
        const request = {
          finish(text, stopReason = 'stop', extra = {}) {
            const message = {
              role: 'assistant', content: [{ type: 'text', text }],
              api: selected.api, provider: selected.provider, model: selected.id,
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason, timestamp: Date.now(), ...extra,
            };
            stream.push({ type: 'done', reason: stopReason, message });
            stream.end();
          },
        };
        options?.signal?.addEventListener('abort', () => request.finish('', 'aborted'), { once: true });
        requests.push(request);
        return stream;
      },
    },
  };
  t.after(() => pi.on && undefined);
  const launched = tools.get('subagents_launch').execute('call', { tasks: [{ name: 'review-parser', prompt: 'Find the gap' }] }, undefined, undefined, ctx);
  await until(() => requests.length === 1);
  requests[0].finish('', 'toolUse', {
    content: [{ type: 'toolCall', id: 'ask-1', name: 'subagents_ask', arguments: { message: 'The parser has no test for empty input.', kind: 'decision' } }],
  });
  await until(() => notifications.some((item) => item.message.details?.feedback));
  const ask = notifications.find((item) => item.message.details.feedback);
  assert.equal(ask.options.deliverAs, 'steer');
  assert.equal(ask.options.triggerTurn, true);
  assert.match(ask.message.content, /review-parser/);
  assert.match(ask.message.content, /empty input/);
  assert.match(ask.message.content, /Steer review-parser/);
  requests[0].finish('done');
  await launched;
});
