// Explicit opt-in only: WEB_TOOLS_LIVE_TEST=1 npm run test:web-tools:live
// Each run makes two Perplexity searches + one fetch and incurs charges.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { config } from '../config.ts';
import { createPerplexity } from '../perplexity.ts';
import { registerTools } from '../tools.ts';

assert.equal(process.env.WEB_TOOLS_LIVE_TEST, '1', 'Set WEB_TOOLS_LIVE_TEST=1 to permit paid live calls.');
const tools: ToolDefinition[] = [];
registerTools({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI, config, createPerplexity(config.perplexity));
assert.deepEqual(tools.map(t => t.name), ['web_search', 'web_fetch']);
const ctx = {} as ExtensionContext;
const cases = [
  { tool: 'web_search', args: { query: 'Perplexity Search API documentation' } },
  { tool: 'web_search', args: { query: 'Perplexity API changelog', max_results: 3, search_context_size: 'high', recency: 'year' } },
  { tool: 'web_fetch', args: { url: 'https://docs.perplexity.ai/', objective: 'Extract the main product sections.' } },
];
const evidence = [];
for (const item of cases) {
  const tool = tools.find(t => t.name === item.tool)!;
  const start = Date.now();
  const output = await tool.execute('web-live-test', item.args, undefined, undefined, ctx);
  const result = output.structuredContent as any;
  assert.equal(result.status, 'ok', JSON.stringify(result.error));
  assert.ok(!output.isError);
  assert.notEqual(result.metadata.retrieval_evidence, 'none');
  if (item.tool === 'web_search') {
    assert.ok(result.results.length > 0);
    assert.deepEqual(result.results, result.sources);
  } else {
    assert.equal(result.source_url, result.url);
  }
  const entry = { tool: item.tool, duration_ms: Date.now() - start, result };
  evidence.push(entry);
  console.log(JSON.stringify({ ...entry, result: { status: result.status, sources: result.sources.length, metadata: result.metadata } }));
}
if (process.env.WEB_TOOLS_TEST_EVIDENCE) {
  await writeFile(process.env.WEB_TOOLS_TEST_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}
console.log('PASS: Perplexity default search, configured search and fetch.');
