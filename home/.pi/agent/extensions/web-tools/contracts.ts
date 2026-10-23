import type { Usage } from '@earendil-works/pi-ai';

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

export type Source = {
  title: string;
  url: string;
  snippet: string | null;
  date: string | null;
  last_updated: string | null;
};
export type Metadata = {
  result_order: 'ranked' | 'unknown';
  retrieval_evidence: 'direct_response' | 'tool_result' | 'none';
  model: string | null;
  request_id: string | null;
  cost_usd: number | null;
};
export type ErrorCode = 'invalid_input' | 'configuration' | 'authentication'
  | 'http_error' | 'timeout' | 'cancelled' | 'invalid_response' | 'retrieval_failed';
export type WebError = { code: ErrorCode; message: string };
export interface BaseResult {
  status: 'ok' | 'not_found' | 'error';
  // Provider excerpts and model notes must never be merged or substituted.
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
export interface Retriever {
  search(input: SearchInput, signal?: AbortSignal): Promise<ProviderResponse<SearchResult>>;
  fetch(input: FetchInput, signal?: AbortSignal): Promise<ProviderResponse<FetchResult>>;
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
  return { result_order: 'unknown', retrieval_evidence: 'none', model: null, request_id: null, cost_usd: null };
}
