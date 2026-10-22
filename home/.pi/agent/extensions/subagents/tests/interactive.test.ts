import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences } from '@earendil-works/pi-tui';
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

test('clicking a child focuses a live editor, and Enter sends the typed message', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-subagents-type-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  initTheme('dark', false);
  const tools = new Map();
  const widgets = new Map();
  const requests = [];
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  const kb = new KeybindingsManager(TUI_KEYBINDINGS);
  const tui = { terminal: { rows: 32, columns: 100 }, requestRender() {} };
  const dialogs = [];
  const ui = {
    theme,
    setWidget(name, factory) { if (factory) widgets.set(name, factory(tui, theme)); else widgets.delete(name); },
    notify() {},
    custom(factory) {
      return new Promise((resolve) => {
        const done = () => resolve();
        const component = factory(tui, theme, kb, done);
        component.focused = true;
        dialogs.push(component);
      });
    },
  };
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on() {},
    getThinkingLevel: () => 'low',
    getSettings: () => ({ retry: { enabled: false }, cacheWarming: 'off' }),
    sendMessage() {},
  };
  extension(pi);
  const ctx = {
    mode: 'tui', hasUI: true, cwd: directory, agentDir: directory, model, thinkingLevel: 'medium',
    isProjectTrusted: () => true, ui, tools: [],
    modelRegistry: {
      find: () => model,
      streamSimple(selected, context, options) {
        const stream = createAssistantMessageEventStream();
        const request = { context, finish(text = 'done') {
          stream.push({ type: 'done', reason: 'stop', message: {
            role: 'assistant', content: [{ type: 'text', text }], api: selected.api, provider: selected.provider, model: selected.id,
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop', timestamp: Date.now(),
          } });
          stream.end();
        } };
        options?.signal?.addEventListener('abort', () => request.finish(''), { once: true });
        requests.push(request);
        return stream;
      },
    },
  };
  await tools.get('subagents_launch').execute('call', { tasks: [{ name: 'review-parser', prompt: 'Inspect the parser' }] }, undefined, undefined, ctx);
  await until(() => requests.length === 1);
  const widget = widgets.get('subagents.pi');
  const rendered = widget.render(80);
  widget.handleMouse({ type: 'click', button: 'left', x: 1, y: 0, screenX: 1, screenY: 0, width: 80, height: rendered.length, shift: false, alt: false, ctrl: false });
  await until(() => dialogs.length === 1);
  const panel = dialogs[0];
  panel.handleInput('\r');
  const raw = panel.render(80).join('\n');
  assert.match(stripTerminalSequences(raw), /Enter send/);
  assert.match(raw, /\x1b_pi:c\x07/);
  panel.handleInput('look at empty input');
  panel.handleInput('\r');
  requests[0].finish('first');
  await until(() => requests.length === 2);
  const followUp = requests[1].context.messages.filter((message) => message.role === 'user').map((message) => (
    typeof message.content === 'string' ? message.content : message.content.map((part) => part.text ?? '').join('\n')
  )).join('\n');
  assert.match(followUp, /look at empty input/);
  requests[1].finish('second');
});
