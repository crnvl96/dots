# openrouter-web-search

A Pi extension that exposes two retrieval tools, independent of Pi's main chat model:

- `openrouter_web_search({ query })`: sourced retrieval report plus OpenRouter's source annotations/excerpts.
- `openrouter_web_fetch({ url, objective? })`: model-processed content from the specified HTTP(S) page. It does not offer a raw HTTP/HTML response or guarantee a full, verbatim page.

Only the query/URL/objective is sent to the nested model, not the Pi conversation, workspace files, or system prompt. There are no local shell/file tools available to that model. No Parallel account or API key is needed.

## Fixed configuration

| Setting | Value |
| --- | --- |
| API | `https://openrouter.ai/api/v1/chat/completions` |
| Model | `openai/gpt-6.1-sol` |
| Search engine / mode | `parallel` / `advanced` |
| Results per search | `max_results: 10` |
| Search calls per invocation | `max_uses: 10` |
| Fetch engine | `parallel` (advanced mode applies to search, not extraction) |
| Fetch calls per invocation | `max_uses: 10` |
| Fetch input content cap | `max_content_tokens: 50000` |
| Outer server-tool step budget | `max_tool_calls: 10` |
| Model output budget | `max_tokens: 8000` |
| Request timeout | 180 seconds; respects Pi cancellation |

Each Pi tool invocation makes one completion request and exposes only its corresponding server tool. The model can use fewer than 10 calls; these are limits, not targets. A search can yield more than 10 total source annotations when the model searches several times. There are no automatic retries, to avoid replaying paid retrievals.

## Installation and credentials

Source: `home/.pi/agent/extensions/openrouter-web-search.ts` in this dotfiles repo.

The user extension path `~/.pi/agent/extensions/openrouter-web-search.ts` links to that file. Pi discovers it automatically. Existing extension settings are not changed by this implementation.

Authentication uses, in order:

1. `OPENROUTER_API_KEY` from Pi's process environment.
2. Pi's configured OpenRouter credential, resolved through `ctx.modelRegistry.getApiKeyForProvider('openrouter')`.

No key is stored in this repo. If you just added the export to `.zshrc`, start a fresh terminal (or run `source ~/.zshrc`) and **restart Pi**. `/reload` loads extension changes but cannot import new environment variables from your shell into an already-running Pi process.

For a one-off isolated launch:

```sh
pi --no-extensions \
  -e ~/Documents/dotfiles/home/.pi/agent/extensions/openrouter-web-search.ts
```

## Result contract

Both tools provide structured data to codemode and readable Markdown to the main model:

- `operation`, `input`, `status` (`ok`, `not_found`, `error`)
- `report`: model-processed retrieval report; not guaranteed verbatim
- `sources`: provider `url_citation` annotations, with `url`, `title`, and optional `excerpt`
- `request_id`, `model`, `tool_calls`, `cost_usd`
- `full_output_path`: temporary Markdown file when the readable output is truncated

The text output is limited to 1,000 lines / 25 KiB; structured output is untruncated so scripts can select the portions they need. Temporary full-output files use private permissions. Fetch responses may have an empty `sources` array: the live API does not always annotate fetched pages. The requested URL remains in `input`, and the model is instructed to include the source URL in its report.

The extension rejects responses without API-reported server-tool execution rather than treating a memory-only model answer as a successful search/fetch. Execution counts prove the server tool ran, **not** that every source was accessible or every model claim is correct. Model-reported retrieval failures are marked `isError`; no-results is distinct from failure. Non-final, refused, malformed and HTTP error responses fail explicitly.

Search annotations are provider excerpts; the report is a separate model summary/extraction. All web material is labeled untrusted and should be cited, not followed as instructions. Private URLs, logins, paywalls, JavaScript-only pages, or remote fetch failures may prevent retrieval.

Pi receives nested token usage and the OpenRouter-reported total cost (including retrieval). Per-category cost fields are zero because cached-token and tool-cost allocation cannot be inferred reliably; the total is authoritative.

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

The live test checks successful search/fetch, source URLs, model identity, positive server-tool execution counts, and nested usage/cost reporting. It intentionally does not assert exactly 10 results or calls: caps are not guaranteed counts.

An end-to-end smoke test can also exercise actual Pi extension loading and tool dispatch:

```sh
pi --no-extensions -e ./agent/extensions/openrouter-web-search.ts \
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
