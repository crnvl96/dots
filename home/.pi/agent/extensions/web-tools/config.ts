import type { ContextSize, ProviderId } from './contracts.ts';

/**
 * ALL USER-ADJUSTABLE SETTINGS LIVE HERE. Edit this object, then /reload Pi.
 * Secrets stay in environment variables / Pi's credential store, never this file.
 * New environment exports require restarting Pi; /reload cannot import them.
 *
 * Provider selection: /web provider <id> saves a branch-local session override.
 * On reload/resume: session override > --web-provider <id> > defaultProvider.
 * /web provider reset clears the session override. To change the default for NEW
 * sessions, edit defaultProvider below. No other configuration file is needed.
 *
 * There are no automatic retries or cross-provider fallbacks (privacy and cost).
 * Both operations always use the selected provider, independently of Pi's model.
 */
export interface WebToolsConfig {
  defaultProvider: ProviderId;
  search: { maxResults: number; contextSize: ContextSize };
  fetch: { defaultObjective: string };
  output: { maxLines: number; maxBytes: number };
  openrouter: {
    apiKeyEnv: string;
    usePiCredentials: boolean;
    endpoint: string;
    model: string;
    timeoutMs: number;
    maxOutputTokens: number;
    search: {
      engine: 'parallel' | 'exa' | 'perplexity';
      mode: 'turbo' | 'fast' | 'basic' | 'advanced' | 'instant' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning';
    };
    ranking: { model: string; maxResults: number; minScore: number; timeoutMs: number };
    fetch: { engine: 'parallel' | 'exa' | 'openrouter' | 'firecrawl'; maxContentTokens: number };
  };
  perplexity: {
    apiKeyEnv: string;
    baseUrlEnv: string;
    baseUrl: string;
    timeoutMs: number;
    fetch: { preset: string; maxSteps: number; maxOutputTokens: number };
  };
}

export const config: WebToolsConfig = {
  // Options: 'openrouter' or 'perplexity'. Applies to BOTH search and fetch.
  defaultProvider: 'openrouter',
  search: {
    // Default engine results requested, integer 1–20. Not a guaranteed citation
    // count. A web_search call's max_results overrides this default.
    maxResults: 8,
    // Options: 'low', 'medium', 'high'. Relative context budget, NOT an exact
    // size: Parallel applies it across results; other engines may apply it per
    // result. A call's search_context_size overrides this default.
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
  openrouter: {
    // Environment variable name; value is trimmed. Never paste a secret here.
    apiKeyEnv: 'OPENROUTER_API_KEY',
    // true: fall back to Pi's 'openrouter' credential when the env key is absent.
    // false: require the environment key. Does not affect Pi's main chat model.
    usePiCredentials: true,
    // Trusted Chat Completions endpoint; receives the API key and tool input.
    // Keep the global endpoint: regional endpoints restrict server tools.
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    // OpenRouter model ID (provider/model). Current tested default below.
    // Other IDs may work if they support server tools + structured final output;
    // changing this does NOT change Pi's main model. No model fallback is added.
    model: 'openai/gpt-6.1-sol',
    // Positive integer milliseconds, covering headers AND response body.
    timeoutMs: 180_000,
    // Positive integer: nested model output budget, not fetched-page length.
    maxOutputTokens: 8_000,
    search: {
      // Supported here: 'parallel', 'exa', 'perplexity'. OpenRouter also offers
      // 'auto', 'native', 'firecrawl', deliberately excluded here because those
      // can ignore our result/context controls or choose a different engine.
      // Only Parallel advanced has been live-tested in this integration.
      engine: 'parallel',
      // Parallel: 'turbo' | 'fast' | 'basic' | 'advanced'.
      // Exa: 'instant' | 'fast' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning'.
      // Perplexity: ignored and NOT sent. Invalid engine/mode pairs fail locally.
      mode: 'advanced',
    },
    // Search only: Sol retrieves, Jev scores, code selects original excerpts.
    ranking: {
      // OpenRouter classifier ID; uses the SAME resolved OpenRouter credential.
      model: 'typesafe/jev-1.13',
      // Return at most this many results, also bounded by the call's max_results.
      maxResults: 5,
      // Expected relevance on a 0–3 scale; 0 unrelated, 3 directly useful.
      minScore: 1.5,
      // Classification deadline. Failure returns citation-order excerpts + warning.
      timeoutMs: 30_000,
    },
    fetch: {
      // Options: 'parallel', 'exa', 'openrouter', 'firecrawl'. Explicit external
      // extraction only; native/auto omit some controls or can choose engines.
      // 'openrouter' means its HTTP extractor, NOT the web-tools provider ID.
      // Firecrawl can be rejected by ZDR policies. Only Parallel live-tested.
      engine: 'parallel',
      // Positive integer approximate INPUT content-token cap sent to extractor.
      // Upstream docs specify no universal maximum. Not a full-page guarantee.
      maxContentTokens: 50_000,
    },
    // Requests expose one server tool with max_uses: 1 and max_tool_calls: 1.
    // These are protocol invariants, not research-loop tuning settings.
    // Reference: https://openrouter.ai/docs/guides/features/server-tools/web-search
    // Reference: https://openrouter.ai/docs/guides/features/server-tools/web-fetch
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
      // Agent API preset identifier. 'low' preserves the existing integration;
      // other presets must be supported by your Perplexity account/API. This
      // adapter does not promise support for arbitrary model/preset changes.
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
