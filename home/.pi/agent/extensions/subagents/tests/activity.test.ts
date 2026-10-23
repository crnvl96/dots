import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWidth } from '@earendil-works/pi-tui';
import { toolActivity, updateActivity } from '../activity.ts';

function job() {
  return { status: 'running', activity: 'Starting', tools: new Map() };
}

const start = (id, name, args = {}) => ({ type: 'tool_execution_start', toolCallId: id, toolName: name, args });
const end = (id) => ({ type: 'tool_execution_end', toolCallId: id, toolName: '', result: {}, isError: false, durationMs: 1 });
const message = (type) => ({ type: 'message_update', assistantMessageEvent: { type }, message: {} });

test('known tools describe files, commands and searches rather than arbitrary input payloads', () => {
  const cases = [
    ['read', { path: 'src/parser.ts' }, 'Reading src/parser.ts'],
    ['edit', { file_path: 'src/parser.ts', oldText: 'SECRET', newText: 'SECRET' }, 'Editing src/parser.ts'],
    ['write', { path: 'report.md', content: 'SECRET' }, 'Writing report.md'],
    ['bash', { command: 'npm test', timeout: 30 }, 'Running npm test'],
    ['grep', { pattern: 'renderWidget', path: 'src' }, 'Searching renderWidget in src'],
    ['find', { pattern: '*.test.ts' }, 'Finding *.test.ts'],
    ['ls', {}, 'Listing .'],
    ['codemode', { code: 'SECRET' }, 'Running code · tool orchestration'],
    ['subagents_ask', { kind: 'decision', message: 'SECRET' }, 'Needs a decision'],
    ['subagents_ask', {}, 'Found a gap'],
    ['custom_tool', { apiKey: 'SECRET' }, 'Using custom_tool'],
    ['read', null, 'Reading a file'],
    ['bash', {}, 'Running a command'],
  ];
  for (const [name, args, expected] of cases) assert.equal(toolActivity(name, args), expected);
});

test('tool labels sanitize terminal sequences and bound long input before retaining it', () => {
  const label = toolActivity('bash', { command: '\x1b[31mnpm test\x1b[0m\n--watch\t' + '界'.repeat(200) });
  assert.ok(!/[\x00-\x1f\x7f]/.test(label));
  assert.ok(visibleWidth(label) <= 168);
  assert.match(label, /^Running npm test --watch/);
  assert.equal(toolActivity('custom\n\x1b[31mtool', {}), 'Using custom tool');
});

test('tool activity follows concurrent and nested calls without retaining output or finished history', () => {
  const item = job();
  updateActivity(item, start('orchestrator', 'codemode'));
  updateActivity(item, { ...start('read', 'read', { path: 'src/a.ts' }), parentToolCallId: 'orchestrator' });
  updateActivity(item, start('tests', 'bash', { command: 'npm test' }));
  assert.equal(item.activity, 'Reading src/a.ts · Running npm test · +1 more');
  updateActivity(item, { type: 'tool_execution_update', toolCallId: 'tests', toolName: 'bash', partialResult: { content: 'SECRET' } });
  assert.doesNotMatch(item.activity, /SECRET/);
  updateActivity(item, end('read'));
  assert.equal(item.activity, 'Running code · tool orchestration · Running npm test');
  updateActivity(item, end('tests'));
  assert.equal(item.activity, 'Running code · tool orchestration');
  updateActivity(item, end('orchestrator'));
  assert.equal(item.activity, 'Waiting for model');
  assert.equal(item.tools.size, 0);
});

test('thinking and response writing survive unrelated bookkeeping without exposing message content', () => {
  const item = job();
  updateActivity(item, { type: 'agent_start' });
  assert.equal(item.activity, 'Waiting for model');
  updateActivity(item, message('thinking_delta'));
  assert.equal(item.activity, 'Thinking');
  updateActivity(item, { type: 'queue_update', steering: ['SECRET'], followUp: [] });
  assert.equal(item.activity, 'Thinking');
  updateActivity(item, message('text_delta'));
  assert.equal(item.activity, 'Writing response');
  updateActivity(item, { type: 'message_end', message: { role: 'assistant', content: 'SECRET' } });
  assert.equal(item.activity, 'Writing response');
  updateActivity(item, message('toolcall_delta'));
  assert.equal(item.activity, 'Preparing tool call');
});

test('retry and compaction events explain recovery instead of showing generic work', () => {
  const item = job();
  updateActivity(item, { type: 'auto_retry_start', attempt: 2, maxAttempts: 3, delayMs: 1500, errorMessage: 'SECRET' });
  assert.equal(item.activity, 'Retrying · attempt 2/3 · backoff 2s');
  updateActivity(item, { type: 'queue_update', steering: [], followUp: [] });
  assert.match(item.activity, /^Retrying/);
  updateActivity(item, { type: 'compaction_start', reason: 'threshold' });
  assert.equal(item.activity, 'Compacting context');
  updateActivity(item, { type: 'compaction_end', reason: 'threshold', errorMessage: 'SECRET', aborted: false, willRetry: false });
  assert.equal(item.activity, 'Context compaction failed');
  updateActivity(item, { type: 'turn_start' });
  assert.equal(item.activity, 'Waiting for model');
  item.status = 'stopping';
  item.activity = 'Stopping — waiting for cancellation';
  updateActivity(item, message('text_delta'));
  assert.equal(item.activity, 'Stopping — waiting for cancellation');
});
