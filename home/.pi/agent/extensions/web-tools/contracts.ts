import type { ClassifierContext, ClassifierResult, Usage } from '@earendil-works/pi-ai';

export type ProviderId = 'openrouter' | 'perplexity';
export type Operation = 'search' | 'fetch';
export type ContextSize = 'low' | 'medium' | 'high';
export type Recency = 'hour' | 'day' | 'week' | 'month' | 'year';
export interface SearchInput {
  query: string;
  max_results: number;
  search_context_size: ContextSize;
  recency?: Recency;
}
export interface FetchInput { url: string; objective: string }

// Narrow dependencies: providers cannot access the Pi conversation or local tools.
export interface ProviderContext {
  signal?: AbortSignal;
  getApiKey(provider: string): Promise<string | undefined>;
  classify?(model: string, input: ClassifierContext, options: { apiKey: string; signal?: AbortSignal }): Promise<ClassifierResult>;
}
export type Source = {
  title: string;
  url: string;
  snippet: string | null;
  date: string | null;
  last_updated: string | null;
};
export type Ranking = {
  model: string;
  status: 'ranked' | 'fallback';
  candidates: number;
  selected: number;
  scores: { url: string; score: number }[];
};
export type Metadata = {
  ranking?: Ranking;
  result_order: 'ranked' | 'citation' | 'unknown';
  retrieval_evidence: 'direct_response' | 'tool_result' | 'tool_execution' | 'none';
  model: string | null;
  request_id: string | null;
  tool_calls: number | null;
  cost_usd: number | null;
};
export type ErrorCode = 'invalid_input' | 'unsupported_option' | 'configuration' | 'authentication'
  | 'http_error' | 'timeout' | 'cancelled' | 'invalid_response' | 'retrieval_failed';
export type WebError = { code: ErrorCode; message: string };
export interface BaseResult {
  // Null only when selection failed before a provider could be chosen.
  provider: ProviderId | null;
  status: 'ok' | 'not_found' | 'error';
  // Provider excerpts and model synthesis must never be merged or substituted.
  sources: Source[];
  report: string | null;
  metadata: Metadata;
  warnings: string[];
  error: WebError | null;
}
export interface SearchResult extends BaseResult {
  operation: 'search';
  query: string;
  results: Source[];
}
export interface FetchResult extends BaseResult {
  operation: 'fetch';
  url: string;
  source_url: string | null;
  title: string | null;
  content: string | null;
}
export type RetrievalResult = SearchResult | FetchResult;
export type ToolResultData = RetrievalResult & { full_output_path: string | null };
export interface ProviderResponse<T extends RetrievalResult> {
  result: T;
  usage?: Usage;
}
export interface WebProvider {
  id: ProviderId;
  label: string;
  capabilities: { recencyFilter: boolean };
  // Local validation / credential resolution only: no paid availability probes.
  validate(context: ProviderContext): Promise<void>;
  search(input: SearchInput, context: ProviderContext): Promise<ProviderResponse<SearchResult>>;
  fetch(input: FetchInput, context: ProviderContext): Promise<ProviderResponse<FetchResult>>;
}
export class WebToolsError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'WebToolsError';
    this.code = code;
  }
}
export function emptyMetadata(): Metadata {
  return { result_order: 'unknown', retrieval_evidence: 'none', model: null, request_id: null, tool_calls: null, cost_usd: null };
}
