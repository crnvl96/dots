// Explicit opt-in only: WEB_TOOLS_LIVE_TEST=1 npm run test:web-tools:live -- openrouter
// Or pass perplexity. Each run makes two searches + one fetch and incurs charges.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ModelRegistry, ModelRuntime, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { config } from '../config.ts';
import { createProviders, providerId } from '../providers/index.ts';
import { registerTools } from '../tools.ts';

assert.equal(process.env.WEB_TOOLS_LIVE_TEST, '1', 'Set WEB_TOOLS_LIVE_TEST=1 to permit paid live calls.');
const providers = createProviders(config);
const id = providerId(process.argv[2] ?? config.defaultProvider, providers);
const tools: ToolDefinition[] = [];
registerTools({ registerTool(tool: ToolDefinition) { tools.push(tool); } } as ExtensionAPI, config, () => providers[id]);
assert.deepEqual(tools.map(t => t.name), ['web_search', 'web_fetch']);
const modelRegistry = new ModelRegistry(await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false }));
const ctx = { modelRegistry } as ExtensionContext;
const cases = [
  { tool: 'web_search', args: { query: 'Find the official Parallel OpenRouter integration documentation and its engine setting.' } },
  { tool: 'web_search', args: { query: 'Find official Parallel OpenRouter integration documentation.', max_results: 3, search_context_size: 'high' } },
  { tool: 'web_fetch', args: { url: 'https://docs.parallel.ai/integrations/openrouter', objective: 'Extract the engine setting and quick-start example.' } },
];
const evidence = [];
for (const item of cases) {
  const tool = tools.find(t => t.name === item.tool)!;
  const start = Date.now();
  const output = await tool.execute('web-live-test', item.args, undefined, undefined, ctx);
  const result = output.structuredContent as any;
  assert.equal(result.provider, id);
  assert.equal(result.status, 'ok', JSON.stringify(result.error));
  assert.ok(!output.isError);
  assert.notEqual(result.metadata.retrieval_evidence, 'none');
  if (id === 'openrouter') {
    assert.equal(result.metadata.tool_calls, 1);
    assert.ok(output.usage && output.usage.totalTokens > 0);
    assert.equal(output.usage.cost.total, result.metadata.cost_usd);
  }
  if (item.tool === 'web_search') {
    assert.ok(result.results.length > 0);
    assert.deepEqual(result.results, result.sources);
    if (id === 'openrouter') {
      assert.equal(result.report, null);
      assert.equal(result.metadata.ranking.status, 'ranked', result.warnings.join('\n'));
      assert.equal(result.metadata.ranking.model, config.openrouter.ranking.model);
      assert.ok(result.sources.every(source => source.snippet?.trim()));
      assert.ok(result.sources.length <= Math.min(item.args.max_results ?? config.search.maxResults, config.openrouter.ranking.maxResults));
    }
  } else if (result.content !== null) {
    assert.equal(result.source_url, result.url);
  }
  const entry = { tool: item.tool, provider: id, duration_ms: Date.now() - start, result };
  evidence.push(entry);
  console.log(JSON.stringify({ ...entry, result: { status: result.status, sources: result.sources.length, metadata: result.metadata } }));
}
if (process.env.WEB_TOOLS_TEST_EVIDENCE) {
  await writeFile(process.env.WEB_TOOLS_TEST_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}
console.log(`PASS: ${id} default search, configured search and fetch.`);
