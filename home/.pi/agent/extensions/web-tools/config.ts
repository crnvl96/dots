import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { WebToolsError, type ContextSize } from './contracts.ts';
import { SearchParams } from './schemas.ts';

/**
 * ALL USER-ADJUSTABLE SETTINGS LIVE HERE. Edit this object, then /reload Pi.
 * Secrets stay in environment variables, never this file. New environment
 * exports require restarting Pi; /reload cannot import them.
 *
 * Both tools use Perplexity, independently of Pi's main model. There are no
 * automatic retries.
 */
export interface WebToolsConfig {
  search: { maxResults: number; contextSize: ContextSize };
  fetch: { defaultObjective: string };
  output: { maxLines: number; maxBytes: number };
  perplexity: {
    apiKeyEnv: string;
    baseUrlEnv: string;
    baseUrl: string;
    timeoutMs: number;
    fetch: { preset: string; maxSteps: number; maxOutputTokens: number };
  };
}

export const config: WebToolsConfig = {
  search: {
    // Default results requested, integer 1–20. A web_search call's max_results
    // overrides this default.
    maxResults: 8,
    // Options: 'low', 'medium', 'high'. Perplexity's per-result context budget.
    // A call's search_context_size overrides this default.
    contextSize: 'medium',
  },
  fetch: {
    // Used when web_fetch omits objective. Any nonempty extraction instruction.
    defaultObjective: 'Return enough of the page content for another assistant to summarize it.',
  },
  output: {
    // Positive integers. First limit reached truncates model-facing Markdown;
    // structured/codemode output stays untruncated. Full Markdown goes to a
    // private OS temporary file, whose path is returned. No automatic cleanup.
    maxLines: 1_000,
    maxBytes: 25 * 1024,
  },
  perplexity: {
    // Environment variable name; required, trimmed. No Pi credential fallback.
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    // Optional env override of baseUrl; blank falls back to the value below.
    baseUrlEnv: 'PERPLEXITY_API_BASE_URL',
    // Trusted API root; receives credentials. Paths /search and /v1/agent are
    // appended. Use overrides only for a trusted compatible proxy/test server.
    baseUrl: 'https://api.perplexity.ai',
    // Positive integer milliseconds; applies to both operations, body included.
    timeoutMs: 60_000,
    fetch: {
      // Agent API preset identifier. Other presets must be supported by your
      // Perplexity account/API.
      preset: 'low',
      // Positive integer agent step budget; 2 allows fetch + final note.
      // The request exposes only fetch_url, with max_urls: 1 (fixed invariant).
      maxSteps: 2,
      // Positive integer final-agent-output budget, not extracted-page length.
      maxOutputTokens: 1_200,
    },
    // Agent requests always set store: false. This is not a claim about the
    // provider's general retention policy. Search uses the direct Search API.
  },
};

// ---------------------------------------------------------------------------
// Validation, run once at load (index.ts). Pi loads this file without type
// checking, so values are checked at runtime. The resolved Perplexity base URL
// (environment override included) is checked by createPerplexity.
function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new WebToolsError('configuration', `${name} must be a positive integer.`);
}
function nonempty(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new WebToolsError('configuration', `${name} must not be empty.`);
}
const SearchDefaults = Type.Required(Type.Pick(SearchParams, ['max_results', 'search_context_size']));
export function validateConfig(settings: WebToolsConfig): void {
  const { search, fetch, output, perplexity } = settings;
  // Unlike per-call overrides, defaults must be present. Reuse the field schemas.
  if (!Check(SearchDefaults, { max_results: search.maxResults, search_context_size: search.contextSize })) {
    throw new WebToolsError('configuration', 'search.maxResults must be an integer from 1 to 20 and search.contextSize one of low/medium/high.');
  }
  nonempty(fetch.defaultObjective, 'fetch.defaultObjective');
  positiveInteger(output.maxLines, 'output.maxLines');
  positiveInteger(output.maxBytes, 'output.maxBytes');
  positiveInteger(perplexity.timeoutMs, 'perplexity.timeoutMs');
  positiveInteger(perplexity.fetch.maxSteps, 'perplexity.fetch.maxSteps');
  positiveInteger(perplexity.fetch.maxOutputTokens, 'perplexity.fetch.maxOutputTokens');
  nonempty(perplexity.fetch.preset, 'perplexity.fetch.preset');
}
