import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Check } from 'typebox/value';
import type { Static } from 'typebox';
import { SearchParams, SearchOutputSchema, FetchOutputSchema, type SearchArgs } from '../schemas.ts';
import { emptyMetadata, type ErrorCode, type Metadata, type Source } from '../contracts.ts';

// Compiled by tsconfig.test.json. These must remain literal unions, not never,
// undefined, or string; runtime schema tests alone cannot catch that regression.
const recencies = ['hour', 'day', 'week', 'month', 'year'] satisfies NonNullable<SearchArgs['recency']>[];
const evidence = ['direct_response', 'tool_result', 'none'] satisfies Metadata['retrieval_evidence'][];
const codes = ['invalid_input', 'configuration', 'authentication', 'http_error', 'timeout', 'cancelled', 'invalid_response', 'retrieval_failed'] satisfies ErrorCode[];
function rejectedTypes() {
  // @ts-expect-error Unsupported recency must not widen to string.
  const recency: SearchArgs['recency'] = 'decade';
  // @ts-expect-error Evidence must remain an explicit union.
  const retrieval: Metadata['retrieval_evidence'] = 'invented';
  // @ts-expect-error Unknown error codes must not typecheck.
  const code: ErrorCode = 'invented';
  // @ts-expect-error Accepted sources always contain a string snippet.
  const snippet: Source['snippet'] = null;
  return { recency, retrieval, code, snippet };
}
void rejectedTypes; // Type-only regression assertions; never execute them.

test('schema-derived types admit valid recencies, evidence, and error codes', () => {
  for (const recency of recencies) assert.ok(Check(SearchParams, { query: 'q', recency }));
  for (const retrieval_evidence of evidence) {
    for (const code of codes) {
      const common = {
        status: 'error' as const, sources: [], report: null, warnings: [], full_output_path: null,
        metadata: { ...emptyMetadata(), retrieval_evidence }, error: { code, message: 'test error' },
      };
      const search = { ...common, operation: 'search', query: 'q', results: [] } satisfies Static<typeof SearchOutputSchema>;
      const fetch = { ...common, operation: 'fetch', url: 'https://example.com/', source_url: null, title: null, content: null } satisfies Static<typeof FetchOutputSchema>;
      assert.ok(Check(SearchOutputSchema, search));
      assert.ok(Check(FetchOutputSchema, fetch));
    }
  }
});
