import type { Usage } from '@earendil-works/pi-ai';
import type { Static } from 'typebox';
import type { FetchOutputSchema, SearchArgs, SearchOutputSchema } from './schemas.ts';

// Result types are derived from the output schemas in schemas.ts.
export type ToolResultData = Static<typeof SearchOutputSchema> | Static<typeof FetchOutputSchema>;
export type SearchResult = Omit<Static<typeof SearchOutputSchema>, 'full_output_path'>;
export type FetchResult = Omit<Static<typeof FetchOutputSchema>, 'full_output_path'>;
export type RetrievalResult = SearchResult | FetchResult;
export type Operation = RetrievalResult['operation'];
export type Source = RetrievalResult['sources'][number];
export type Metadata = RetrievalResult['metadata'];
export type WebError = NonNullable<RetrievalResult['error']>;
export type ErrorCode = WebError['code'];

export type ContextSize = NonNullable<SearchArgs['search_context_size']>;
export type Recency = NonNullable<SearchArgs['recency']>;
export interface SearchInput {
  query: string;
  max_results: number;
  search_context_size: ContextSize;
  recency?: Recency;
}
export interface FetchInput { url: string; objective: string }

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
export function resultInput(result: RetrievalResult): string {
  return result.operation === 'search' ? result.query : result.url;
}
