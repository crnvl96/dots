import assert from 'node:assert/strict';
import test from 'node:test';
import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import type { Job } from '../contracts.ts';
import { renderWidget } from '../rendering.ts';

// The public entry point exports Theme but not the built-in theme loader.
const { getThemeByName } = await import(new URL(
  './modes/interactive/theme/theme.js', import.meta.resolve('@earendil-works/pi-coding-agent'),
).href);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'review-code', model: 'test', provider: 'test', prompt: 'Review',
    status: 'running', startedAt: 0, activity: 'Thinking',
    pendingSteers: 0, tools: new Map(), cancelled: false, notification: 'pending',
    ...overrides,
  };
}

function recordingTheme() {
  const calls: [ThemeColor, string][] = [];
  const theme = {
    fg(color: ThemeColor, text: string) { calls.push([color, text]); return text; },
    bold: (text: string) => text,
  } as Theme;
  return { theme, calls };
}

test('dashboard aligns Agent, Status, Doing now and Time with colored status badges', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme, calls } = recordingTheme();
  const lines = renderWidget([job({ activity: 'Reading src/parser.ts' }), job({ id: 'stop-code', status: 'stopping' })], theme, 100);
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '· Subagents · 1 running · 1 stopping');
  assert.deepEqual(lines[1].split(' │ ').map(text => text.trim()), ['AGENT', 'STATUS', 'DOING NOW', 'TIME']);
  assert.deepEqual(lines[2].split(' │ ').map(text => text.trim()), ['› review-code', '● running', 'Reading src/parser.ts', '1:05']);
  assert.deepEqual(lines[3].split(' │ ').map(text => text.trim()), ['stop-code', '◌ stopping', 'Stopping — waiting for cancellation', '1:05']);
  for (const row of lines.slice(1, 4)) assert.equal(visibleWidth(row), 100);
  assert.ok(calls.some(([color, text]) => color === 'success' && text.trim() === '● running'));
  assert.ok(calls.some(([color, text]) => color === 'warning' && text.trim() === '◌ stopping'));
  assert.ok(calls.some(([color, text]) => color === 'accent' && text.trim() === '› review-code'));
  assert.ok(calls.some(([color, text]) => color === 'text' && text.trim() === 'stop-code'));
  assert.deepEqual(calls.at(-1), ['dim', '  ↑↓ select · Ctrl+X stop']);
});

test('activity colors distinguish thinking, work, writes and attention without coloring elapsed time', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const cases: [string, ThemeColor][] = [
    ['Reading src/index.ts', 'success'], ['Running npm test', 'success'],
    ['Searching renderWidget', 'success'], ['Using custom_tool', 'success'],
    ['Thinking', 'accent'], ['Writing response', 'accent'], ['Preparing tool call', 'accent'],
    ['Needs a decision', 'warning'], ['Found a gap', 'warning'],
    ['Editing src/index.ts', 'warning'], ['Writing report.md', 'warning'],
    ['Retrying · attempt 1/3', 'warning'], ['Compacting context', 'warning'],
    ['Waiting for model', 'muted'], ['Starting', 'muted'],
  ];
  for (const [activity, color] of cases) {
    const { theme, calls } = recordingTheme();
    const lines = renderWidget([job({ activity })], theme, 100);
    assert.equal(lines.length, 4);
    assert.ok(calls.some(([actual, text]) => actual === color && text.trim() === activity), activity);
    assert.ok(calls.some(([actual, text]) => actual === 'dim' && text.trim() === '1:05'));
  }
});

test('narrow layouts keep a status indicator and useful activity without table chrome', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme } = recordingTheme();
  const lines = renderWidget([job({ activity: 'Reading parser.ts' })], theme, 60);
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines.join('\n'), /AGENT|DOING NOW|│/);
  assert.match(lines[1], /› review-code\s+● Reading parser.ts\s+1:05/);
});

test('selection, long names, control sequences and short terminals stay bounded', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme } = recordingTheme();
  const jobs = Array.from({ length: 9 }, (_, i) => job({ id: `child-${i}`, activity: 'Reading 界面 👩‍💻\nfiles' }));
  for (const height of [1, 2, 3, 4, 8, 24]) {
    for (const width of [0, 1, 2, 10, 40, 63, 64, 80, 120]) {
      const lines = renderWidget(jobs, theme, width, 8, 4, height);
      assert.ok(lines.length <= height);
      assert.ok(lines.every(line => visibleWidth(line) <= width && !line.includes('\n')));
      if (width >= 40) assert.match(lines.join('\n'), /› child-8/);
    }
  }
  const hostile = renderWidget([job({ id: 'review\n\x1b[31mcode', activity: 'Reading\x1b]8;;https://example.test\x07path\x1b]8;;\x07\nfile' })], theme, 100);
  assert.ok(hostile.every(line => !line.includes('\x1b') && !line.includes('\n')));
  const long = renderWidget([job({ id: 'x'.repeat(48), activity: 'Running ' + 'x'.repeat(1000) })], theme, 80);
  assert.ok(long.every(line => visibleWidth(line) <= 80));
  assert.match(long[2], /\.\.\./);
});

test('real system, dark and light themes preserve layout, Unicode and ANSI-safe widths', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const jobs = [
    job({ id: '界面-👩‍💻-é-long-review-name', activity: 'Reading src/界面.ts' }),
    job({ id: 'think-code', activity: 'Thinking' }),
    job({ id: 'decision-code', activity: 'Needs a decision' }),
    job({ id: 'retry-code', activity: 'Retrying · attempt 1/3' }),
    job({ id: 'stop-code', status: 'stopping' }),
    job({ id: 'write-code', activity: 'Writing response 界面 👩‍💻\nfiles' }),
  ];
  const plain = recordingTheme().theme;
  for (const name of ['system', 'dark', 'light']) {
    const theme = getThemeByName(name);
    assert.ok(theme, `Built-in theme ${name} must load`);
    for (const selected of [0, 3, 5]) {
      for (const width of [0, 1, 2, 10, 20, 30, 40, 63, 64, 80, 120]) {
        const lines = renderWidget(jobs, theme, width, selected);
        assert.equal(lines.length, width ? (width >= 64 ? 7 : 6) : 0);
        assert.deepEqual(lines.map(stripTerminalSequences), renderWidget(jobs, plain, width, selected).map(stripTerminalSequences),
          `${name}, width ${width}, selected ${selected}`);
        for (const line of lines) {
          assert.ok(visibleWidth(line) <= width, `${name}: line exceeds ${width} columns`);
          assert.ok(!line.includes('\n'));
        }
      }
    }
    assert.deepEqual(renderWidget([], theme, 80), []);
  }
});
