// Explicit opt-in: incurs real OpenRouter charges. Never run in the offline suite.
// OPENROUTER_LIVE_TEST=1 npm run test:openrouter-web-search:live
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import extension, { MODEL } from '../agent/extensions/openrouter-web-search.ts';

assert.equal(process.env.OPENROUTER_LIVE_TEST, '1', 'Set OPENROUTER_LIVE_TEST=1 to allow paid live calls.');
assert.ok(process.env.OPENROUTER_API_KEY?.trim(), 'OPENROUTER_API_KEY must be exported.');
const tools: ToolDefinition[] = [];
extension({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI);
assert.deepEqual(tools.map(t => t.name), ['openrouter_web_search', 'openrouter_web_fetch']);
const ctx = { modelRegistry: { async getApiKeyForProvider() { return undefined; } } } as unknown as ExtensionContext;
const cases = [
  {
    tool: 'openrouter_web_search',
    args: { query: 'Find the official Parallel OpenRouter integration documentation. Return its URL and how to select Parallel as the search engine.' },
    expected: /parallel/i,
  },
  {
    tool: 'openrouter_web_fetch',
    args: { url: 'https://docs.parallel.ai/integrations/openrouter', objective: 'Extract the quick-start example and explain the engine setting. Include the page title and source URL.' },
    expected: /parallel/i,
  },
];
const evidence = [];
for (const item of cases) {
  const tool = tools.find(t => t.name === item.tool)!;
  const started = Date.now();
  const output = await tool.execute('live-test', item.args, undefined, undefined, ctx);
  const result = output.structuredContent as any;
  assert.ok(!output.isError, result?.report);
  assert.equal(result.status, 'ok');
  assert.equal(result.model, MODEL);
  assert.ok(result.tool_calls > 0 && result.tool_calls <= 10);
  assert.ok(result.cost_usd > 0);
  assert.match(result.report, item.expected);
  assert.match(result.report, /https:\/\//);
  assert.ok(output.usage && output.usage.totalTokens > 0);
  assert.equal(output.usage.cost.total, result.cost_usd);
  if (item.tool === 'openrouter_web_search') assert.ok(result.sources.length > 0);
  const entry = {
    tool: item.tool, status: result.status, model: result.model,
    tool_calls: result.tool_calls, sources: result.sources.length,
    cost_usd: result.cost_usd, request_id: result.request_id,
    duration_ms: Date.now() - started, report: result.report,
    server_tool_usage: (output.details as any).serverToolUsage,
  };
  evidence.push(entry);
  console.log(JSON.stringify(entry, null, 2));
}
if (process.env.OPENROUTER_TEST_EVIDENCE) {
  await writeFile(process.env.OPENROUTER_TEST_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}
console.log('PASS: both registered Pi tools performed confirmed server-side retrieval.');
