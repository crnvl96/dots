# web-tools

One Pi extension with two tools, both backed by **Perplexity**:

```typescript
web_search({ query, max_results?, search_context_size?, recency? })
web_fetch({ url, objective? })
```

Search uses Perplexity's direct `/search` API. Fetch uses the Agent API (`/v1/agent`) with only the `fetch_url` tool exposed. Pi's main model is independent of web retrieval. No conversation history, workspace files, Pi system prompt, or local tools are sent to Perplexity—only tool inputs and fixed retrieval instructions/configuration.

## Configuration: one file

**Edit [`config.ts`](config.ts), then `/reload`.** All user-adjustable defaults live in its single `config` object, with inline comments. Settings are validated once when the extension loads; an invalid value, including a malformed API-root override, fails the load with a `configuration` error instead of failing each tool call.

| Setting | Default | Purpose |
| --- | --- | --- |
| `search.maxResults` | `8` | Default requested results, 1–20 |
| `search.contextSize` | `medium` | Per-result context budget: low/medium/high |
| `fetch.defaultObjective` | Summarizable page content | Extraction objective when omitted |
| `output.maxLines` / `maxBytes` | 1,000 / 25,600 | Model-facing Markdown limits |
| `perplexity.timeoutMs` | 60,000 | Whole-request timeout |
| `perplexity.fetch` | low / 2 steps / 1,200 tokens | Agent preset and budgets |

### Credentials

- `PERPLEXITY_API_KEY` (required; no Pi credential fallback).
- Optional trusted API-root override: `PERPLEXITY_API_BASE_URL`.

Environment variable names and the default endpoint are in `config.ts`. Never put secrets in source. Restart Pi after adding environment exports; `/reload` cannot import new shell environment variables. API-root overrides receive your credentials and inputs, so use only trusted endpoints.

## Contract

Both tools return source-first Markdown to the main model, and untruncated structured JSON to codemode. Common fields:

```typescript
{
  status: "ok" | "not_found" | "error",
  sources: [{ title, url, snippet, date, last_updated }],
  report: string | null,  // Fetch agent notes, never a source excerpt
  metadata: {
    result_order: "ranked" | "unknown",
    retrieval_evidence: "direct_response" | "tool_result" | "none",
    model: string | null,
    request_id: string | null,
    cost_usd: number | null,
  },
  warnings: string[],
  error: { code, message } | null,
  full_output_path: string | null
}
```

Search adds `operation: "search"`, `query`, and `results` (same as `sources`, in Perplexity rank order). Fetch adds `operation: "fetch"`, `url`, `source_url`, `title`, and `content`.

- `snippet` is a provider-returned excerpt (possibly empty). Missing dates and costs stay null, not invented values.
- Fetch `content` is the excerpt whose normalized URL **exactly matches the requested URL**. Redirects and unrelated sources do not count; a fetch with no matching source is an error. All returned sources remain visible separately.
- Fetch requires `fetch_url` tool-result evidence; agent notes alone never establish retrieval. Explicit failed/non-final statuses are errors. An empty extracted page is `not_found` and is not replaced by notes.
- Search always returns `report: null`.
- Failures return `isError: true` with a structured error. No-results is distinct from failure. Error codes: `invalid_input`, `configuration`, `authentication`, `http_error`, `timeout`, `cancelled`, `invalid_response`, `retrieval_failed`. No automatic retry.

Both remain best-effort extraction, not raw HTML or a complete/verbatim page guarantee. Neither bypasses paywalls or authentication.

## Output, UI, privacy, and cost

Renderers display progress, source counts, errors/no-results, and truncation. Expanded views add sources, warnings, evidence, model, cost, and full-output path.

Markdown is capped at configured line/byte limits; a notice is appended after truncation. Full Markdown is written only when needed, into an OS temporary directory with a mode-0600 file. No automatic cleanup is implemented. Structured data is not locally truncated, but provider-side limits still apply.

All web content is untrusted. Safety/citation instructions appear before excerpts; this is guidance, not prompt-injection sanitization. HTTP(S) validation blocks embedded credentials and other protocols, but is **not a comprehensive private-network/SSRF filter**. Requests never follow HTTP redirects, so credentials are not forwarded.

Perplexity usage is forwarded to Pi when available. Unknown per-category cost allocation is not fabricated; structured metadata keeps `cost_usd: null` when unknown.

## Layout

```text
index.ts             Pi entry point
config.ts            All user-adjustable settings, inline docs, load-time validation
schemas.ts           Tool input/output schemas: the source of truth for result types
contracts.ts         Types derived from schemas, retriever interface, errors
perplexity.ts        Perplexity Search/Agent API adapter and response parsing
prompts.ts           Main-agent guidance and safety rules
tools.ts             Input normalization, execution, error results, Pi adaptation
formatting.ts        Markdown, truncation, private output files
rendering.ts         UI
transport.ts         URL policy, JSON requests, cancellation, timeout, redacted errors
tests/               Offline adapter, tool, and transport tests
```

Source in this repo: `home/.pi/agent/extensions/web-tools/`. Pi discovers only the directory's `index.ts`. An isolated launch is:

```sh
pi --no-extensions -e ~/Documents/dotfiles/home/.pi/agent/extensions/web-tools
```

## Tests

From `home/.pi`:

```sh
npm run test:web-tools
npm exec --yes --package=typescript -- tsc --noEmit
npm exec --yes --package=typescript -- npm run typecheck:web-tools  # source + tests

# Explicit paid opt-in; not part of the offline suite:
WEB_TOOLS_LIVE_TEST=1 npm run test:web-tools:live

# Optional evidence file (outside this repo):
WEB_TOOLS_LIVE_TEST=1 WEB_TOOLS_TEST_EVIDENCE=/tmp/web-tools-live.json npm run test:web-tools:live
```

The live script uses the registered tools and makes two searches and one fetch. Live API compatibility is not established by offline tests.

API reference: https://docs.perplexity.ai/
