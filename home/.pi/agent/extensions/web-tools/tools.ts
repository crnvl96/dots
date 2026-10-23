import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WebToolsConfig } from './config.ts';
import {
  emptyMetadata, WebToolsError, type FetchInput, type Operation,
  type ProviderResponse, type RetrievalResult, type Retriever, type SearchInput,
} from './contracts.ts';
import { formatAndTruncate } from './formatting.ts';
import { fetchGuidelines, searchGuidelines } from './prompts.ts';
import { progressText, renderCall, renderResult, type Details } from './rendering.ts';
import { FetchOutputSchema, FetchParams, SearchOutputSchema, SearchParams, type FetchArgs, type SearchArgs } from './schemas.ts';
import { normalizeUrl } from './transport.ts';

// Pi validates arguments against the parameter schemas before execute, so only
// checks the schemas cannot express remain: blank-after-trim and URL policy.
export function normalizeSearch(args: SearchArgs, defaults: WebToolsConfig['search']): SearchInput {
  const query = args.query.trim();
  if (!query) throw new WebToolsError('invalid_input', 'query must not be empty.');
  return {
    query, max_results: args.max_results ?? defaults.maxResults,
    search_context_size: args.search_context_size ?? defaults.contextSize, recency: args.recency,
  };
}
export function normalizeFetch(args: FetchArgs, defaults: WebToolsConfig['fetch']): FetchInput {
  const objective = args.objective?.trim() ?? defaults.defaultObjective;
  if (!objective) throw new WebToolsError('invalid_input', 'objective must not be empty.');
  return { url: normalizeUrl(args.url), objective };
}
function errorResult(operation: Operation, input: string, error: unknown, signal?: AbortSignal): RetrievalResult {
  const failure = signal?.aborted && !(error instanceof WebToolsError && error.code === 'cancelled')
    ? { code: 'cancelled' as const, message: 'Web request cancelled.' }
    : error instanceof WebToolsError ? { code: error.code, message: error.message }
    : { code: 'retrieval_failed' as const, message: 'Web retrieval failed unexpectedly.' };
  const base = { status: 'error' as const, sources: [], report: null, metadata: emptyMetadata(), warnings: [], error: failure };
  return operation === 'search' ? { ...base, operation, query: input, results: [] }
    : { ...base, operation, url: input, source_url: null, title: null, content: null };
}

type Update = (update: { content: { type: 'text'; text: string }[]; details: Details }) => void;
// A started retrieval: the normalized input (for error results) and its response.
type Retrieval = { input: string; response: Promise<ProviderResponse<RetrievalResult>> };

export function registerTools(pi: Pick<ExtensionAPI, 'registerTool'>, settings: WebToolsConfig, retriever: Retriever) {
  const limitDescription = `Text is capped at ${settings.output.maxLines} lines/${settings.output.maxBytes} bytes, with a private full-output file when truncated. Structured data is untruncated.`;
  const shared = {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    namespace: { name: 'web', description: 'Perplexity web search and page extraction.', instructions: [...searchGuidelines, ...fetchGuidelines].join('\n') },
    renderResult,
  };

  async function run(operation: Operation, rawInput: string, signal: AbortSignal | undefined, onUpdate: Update | undefined, start: () => Retrieval) {
    let input = rawInput;
    let response: ProviderResponse<RetrievalResult>;
    try {
      // Abort reasons can carry private data, including a caller's WebToolsError.
      if (signal?.aborted) throw new WebToolsError('cancelled', 'Web request cancelled.');
      onUpdate?.({ content: [{ type: 'text', text: progressText(operation) }], details: { operation } });
      const retrieval = start();
      input = retrieval.input;
      response = await retrieval.response;
    } catch (error) {
      response = { result: errorResult(operation, input, error, signal) };
    }
    const formatted = await formatAndTruncate(response.result, settings.output);
    const result = { ...response.result, full_output_path: formatted.full_output_path };
    return {
      content: [{ type: 'text' as const, text: formatted.text }],
      details: { operation, result } satisfies Details,
      structuredContent: result, usage: response.usage, isError: result.status === 'error',
    };
  }
  pi.registerTool<typeof SearchParams, Details>({
    ...shared, name: 'web_search', label: 'Web Search',
    description: `Search the live web with Perplexity. Returns ranked results with provider excerpts; completeness varies. ${limitDescription}`,
    promptSnippet: 'Search the live web and return sources with excerpts', promptGuidelines: searchGuidelines,
    parameters: SearchParams, outputSchema: SearchOutputSchema,
    execute: (_id, args, signal, onUpdate) => run('search', args.query, signal, onUpdate, () => {
      const input = normalizeSearch(args, settings.search);
      return { input: input.query, response: retriever.search(input, signal) };
    }),
    renderCall: (args, theme) => renderCall('search', JSON.stringify(args.query), theme),
  });
  pi.registerTool<typeof FetchParams, Details>({
    ...shared, name: 'web_fetch', label: 'Web Fetch',
    description: `Fetch/extract a known HTTP(S) URL with Perplexity. Best effort, not raw HTML; cannot bypass login walls or paywalls. Provider excerpts remain separate from model notes, and may be absent. ${limitDescription}`,
    promptSnippet: 'Fetch and extract content from a known web URL', promptGuidelines: fetchGuidelines,
    parameters: FetchParams, outputSchema: FetchOutputSchema,
    execute: (_id, args, signal, onUpdate) => run('fetch', args.url, signal, onUpdate, () => {
      const input = normalizeFetch(args, settings.fetch);
      return { input: input.url, response: retriever.fetch(input, signal) };
    }),
    renderCall: (args, theme) => renderCall('fetch', args.url, theme),
  });
}
