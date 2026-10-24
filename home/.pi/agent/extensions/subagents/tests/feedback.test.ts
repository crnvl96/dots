import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import extension from '../index.ts';
import { askDescription, childPromptAppendix, launchGuidelines } from '../prompts.ts';

const model = {
  id: 'parent-model',
  provider: 'parent-provider',
  api: 'openai-completions',
  name: 'Parent',
  reasoning: true,
  input: ['text'],
  contextWindow: 100_000,
  maxTokens: 8192,
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

test('ask notifies immediately; a blocked child finishes and the answer starts a fresh task', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-subagents-ask-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tools = new Map();
  const notifications = [];
  const requests = [];
  const events = new Map();
  const pi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    on(name, handler) {
      events.set(name, handler);
    },
    getThinkingLevel: () => 'low',
    getSettings: () => ({ retry: { enabled: false }, cacheWarming: 'off' }),
    sendMessage(message, options) {
      notifications.push({ message, options });
    },
  };
  extension(pi);
  const ctx = {
    mode: 'print',
    cwd: directory,
    agentDir: directory,
    model,
    thinkingLevel: 'medium',
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
              role: 'assistant',
              content: [{ type: 'text', text }],
              api: selected.api,
              provider: selected.provider,
              model: selected.id,
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason,
              timestamp: Date.now(),
              ...extra,
            };
            stream.push({ type: 'done', reason: stopReason, message });
            stream.end();
          },
        };
        options?.signal?.addEventListener('abort', () => request.finish('', 'aborted'), {
          once: true,
        });
        requests.push(request);
        return stream;
      },
    },
  };
  t.after(() => events.get('session_shutdown')());
  const call = (name, params) => tools.get(name).execute('call', params, undefined, undefined, ctx);
  const launched = tools
    .get('subagents_launch')
    .execute(
      'call',
      { tasks: [{ name: 'review-parser', prompt: 'Find the gap' }] },
      undefined,
      undefined,
      ctx,
    );
  await until(() => requests.length === 1);
  requests[0].finish('', 'toolUse', {
    content: [
      {
        type: 'toolCall',
        id: 'ask-1',
        name: 'subagents_ask',
        arguments: { message: 'The parser has no test for empty input.', kind: 'decision' },
      },
    ],
  });
  await until(() => notifications.some((item) => item.message.details?.feedback));
  const ask = notifications.find((item) => item.message.details.feedback);
  assert.equal(ask.options.deliverAs, 'steer');
  assert.equal(ask.options.triggerTurn, true);
  assert.match(ask.message.content, /review-parser/);
  assert.match(ask.message.content, /empty input/);
  assert.match(ask.message.content, /Steer review-parser/);
  assert.match(ask.message.content, /only while it is running/);
  assert.match(ask.message.content, /launch a fresh task/);
  await until(() => requests.length === 2);
  requests[1].finish('Blocked: I need your decision about empty input.');
  await launched;
  await call('subagents_wait', { ids: ['review-parser'] });
  const late = await call('subagents_steer', {
    id: 'review-parser',
    prompt: 'Reject empty input.',
  });
  assert.equal(late.structuredContent.accepted, false);
  assert.equal(late.structuredContent.agent.status, 'completed');
  assert.equal(requests.length, 2, 'A finished child is not resumed.');
  await call('subagents_launch', {
    tasks: [
      {
        name: 'fix-parser',
        prompt: 'The review found no empty-input test. Decision: reject empty input.',
        tools: [],
      },
    ],
  });
  await until(() => requests.length === 3);
  requests[2].finish('Added the missing test.');
  const result = await call('subagents_wait', { ids: ['fix-parser'] });
  assert.match(result.structuredContent.agents[0].result, /Added the missing test/);
});

test('ask instructions explain completion rather than promising pause and resume', () => {
  for (const instructions of [askDescription, childPromptAppendix]) {
    assert.match(instructions, /finishes.*task/);
    assert.match(instructions, /fresh task with the answer/);
    assert.doesNotMatch(instructions, /Guidance arrives|guidance arrives/);
  }
  assert.match(launchGuidelines.join('\n'), /Finished children cannot resume/);
});
