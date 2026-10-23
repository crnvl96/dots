import { Type, type Static } from 'typebox';

// Single source of truth for tool inputs and outputs; contracts.ts derives its
// types from these. Unions are spelled out as literal tuples: building them
// with .map() erases the literal types and turns Static<> into never.
const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const SearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: 'A focused web search query. Use separate calls for distinct subtopics.' }),
  max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: 'Maximum results requested. Defaults to config.ts.' })),
  search_context_size: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
    description: 'Relative per-result context budget. Defaults to config.ts.',
  })),
  recency: Type.Optional(Type.Union([
    Type.Literal('hour'), Type.Literal('day'), Type.Literal('week'), Type.Literal('month'), Type.Literal('year'),
  ], { description: 'Publication-recency filter.' })),
}, { additionalProperties: false });
export const FetchParams = Type.Object({
  url: Type.String({ minLength: 1, description: 'Absolute HTTP(S) URL without embedded credentials.' }),
  objective: Type.Optional(Type.String({ minLength: 1, description: 'What to extract or focus on. Defaults to config.ts.' })),
}, { additionalProperties: false });
export type SearchArgs = Static<typeof SearchParams>;
export type FetchArgs = Static<typeof FetchParams>;

const SourceSchema = Type.Object({
  title: Type.String(), url: Type.String(),
  snippet: Type.String({ description: 'Provider-returned excerpt, never model synthesis; may be empty.' }),
  date: NullableString, last_updated: NullableString,
});
const common = {
  status: Type.Union([Type.Literal('ok'), Type.Literal('not_found'), Type.Literal('error')]),
  sources: Type.Array(SourceSchema),
  report: Type.Union([Type.String(), Type.Null()], { description: 'Separate model-written fetch notes, not guaranteed verbatim page text.' }),
  metadata: Type.Object({
    result_order: Type.Union([Type.Literal('ranked'), Type.Literal('unknown')]),
    retrieval_evidence: Type.Union([Type.Literal('direct_response'), Type.Literal('tool_result'), Type.Literal('none')]),
    model: NullableString, request_id: NullableString, cost_usd: NullableNumber,
  }),
  warnings: Type.Array(Type.String()),
  error: Type.Union([Type.Object({
    code: Type.Union([
      Type.Literal('invalid_input'), Type.Literal('configuration'), Type.Literal('authentication'), Type.Literal('http_error'),
      Type.Literal('timeout'), Type.Literal('cancelled'), Type.Literal('invalid_response'), Type.Literal('retrieval_failed'),
    ]),
    message: Type.String(),
  }), Type.Null()]),
  full_output_path: NullableString,
};
export const SearchOutputSchema = Type.Object({ ...common, operation: Type.Literal('search'), query: Type.String(), results: Type.Array(SourceSchema) });
export const FetchOutputSchema = Type.Object({
  ...common, operation: Type.Literal('fetch'), url: Type.String(), source_url: NullableString, title: NullableString,
  content: Type.Union([Type.String(), Type.Null()], { description: 'Provider excerpt matching the requested URL, or null. Never substituted with a model report.' }),
});
