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

test('heading counts use semantic colors while separators and controls stay dim', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme, calls } = recordingTheme();
  const lines = renderWidget([job(), job({ id: 'stop-code', status: 'stopping' })], theme, 60);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '· Subagents · 1 running · 1 stopping');
  assert.equal(lines[3], '  ↑↓ select · Ctrl+X stop');
  assert.deepEqual(calls.slice(0, 5), [
    ['accent', '· Subagents'], ['dim', ' · '], ['success', '1 running'],
    ['dim', ' · '], ['warning', '1 stopping'],
  ]);
  assert.deepEqual(calls.at(-1), ['dim', '  ↑↓ select · Ctrl+X stop']);
  assert.ok(calls.some(([color, text]) => color === 'accent' && text === '› review-code'));
  assert.ok(calls.some(([color, text]) => color === 'text' && text === '  stop-code'));
});

test('activity colors are restrained and never color the elapsed time or selected name', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const cases: [string, Job['status'], string, ThemeColor][] = [
    ['Running read, bash', 'running', 'Running read, bash', 'success'],
    ['Thinking', 'running', 'Thinking', 'accent'],
    ['Needs a decision', 'running', 'Needs a decision', 'warning'],
    ['Found a gap', 'running', 'Found a gap', 'warning'],
    ['Running bash', 'stopping', 'Stopping', 'warning'],
    ['Starting', 'running', 'Starting', 'muted'],
    ['Working', 'running', 'Working', 'muted'],
    ['Writing response', 'running', 'Writing response', 'muted'],
    ['Other activity', 'running', 'Other activity', 'muted'],
  ];
  for (const [activity, status, displayed, color] of cases) {
    const { theme, calls } = recordingTheme();
    const lines = renderWidget([job({ activity, status })], theme, 80);
    assert.equal(lines.length, 3);
    assert.ok(lines[1].endsWith(`${displayed} · 1:05`));
    assert.deepEqual(calls.slice(-4, -1), [
      ['accent', '› review-code'], [color, displayed], ['dim', ' · 1:05'],
    ], activity);
  }
});

test('real system, dark and light themes preserve text, row bounds and ANSI-safe widths', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const jobs = [
    job({ id: '界面-👩‍💻-é-long-review-name', activity: 'Running read, bash' }),
    job({ id: 'think-code', activity: 'Thinking' }),
    job({ id: 'decision-code', activity: 'Needs a decision' }),
    job({ id: 'gap-code', activity: 'Found a gap' }),
    job({ id: 'stop-code', status: 'stopping' }),
    job({ id: 'write-code', activity: 'Writing response 界面 👩‍💻\nfiles' }),
  ];
  const plain = recordingTheme().theme;
  for (const name of ['system', 'dark', 'light']) {
    const theme = getThemeByName(name);
    assert.ok(theme, `Built-in theme ${name} must load`);
    const wide = renderWidget(jobs, theme, 120);
    assert.ok(wide[0].includes(theme.fg('success', '5 running')));
    assert.ok(wide[1].includes(theme.fg('success', 'Running read, bash')));
    assert.ok(wide[1].includes(theme.fg('dim', ' · 1:05')));
    assert.ok(wide[2].includes(theme.fg('accent', 'Thinking')));
    assert.ok(wide[3].includes(theme.fg('warning', 'Needs a decision')));
    for (const selected of [0, 3, 5]) {
      for (const width of [0, 1, 2, 10, 20, 30, 40, 80, 120]) {
        const lines = renderWidget(jobs, theme, width, selected);
        assert.equal(lines.length, width ? 6 : 0);
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
