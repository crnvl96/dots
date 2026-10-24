import assert from 'node:assert/strict';
import test from 'node:test';
import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import type { Job } from '../contracts.ts';
import { renderWidget } from '../rendering.ts';
import { toolActivity } from '../activity.ts';

// The public entry point exports Theme but not the built-in theme loader.
const { getThemeByName } = await import(
  new URL(
    './modes/interactive/theme/theme.js',
    import.meta.resolve('@earendil-works/pi-coding-agent'),
  ).href
);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'review-code',
    model: 'test',
    provider: 'test',
    prompt: 'Review',
    status: 'running',
    startedAt: 0,
    activity: 'Thinking',
    pendingSteers: 0,
    tools: new Map(),
    cancelled: false,
    notification: 'pending',
    ...overrides,
  };
}

function recordingTheme() {
  const calls: [ThemeColor, string][] = [];
  const theme = {
    fg(color: ThemeColor, text: string) {
      calls.push([color, text]);
      return text;
    },
    bold: (text: string) => text,
  } as Theme;
  return { theme, calls };
}

test('rows retain aligned colored status, activity and time without headers, bars or controls', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme, calls } = recordingTheme();
  const lines = renderWidget(
    [job({ activity: 'Reading src/parser.ts' }), job({ id: 'stop-code', status: 'stopping' })],
    theme,
    100,
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '· Subagents · 1 running · 1 stopping');
  assert.equal(lines[1].slice(0, 14).trim(), 'review-code');
  assert.equal(lines[1].slice(16, 26).trim(), '● running');
  assert.equal(lines[1].slice(28, 94).trim(), 'Reading src/parser.ts');
  assert.equal(lines[1].slice(96), '1:05');
  assert.match(lines[2], /◌ stopping\s+Stopping — waiting for cancellation\s+1:05/);
  for (const row of lines.slice(1)) assert.equal(visibleWidth(row), 100);
  assert.ok(calls.some(([color, text]) => color === 'success' && text.trim() === '● running'));
  assert.ok(calls.some(([color, text]) => color === 'warning' && text.trim() === '◌ stopping'));
  assert.doesNotMatch(lines.join('\n'), /│|AGENT|STATUS|DOING NOW|TIME|Ctrl\+X|↑|↓|›/);
});

test('activity colors distinguish thinking, work, writes and attention without coloring elapsed time', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const cases: [string, ThemeColor][] = [
    ['Reading src/index.ts', 'success'],
    ['Running npm test', 'success'],
    ['Searching renderWidget', 'success'],
    ['Using custom_tool', 'success'],
    ['Thinking', 'accent'],
    ['Writing response', 'accent'],
    ['Preparing tool call', 'accent'],
    ['Needs a decision', 'warning'],
    ['Found a gap', 'warning'],
    ['Editing src/index.ts', 'warning'],
    ['Writing report.md', 'warning'],
    ['Retrying · attempt 1/3', 'warning'],
    ['Compacting context', 'warning'],
    ['Waiting for model', 'muted'],
    ['Starting', 'muted'],
  ];
  for (const [activity, color] of cases) {
    const { theme, calls } = recordingTheme();
    const lines = renderWidget([job({ activity })], theme, 100);
    assert.equal(lines.length, 2);
    assert.ok(
      calls.some(([actual, text]) => actual === color && text.trim() === activity),
      activity,
    );
    assert.ok(calls.some(([actual, text]) => actual === 'dim' && text.trim() === '1:05'));
  }
});

test('narrow layouts keep a status indicator and useful activity', (t) => {
  t.mock.method(Date, 'now', () => 65_000);
  const { theme } = recordingTheme();
  const lines = renderWidget([job({ activity: 'Reading parser.ts' })], theme, 60);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /review-code\s+● Reading parser.ts\s+1:05/);
});

test('clipped commands and paths automatically wrap below their row, including text beyond 160 columns', () => {
  const { theme } = recordingTheme();
  for (const [name, args] of [
    [
      'bash',
      {
        command:
          'npm test -- --runInBand --testPathPattern=extensions/subagents/tests/runtime.test.ts ' +
          '--verbose '.repeat(12) +
          '--last-flag',
      },
    ],
    ['read', { path: 'src/' + 'nested-folder/'.repeat(14) + 'last-file.ts' }],
  ] as const) {
    const activity = toolActivity(name, args);
    const lines = renderWidget([job({ activity })], theme, 80).map(stripTerminalSequences);
    assert.match(lines[1], /\.\.\./);
    assert.match(lines[2], /^  ↳ /);
    const expanded = lines
      .slice(2)
      .map((line) => line.slice(4))
      .join('');
    assert.equal(expanded.replace(/\s/g, ''), activity.replace(/\s/g, ''));
    assert.ok(lines.length <= 8);
    assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  }
  assert.equal(renderWidget([job()], theme, 80).length, 2, 'Short activity needs no detail row.');
});

test('details never crowd out other agents and an overfull display reports its hidden rows', () => {
  const { theme } = recordingTheme();
  const jobs = Array.from({ length: 9 }, (_, i) =>
    job({ id: `child-${i}`, activity: 'Running ' + 'x'.repeat(1000) }),
  );
  const lines = renderWidget(jobs, theme, 80, 5).map(stripTerminalSequences);
  assert.equal(lines.length, 5);
  assert.match(lines[1], /child-0/);
  assert.match(lines[3], /child-2/);
  assert.match(lines[4], /\+6 more active/);
  assert.doesNotMatch(lines.join('\n'), /↳/);
  const detail = renderWidget([jobs[0]], theme, 80, 3).map(stripTerminalSequences);
  assert.equal(detail.length, 3);
  assert.match(detail[2], /↳ .*\.\.\.$/);
});

test('long names, control sequences and short terminals stay bounded', () => {
  const { theme } = recordingTheme();
  const jobs = Array.from({ length: 9 }, (_, i) =>
    job({ id: `child-${i}`, activity: 'Reading 界面 👩‍💻\nfiles' }),
  );
  for (const height of [1, 2, 3, 4, 8, 24]) {
    for (const width of [0, 1, 2, 10, 40, 63, 64, 80, 120]) {
      const lines = renderWidget(jobs, theme, width, height);
      assert.ok(lines.length <= height);
      assert.ok(lines.every((line) => visibleWidth(line) <= width && !line.includes('\n')));
      if (width >= 40) assert.match(lines.join('\n'), /child-0/);
    }
  }
  const hostile = renderWidget(
    [
      job({
        id: 'review\n\x1b[31mcode',
        activity: 'Reading\x1b]8;;https://example.test\x07path\x1b]8;;\x07\nfile',
      }),
    ],
    theme,
    100,
  );
  assert.ok(hostile.every((line) => !line.includes('\x1b') && !line.includes('\n')));
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
    for (const width of [0, 1, 2, 10, 20, 30, 40, 63, 64, 80, 120]) {
      const lines = renderWidget(jobs, theme, width);
      assert.ok(lines.length <= 8);
      assert.deepEqual(
        lines.map(stripTerminalSequences),
        renderWidget(jobs, plain, width).map(stripTerminalSequences),
        `${name}, width ${width}`,
      );
      for (const line of lines) {
        assert.ok(visibleWidth(line) <= width, `${name}: line exceeds ${width} columns`);
        assert.ok(!line.includes('\n'));
      }
    }
    assert.deepEqual(renderWidget([], theme, 80), []);
  }
});
