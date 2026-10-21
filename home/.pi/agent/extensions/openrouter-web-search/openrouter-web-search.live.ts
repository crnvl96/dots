// Explicit opt-in: incurs real OpenRouter charges. Never run in the offline suite.
// OPENROUTER_LIVE_TEST=1 npm run test:openrouter-web-search:live
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ModelRegistry, ModelRuntime, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import extension, { MODEL } from './index.ts';

assert.equal(process.env.OPENROUTER_LIVE_TEST, '1', 'Set OPENROUTER_LIVE_TEST=1 to allow paid live calls.');
// Use the same environment/registry credential resolution as the extension.
// No model catalog network refresh or main-model completion is needed.
const modelRegistry = new ModelRegistry(await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false }));
const tools: ToolDefinition[] = [];
extension({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI);
assert.deepEqual(tools.map(t => t.name), ['openrouter_web_search', 'openrouter_web_fetch']);
const ctx = { modelRegistry } as ExtensionContext;
const cases = [
  {
    tool: 'openrouter_web_search',
    args: { query: 'Find the official Parallel OpenRouter integration documentation. Return its URL and how to select Parallel as the search engine.' },
    expected: /parallel/i,
  },
  {
    tool: 'openrouter_web_search',
    args: {
      query: 'Find the official Parallel OpenRouter integration documentation and its engine setting.',
      max_results: 3,
      search_context_size: 'high',
    },
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
  assert.equal(result.tool_calls, 1);
  assert.ok(result.cost_usd > 0);
  assert.match(result.report, item.expected);
  assert.match(result.report, /https:\/\//);
  assert.ok(output.usage && output.usage.totalTokens > 0);
  assert.equal(output.usage.cost.total, result.cost_usd);
  if (item.tool === 'openrouter_web_search') {
    assert.ok(result.sources.length > 0);
    assert.equal(result.results.length, result.sources.length);
    assert.equal(result.query, result.input);
  } else {
    assert.equal(result.url, result.input);
    assert.equal(result.notes, result.report);
    if (result.content !== null) assert.equal(result.source_url, result.input);
  }
  const entry = {
    tool: item.tool, args: item.args, status: result.status, model: result.model,
    tool_calls: result.tool_calls, sources: result.sources.length,
    cost_usd: result.cost_usd, request_id: result.request_id,
    duration_ms: Date.now() - started, report: result.report,
    result,
    server_tool_usage: (output.details as any).serverToolUsage,
  };
  evidence.push(entry);
  // Keep full structured evidence in the optional private file, not duplicated in stdout.
  const { result: _result, ...summary } = entry;
  console.log(JSON.stringify(summary, null, 2));
}
if (process.env.OPENROUTER_TEST_EVIDENCE) {
  await writeFile(process.env.OPENROUTER_TEST_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}
console.log('PASS: default search, configured search, and fetch performed confirmed server-side retrieval.');
