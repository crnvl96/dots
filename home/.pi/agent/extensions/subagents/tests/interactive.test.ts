import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWidth } from '@earendil-works/pi-tui';
import { SubagentMenu } from '../menu.ts';

const plainTheme = { fg: (_color, text) => text, bold: (text) => text };

function harness(t, count = 2) {
  const jobs = Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    status: 'running',
    activity: 'Thinking',
    startedAt: Date.now(),
    prompt: 'Private assignment',
  }));
  const observers = new Set();
  let renders = 0;
  const tui = {
    terminal: { rows: 32, columns: 100 },
    requestRender() {
      renders++;
    },
  };
  const ctx = {
    ui: {
      theme: plainTheme,
      onTerminalInput() {
        assert.fail('A read-only widget must never subscribe to input');
      },
    },
  };
  const refresh = () => {
    for (const observer of observers) observer();
  };
  const menu = new SubagentMenu(tui, ctx, {
    jobs: () => jobs,
    subscribe(listener) {
      observers.add(listener);
      return () => observers.delete(listener);
    },
  });
  t.after(() => menu.dispose());
  return {
    jobs,
    menu,
    ctx,
    tui,
    observers,
    refresh,
    screen: (width = 100) => menu.render(width).join('\n'),
    get renders() {
      return renders;
    },
  };
}

test('read-only widget has no input, mouse or selection controls', (t) => {
  const h = harness(t);
  assert.match(h.screen(), /task-1/);
  assert.match(h.screen(), /task-2/);
  assert.equal(h.menu.handleInput, undefined);
  assert.equal(h.menu.handleMouse, undefined);
  assert.doesNotMatch(
    h.screen(),
    /Ctrl\+X|↑|↓|select|›|AGENT|STATUS|DOING NOW|TIME|│|Private assignment/,
  );
  assert.deepEqual(
    h.jobs.map((job) => job.status),
    ['running', 'running'],
  );
});

test('completion updates visible rows and an empty widget hides automatically', (t) => {
  const h = harness(t);
  h.jobs[0].status = 'completed';
  h.refresh();
  assert.doesNotMatch(h.screen(), /task-1/);
  assert.match(h.screen(), /task-2/);
  h.jobs[1].status = 'failed';
  h.refresh();
  assert.equal(h.screen(), '');
  h.jobs.push({ id: 'fresh-job', status: 'running', activity: 'Starting', startedAt: Date.now() });
  h.refresh();
  assert.match(h.screen(), /fresh-job/);
});

test('overflow is explicit without navigation and newly available rows reveal hidden agents', (t) => {
  const h = harness(t, 12);
  assert.ok(h.menu.render(100).length <= 8);
  assert.match(h.screen(), /\+6 more active/);
  for (const job of h.jobs.slice(0, 6)) job.status = 'completed';
  h.refresh();
  assert.match(h.screen(), /task-12/);
  assert.doesNotMatch(h.screen(), /more active/);
});

test('long activity automatically expands beneath its row without selection', (t) => {
  const h = harness(t, 1);
  h.jobs[0].activity =
    'Running npm test -- --runInBand --testPathPattern=extensions/subagents/tests/runtime.test.ts';
  const screen = h.screen(80);
  assert.match(screen, /↳ Running npm test/);
  assert.match(screen, /runtime.test.ts/);
  assert.ok(h.menu.render(80).length <= 8);
  h.jobs[0].activity = 'Thinking';
  h.refresh();
  assert.doesNotMatch(h.screen(), /↳/);
});

test('narrow and short terminals clip safely, and rendering follows the current theme', (t) => {
  const h = harness(t, 8);
  h.jobs[0].activity = 'Reading 界面 👩‍💻\nfiles';
  h.jobs[1].id = 'a-very-long-subagent-name-for-a-narrow-terminal';
  for (const height of [1, 3, 8, 24]) {
    h.tui.terminal.rows = height;
    for (const width of [0, 1, 2, 10, 30, 80]) {
      const lines = h.menu.render(width);
      assert.ok(lines.length <= height);
      for (const line of lines) {
        assert.ok(visibleWidth(line) <= width, `Line exceeded ${width} columns: ${line}`);
        assert.ok(!line.includes('\n'));
      }
    }
  }
  h.ctx.ui.theme = { fg: (color, text) => `${color}:${text}`, bold: (text) => text };
  h.menu.invalidate();
  assert.match(h.screen(), /accent:/);
});

test('disposal is idempotent and removes the runtime subscription', (t) => {
  const h = harness(t);
  assert.equal(h.observers.size, 1);
  h.menu.dispose();
  h.menu.dispose();
  assert.equal(h.observers.size, 0);
  const renders = h.renders;
  h.refresh();
  assert.equal(h.renders, renders);
  assert.equal(h.screen(), '');
});
