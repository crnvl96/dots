import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from '@earendil-works/pi-tui';
import { SubagentMenu } from '../menu.ts';

const up = '\x1b[A';
const down = '\x1b[B';
const stop = '\x18';
const plainTheme = { fg: (_color, text) => text, bold: (text) => text };

function harness(t, count = 2) {
  const jobs = Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`, status: 'running', activity: 'Thinking', startedAt: Date.now(),
    prompt: 'Private assignment',
  }));
  const inputListeners = new Set();
  const observers = new Set();
  const stops = [];
  let focused;
  let overlay = false;
  let renders = 0;
  const tui = {
    terminal: { rows: 32, columns: 100 },
    requestRender() { renders++; },
    getFocusedComponent: () => focused,
    hasOverlay: () => overlay,
  };
  const editor = new CustomEditor(tui, { borderColor: (text) => text }, new KeybindingsManager(TUI_KEYBINDINGS));
  focused = editor;
  const ctx = { ui: {
    theme: plainTheme,
    getEditorText: () => editor.getText(),
    onTerminalInput(listener) {
      inputListeners.add(listener);
      return () => inputListeners.delete(listener);
    },
  } };
  const refresh = () => { for (const observer of observers) observer(); };
  const menu = new SubagentMenu(tui, ctx, {
    jobs: () => jobs,
    stop(job) { stops.push(job.id); job.status = 'stopping'; refresh(); },
    subscribe(listener) { observers.add(listener); return () => observers.delete(listener); },
  });
  t.after(() => menu.dispose());
  const input = (data) => {
    for (const listener of inputListeners) if (listener(data)?.consume) return true;
    return false;
  };
  return {
    jobs, stops, menu, editor, ctx, tui, inputListeners, observers, input, refresh,
    screen: (width = 100) => menu.render(width).join('\n'),
    setFocus: (component) => { focused = component; },
    setOverlay: (value) => { overlay = value; },
    get renders() { return renders; },
  };
}

test('inline arrows select, Ctrl+X stops only that child, and there is no detail or steering UI', (t) => {
  const h = harness(t);
  assert.match(h.screen(), /› task-1/);
  assert.equal(h.input(down), true);
  assert.match(h.screen(), /› task-2/);
  assert.equal(h.input(stop), true);
  assert.deepEqual(h.stops, ['task-2']);
  assert.match(h.screen(), /1 running · 1 stopping/);
  assert.equal(h.input(stop), true);
  assert.deepEqual(h.stops, ['task-2'], 'Repeated stop must not target another child');
  assert.equal(h.input(up), true);
  assert.match(h.screen(), /› task-1/);
  for (const data of ['s', 'x', 'y', '\r', '\x1b', 'guidance', '\x1b[200~pasted text\x1b[201~']) {
    assert.equal(h.input(data), false, 'Only navigation and cancellation are consumed');
  }
  assert.equal(h.menu.handleMouse, undefined);
  assert.doesNotMatch(h.screen(), /Click|Enter|steer|Private assignment/);
});

test('selection stays on the same child when earlier jobs finish or disappear', (t) => {
  const h = harness(t, 5);
  h.input(down);
  h.input(down);
  assert.match(h.screen(), /› task-3/);
  h.jobs[0].status = 'completed';
  h.refresh();
  h.jobs.splice(1, 1);
  h.refresh();
  assert.match(h.screen(), /› task-3/);
  h.jobs.find((job) => job.id === 'task-3').status = 'completed';
  h.refresh();
  assert.match(h.screen(), /› task-4/);
  h.input(stop);
  assert.deepEqual(h.stops, ['task-4']);
});

test('menu hides with no active children and releases the normal arrow/copy bindings', (t) => {
  const h = harness(t);
  h.input(down);
  h.jobs[0].status = 'failed';
  h.jobs[1].status = 'stopped';
  h.refresh();
  assert.equal(h.screen(), '');
  for (const key of [up, down, stop]) assert.equal(h.input(key), false);
  h.jobs.push({ id: 'fresh-job', status: 'running', activity: 'Starting', startedAt: Date.now() });
  h.refresh();
  assert.match(h.screen(), /› fresh-job/);
  h.input(stop);
  assert.deepEqual(h.stops, ['fresh-job']);
});

test('long lists stay bounded and every child is keyboard reachable', (t) => {
  const h = harness(t, 9);
  for (let index = 0; index < h.jobs.length; index++) {
    assert.match(h.screen(), new RegExp(`› task-${index + 1}`));
    assert.ok(h.menu.render(100).length <= 6);
    h.input(down);
  }
  assert.match(h.screen(), /› task-9/);
  assert.match(h.screen(), /9\/9/);
  for (let index = 0; index < 20; index++) h.input(up);
  assert.match(h.screen(), /› task-1/);
});

test('prompt editing, dialogs, overlays, autocomplete and unknown renderers keep their input', (t) => {
  const h = harness(t);
  h.editor.setText('multiline\nprompt');
  assert.equal(h.input(down), false);
  assert.equal(h.input(up), false);
  assert.equal(h.input(stop), true);
  assert.equal(h.editor.getText(), 'multiline\nprompt');
  h.editor.setText('');
  h.setFocus({ handleInput() {} });
  for (const key of [up, down, stop]) assert.equal(h.input(key), false);
  h.setFocus(h.editor);
  h.setOverlay(true);
  for (const key of [up, down, stop]) assert.equal(h.input(key), false);
  h.setOverlay(false);
  h.editor.isShowingAutocomplete = () => true;
  for (const key of [up, down, stop]) assert.equal(h.input(key), false);
  h.editor.isShowingAutocomplete = () => false;
  assert.equal(h.input(down), true);
  delete h.tui.getFocusedComponent;
  for (const key of [up, down, stop]) assert.equal(h.input(key), false);
  assert.deepEqual(h.stops, ['task-1']);
});

test('narrow and short terminals clip safely, and rendering follows the current theme', (t) => {
  const h = harness(t, 8);
  h.jobs[0].activity = 'Reading 界面 👩‍💻\nfiles';
  h.jobs[1].id = 'a-very-long-subagent-name-for-a-narrow-terminal';
  for (const height of [3, 8, 24]) {
    h.tui.terminal.rows = height;
    for (const width of [0, 1, 2, 10, 30, 80]) {
      for (const line of h.menu.render(width)) {
        assert.ok(visibleWidth(line) <= width, `Line exceeded ${width} columns: ${line}`);
        assert.ok(!line.includes('\n'));
      }
    }
  }
  h.ctx.ui.theme = { fg: (color, text) => `${color}:${text}`, bold: (text) => text };
  h.menu.invalidate();
  assert.match(h.screen(), /accent:/);
});

test('disposal is idempotent and removes input and runtime subscriptions', (t) => {
  const h = harness(t);
  assert.equal(h.inputListeners.size, 1);
  assert.equal(h.observers.size, 1);
  h.menu.dispose();
  h.menu.dispose();
  assert.equal(h.inputListeners.size, 0);
  assert.equal(h.observers.size, 0);
  const renders = h.renders;
  h.refresh();
  assert.equal(h.renders, renders);
  assert.equal(h.menu.handleInput(stop), false);
  assert.equal(h.screen(), '');
});
