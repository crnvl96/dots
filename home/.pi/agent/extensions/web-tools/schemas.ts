import { Type, type Static } from 'typebox';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const SearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: 'A focused web search query. Use separate calls for distinct subtopics.' }),
  max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: 'Maximum engine results requested. Defaults to config.ts; citation count can differ.' })),
  search_context_size: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
    description: 'Relative retrieval context budget; exact sizes and per-result/total semantics vary by engine. Defaults to config.ts.',
  })),
  recency: Type.Optional(Type.Union(['hour', 'day', 'week', 'month', 'year'].map(value => Type.Literal(value)), {
    description: 'Enforced publication-recency filter. Supported by the Perplexity provider only; other providers return unsupported_option, never silently ignore it.',
  })),
}, { additionalProperties: false });
export const FetchParams = Type.Object({
  url: Type.String({ minLength: 1, description: 'Absolute HTTP(S) URL without embedded credentials.' }),
  objective: Type.Optional(Type.String({ minLength: 1, description: 'What to extract or focus on. Defaults to config.ts.' })),
}, { additionalProperties: false });
export type SearchArgs = Static<typeof SearchParams>;
export type FetchArgs = Static<typeof FetchParams>;

const SourceSchema = Type.Object({
  title: Type.String(), url: Type.String(),
  snippet: Type.Union([Type.String(), Type.Null()], { description: 'Provider-returned excerpt, never model synthesis; null when absent.' }),
  date: NullableString, last_updated: NullableString,
});
const common = {
  provider: Type.Union([Type.Literal('openrouter'), Type.Literal('perplexity'), Type.Null()], { description: 'Selected provider; null only when selection failed before dispatch.' }),
  status: Type.Union([Type.Literal('ok'), Type.Literal('not_found'), Type.Literal('error')]),
  sources: Type.Array(SourceSchema),
  report: Type.Union([Type.String(), Type.Null()], { description: 'Separate model-written report/notes, not guaranteed verbatim page text.' }),
  metadata: Type.Object({
    result_order: Type.Union([Type.Literal('ranked'), Type.Literal('citation'), Type.Literal('unknown')]),
    retrieval_evidence: Type.Union(['direct_response', 'tool_result', 'tool_execution', 'none'].map(value => Type.Literal(value))),
    model: NullableString, request_id: NullableString, tool_calls: NullableNumber, cost_usd: NullableNumber,
  }),
  warnings: Type.Array(Type.String()),
  error: Type.Union([Type.Object({
    code: Type.Union(['invalid_input', 'unsupported_option', 'configuration', 'authentication', 'http_error', 'timeout', 'cancelled', 'invalid_response', 'retrieval_failed'].map(value => Type.Literal(value))),
    message: Type.String(),
  }), Type.Null()]),
  full_output_path: NullableString,
};
export const SearchOutputSchema = Type.Object({ ...common, operation: Type.Literal('search'), query: Type.String(), results: Type.Array(SourceSchema) });
export const FetchOutputSchema = Type.Object({
  ...common, operation: Type.Literal('fetch'), url: Type.String(), source_url: NullableString, title: NullableString,
  content: Type.Union([Type.String(), Type.Null()], { description: 'Provider excerpt matching the requested URL, or null. Never substituted with a model report.' }),
});
