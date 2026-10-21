# openrouter-web-search

A Pi extension that exposes two retrieval tools, independent of Pi's main chat model:

- `openrouter_web_search({ query, max_results?, search_context_size? })`: provider source annotations/excerpts first, followed by a separate model-processed report.
- `openrouter_web_fetch({ url, objective? })`: model-processed content from the specified HTTP(S) page, with provider excerpts kept separate when available. It does not offer a raw HTTP/HTML response or guarantee a full, verbatim page.

Only the query/URL/objective is sent to the nested model, not the Pi conversation, workspace files, or system prompt. There are no local shell/file tools available to that model. No Parallel account or API key is needed.

## Fixed configuration

| Setting | Value |
| --- | --- |
| API | `https://openrouter.ai/api/v1/chat/completions` |
| Model | `openai/gpt-6.1-sol` |
| Search engine / mode | `parallel` / `advanced` |
| Results per search | `max_results: 8` by default; configurable from 1–20 |
| Search context | `search_context_size: medium` by default; `low`, `medium`, or `high` |
| Search calls per invocation | `max_uses: 1` |
| Fetch engine | `parallel` (advanced mode applies to search, not extraction) |
| Fetch calls per invocation | `max_uses: 1` |
| Fetch input content cap | `max_content_tokens: 50000` |
| Outer server-tool step budget | `max_tool_calls: 1` |
| Model output budget | `max_tokens: 8000` |
| Request timeout | 180 seconds; respects Pi cancellation |

Each Pi tool invocation makes one completion request and exposes only its corresponding server tool, with a one-call budget instead of an iterative research loop. There are no automatic retries, to avoid replaying paid retrievals. The model still mediates retrieval, unlike Perplexity's direct Search API; equal latency, cost, ranking, or excerpts are not guaranteed.

Search controls follow Perplexity's names and defaults where the OpenRouter integration supports them:

```json
{ "query": "TypeScript release official announcement", "max_results": 5, "search_context_size": "high" }
```

`max_results` caps engine results per call, not the number of returned citation annotations. The integration documents a Parallel range of 1–25; this extension intentionally exposes 1–20 to match the Perplexity interface. `search_context_size` controls total excerpt characters across results, not per-result length. No `max_characters` override is sent. `recency` is intentionally absent: the integration documentation does not establish a Parallel date filter, and a prompt-based hint would not enforce one.

Fetch's default objective is “Return enough of the page content for another assistant to summarize it.”

## Installation and credentials

Source: `home/.pi/agent/extensions/openrouter-web-search/` in this dotfiles repo. Pi loads `index.ts`.

The user extension path `~/.pi/agent/extensions/openrouter-web-search` links to that directory. Pi discovers `index.ts` automatically. Tests and this README sit beside it and are not loaded. Existing extension settings are not changed by this implementation.

Authentication uses, in order:

1. `OPENROUTER_API_KEY` from Pi's process environment.
2. Pi's configured OpenRouter credential, resolved through `ctx.modelRegistry.getApiKeyForProvider('openrouter')`.

No key is stored in this repo. If you just added the export to `.zshrc`, start a fresh terminal (or run `source ~/.zshrc`) and **restart Pi**. `/reload` loads extension changes but cannot import new environment variables from your shell into an already-running Pi process.

For a one-off isolated launch:

```sh
pi --no-extensions \
  -e ~/Documents/dotfiles/home/.pi/agent/extensions/openrouter-web-search
```

## Result contract

Both tools provide structured data to codemode and readable Markdown to the main model:

- `operation`, `input`, `status` (`ok`, `not_found`, `error`)
- `report`: model-processed retrieval report; not guaranteed verbatim
- `sources`: provider `url_citation` annotations, with `url`, `title`, and optional `excerpt`
- `request_id`, `model`, `tool_calls`, `cost_usd`
- `full_output_path`: temporary Markdown file when the readable output is truncated

The original fields above are preserved. Additional Perplexity-style fields are returned according to the operation:

```typescript
// Search additions
{
  query: string;
  results: {
    title: string; url: string; snippet: string;
    date: null; last_updated: null;
  }[];
}

// Fetch additions
{
  url: string;
  source_url: string | null;
  title: string | null;
  content: string | null;
  notes: string;
}
```

Search `results` are mapped exclusively from provider citations, in citation order—not guaranteed relevance ranking or a complete engine result list. Missing excerpts become empty snippets; dates remain null because this parser has no provider date metadata. The model's report never supplies snippets or fabricated citations.

Fetch `content`, `source_url`, and `title` come only from a provider citation whose normalized URL exactly matches the requested URL. Without one, these fields are null. An unverified redirect or unrelated citation does not count as the requested page. A matching citation without an excerpt still has null `content`. `notes` contains the model-processed report, which may include useful extracted information but is not guaranteed verbatim page text. All citations remain available in `sources`, even if they do not match the request.

The text output is source-first and limited to 1,000 lines / 25 KiB; structured output is untruncated so scripts can select the portions they need. Temporary full-output files use private permissions. Fetch responses may have an empty `sources` array: the live API does not always annotate fetched pages. The requested URL remains in `input`, and the model is instructed to include the source URL in its report.

The extension rejects responses without API-reported server-tool execution rather than treating a memory-only model answer as a successful search/fetch. Execution counts prove the server tool ran, **not** that every source was accessible or every model claim is correct. Model-reported retrieval failures are marked `isError`; no-results is distinct from failure. Non-final, refused, malformed and HTTP error responses fail explicitly.

Search annotations are provider excerpts; the report is a separate model summary/extraction. All web material is labeled untrusted and should be cited, not followed as instructions. Private URLs, logins, paywalls, JavaScript-only pages, or remote fetch failures may prevent retrieval.

Pi receives nested token usage and the OpenRouter-reported total cost (including retrieval). Per-category cost fields are zero because cached-token and tool-cost allocation cannot be inferred reliably; the total is authoritative.

## UI

Custom call renderers show the query or URL. Collapsed search results show the source-citation count (not a claimed ranked-result count); results without annotations explicitly say “report only.” Fetch shows matching provider-excerpt character counts, or explicitly says there is only a model report. Errors and `not_found` are not rendered as successful fetches.

Expanded results list titles/URLs, model, executed tool count, API cost, and the full-output path when truncated. Error/no-results reports are also shown when expanded. As in the Perplexity extension, the expanded UI is a summary, not the complete retrieved text. Rendering is independent of retrieval, so JSON/codemode callers still receive structured data.

## Tests

From `home/.pi`:

```sh
# Offline tests; no API key or charges
npm run test:openrouter-web-search

# Live calls through both registered tools; requires a key and incurs charges
OPENROUTER_LIVE_TEST=1 npm run test:openrouter-web-search:live

# Optional: save live-test evidence outside the repository
OPENROUTER_LIVE_TEST=1 \
OPENROUTER_TEST_EVIDENCE=/tmp/openrouter-web-search-live.json \
npm run test:openrouter-web-search:live

# Typecheck extension code (fetches the compiler if not cached)
npm exec --yes --package=typescript -- tsc --noEmit
```

Offline tests cover transport, validation, isolated requests, search-control forwarding, additive output fields and provenance, source-first formatting, truncation/private files, status handling, UI renderers, and usage accounting.

The opt-in live test uses the same environment-key / Pi credential fallback as the extension. It exercises default search, search with `max_results: 3` and `search_context_size: high`, and fetch. It checks successful retrieval, source URLs, model identity, exactly one confirmed server-tool call, compatibility fields, and nested usage/cost reporting. It does not require a fixed citation count.

The post-refactor live run passed all three cases using Pi's configured credential fallback:

| Case | Source citations | Duration | Reported cost (USD) |
| --- | --- | --- | --- |
| Default search | 8 | 13.098 s | $0.019829 |
| Search: 3 results, high context | 3 | 18.282 s | $0.0162085 |
| Fetch | 0 | 10.985 s | $0.0104395 |

Total reported cost was $0.046477. Each request executed exactly one server tool. Fetch returned a useful model-processed report without provider annotations, so `content`, `source_url`, and `title` correctly remained null. The configured search succeeded, but this smoke test does not establish the exact excerpt-size effect of `high` versus `medium`, ranking quality, or general retrieval reliability. Evidence for this local run was saved outside the repo at `/tmp/openrouter-web-search-live-parity.json`.

An end-to-end smoke test can also exercise actual Pi extension loading and tool dispatch:

```sh
pi --no-extensions -e ./agent/extensions/openrouter-web-search \
  --no-mcp --no-skills --no-prompt-templates --no-context-files --no-session \
  --model openrouter/openai/gpt-6.1-sol --thinking minimal \
  --tools openrouter_web_search,openrouter_web_fetch --mode json \
  'Call openrouter_web_search to find the official Parallel OpenRouter integration docs, then openrouter_web_fetch on https://docs.parallel.ai/integrations/openrouter to extract the engine setting. Finish with a brief confirmation.'
```

This also incurs main-model charges. The extension itself does not require Pi's main model to use OpenRouter.

## API references

- https://openrouter.ai/docs/guides/features/server-tools
- https://openrouter.ai/docs/guides/features/server-tools/web-search
- https://openrouter.ai/docs/guides/features/server-tools/web-fetch
- https://docs.parallel.ai/integrations/openrouter

Compatibility note: live Chat Completions responses report execution counters under `usage.server_tool_use_details`; the extension also accepts the documented `usage.server_tool_use`. The output shape is repeated explicitly in the system prompt because live testing found that `response_format` alone did not reliably constrain the final answer after OpenRouter's internal tool loop.
