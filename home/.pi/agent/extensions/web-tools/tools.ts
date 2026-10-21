import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { WebToolsConfig } from './config.ts';
import {
  emptyMetadata, WebToolsError, type FetchInput, type Operation, type ProviderContext,
  type ProviderResponse, type Recency, type RetrievalResult, type SearchInput, type WebProvider,
} from './contracts.ts';
import { formatAndTruncate } from './formatting.ts';
import { fetchGuidelines, searchGuidelines } from './prompts.ts';
import { renderCall, renderResult, type Details } from './rendering.ts';
import { FetchOutputSchema, FetchParams, SearchOutputSchema, SearchParams, type FetchArgs, type SearchArgs } from './schemas.ts';
import { normalizeUrl, positiveInteger } from './transport.ts';

export function providerContext(ctx: Pick<ExtensionContext, 'modelRegistry'>, signal?: AbortSignal): ProviderContext {
  return {
    signal, getApiKey: provider => ctx.modelRegistry.getApiKeyForProvider(provider),
    async classify(id, input, options) {
      const model = ctx.modelRegistry.findOfType('classifier', 'openrouter', id);
      if (!model) throw new WebToolsError('configuration', 'OpenRouter ranking model is not in the classifier catalog.');
      return ctx.modelRegistry.classify(model, input, { ...options, maxRetries: 0 });
    },
  };
}
export function validateCommonConfig(settings: WebToolsConfig): void {
  positiveInteger(settings.output.maxLines, 'output.maxLines');
  positiveInteger(settings.output.maxBytes, 'output.maxBytes');
  positiveInteger(settings.search.maxResults, 'search.maxResults');
  if (settings.search.maxResults > 20) throw new WebToolsError('configuration', 'search.maxResults must be at most 20.');
  if (!['low', 'medium', 'high'].includes(settings.search.contextSize)) throw new WebToolsError('configuration', 'Invalid search.contextSize.');
  if (!settings.fetch.defaultObjective.trim()) throw new WebToolsError('configuration', 'fetch.defaultObjective must not be empty.');
}
export function normalizeSearch(args: SearchArgs, settings: WebToolsConfig): SearchInput {
  if (typeof args.query !== 'string' || !args.query.trim()) throw new WebToolsError('invalid_input', 'query must not be empty.');
  const maxResults = args.max_results ?? settings.search.maxResults;
  const contextSize = args.search_context_size ?? settings.search.contextSize;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) throw new WebToolsError('invalid_input', 'max_results must be an integer from 1 to 20.');
  if (!['low', 'medium', 'high'].includes(contextSize)) throw new WebToolsError('invalid_input', 'Invalid search_context_size.');
  if (args.recency !== undefined && !['hour', 'day', 'week', 'month', 'year'].includes(args.recency)) throw new WebToolsError('invalid_input', 'Invalid recency.');
  return { query: args.query.trim(), max_results: maxResults, search_context_size: contextSize, ...(args.recency ? { recency: args.recency as Recency } : {}) };
}
export function normalizeFetch(args: FetchArgs, settings: WebToolsConfig): FetchInput {
  if (args.objective !== undefined && (typeof args.objective !== 'string' || !args.objective.trim())) throw new WebToolsError('invalid_input', 'objective must not be empty.');
  return { url: normalizeUrl(args.url), objective: args.objective?.trim() || settings.fetch.defaultObjective };
}
function errorResult(operation: Operation, input: string, provider: WebProvider | undefined, error: unknown, signal?: AbortSignal): RetrievalResult {
  const failure = signal?.aborted ? { code: 'cancelled' as const, message: 'Web request cancelled.' }
    : error instanceof WebToolsError ? { code: error.code, message: error.message }
    : { code: 'retrieval_failed' as const, message: 'Web retrieval failed unexpectedly.' };
  const base = { provider: provider?.id ?? null, status: 'error' as const, sources: [], report: null, metadata: emptyMetadata(), warnings: [], error: failure };
  return operation === 'search' ? { ...base, operation, query: input, results: [] }
    : { ...base, operation, url: input, source_url: null, title: null, content: null };
}

export function registerTools(pi: ExtensionAPI, settings: WebToolsConfig, getProvider: () => WebProvider) {
  validateCommonConfig(settings);
  const limitDescription = `Text is capped at ${settings.output.maxLines} lines/${settings.output.maxBytes} bytes, with a private full-output file when truncated. Structured data is untruncated.`;
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
  const namespace = { name: 'web', description: 'Provider-independent web search and page extraction.', instructions: [...searchGuidelines, ...fetchGuidelines].join('\n') };

  async function run(
    operation: Operation, args: SearchArgs | FetchArgs, signal: AbortSignal | undefined,
    onUpdate: ((update: { content: { type: 'text'; text: string }[]; details: Details }) => void) | undefined,
    ctx: ExtensionContext,
  ) {
    // Snapshot before the first await: all work and historical rendering belong
    // to this provider, even if configuration changes while a call is running.
    let provider: WebProvider | undefined;
    let input = 'query' in args ? args.query : args.url;
    let response: ProviderResponse<RetrievalResult>;
    try {
      provider = getProvider();
      signal?.throwIfAborted();
      onUpdate?.({ content: [{ type: 'text', text: `${operation === 'search' ? 'Searching' : 'Fetching'} with ${provider.label}…` }], details: { provider: provider.id, operation } });
      const context = providerContext(ctx, signal);
      if (operation === 'search') {
        const normalized = normalizeSearch(args as SearchArgs, settings);
        input = normalized.query;
        if (normalized.recency && !provider.capabilities.recencyFilter) throw new WebToolsError('unsupported_option', `${provider.label} does not support recency. Select the Perplexity provider or omit the filter; it was not applied.`);
        response = await provider.search(normalized, context);
      } else {
        const normalized = normalizeFetch(args as FetchArgs, settings);
        input = normalized.url;
        response = await provider.fetch(normalized, context);
      }
    } catch (error) {
      response = { result: errorResult(operation, input, provider, error, signal) };
    }
    const formatted = await formatAndTruncate(response.result, settings.output);
    const result = { ...response.result, full_output_path: formatted.full_output_path };
    return {
      content: [{ type: 'text' as const, text: formatted.text }],
      details: { provider: provider?.id ?? null, operation, result } satisfies Details,
      structuredContent: result, usage: response.usage, isError: result.status === 'error',
    };
  }
  pi.registerTool<typeof SearchParams, Details>({
    name: 'web_search', label: 'Web Search',
    description: `Search the live web through the selected web-tools provider. Provider excerpts are separate from any model-written report; source ordering and completeness vary. ${limitDescription}`,
    promptSnippet: 'Search the live web and return sources with excerpts', promptGuidelines: searchGuidelines,
    parameters: SearchParams, outputSchema: SearchOutputSchema, annotations, namespace,
    execute: (_id, args, signal, onUpdate, ctx) => run('search', args, signal, onUpdate, ctx),
    renderCall: (args, theme) => renderCall('search', JSON.stringify(args.query), theme), renderResult,
  });
  pi.registerTool<typeof FetchParams, Details>({
    name: 'web_fetch', label: 'Web Fetch',
    description: `Fetch/extract a known HTTP(S) URL through the selected web-tools provider. Best effort, not raw HTML; cannot bypass login walls or paywalls. Provider excerpts remain separate from model reports, and may be absent. ${limitDescription}`,
    promptSnippet: 'Fetch and extract content from a known web URL', promptGuidelines: fetchGuidelines,
    parameters: FetchParams, outputSchema: FetchOutputSchema, annotations, namespace,
    execute: (_id, args, signal, onUpdate, ctx) => run('fetch', args, signal, onUpdate, ctx),
    renderCall: (args, theme) => renderCall('fetch', args.url, theme), renderResult,
  });
}
