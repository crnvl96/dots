# web-tools

One Pi extension, two stable tools, interchangeable retrieval providers:

```typescript
web_search({ query, max_results?, search_context_size?, recency? })
web_fetch({ url, objective? })
```

Supported providers: **OpenRouter** (default) and **Perplexity**. Both operations switch together. Pi's main model is independent of the web provider. No conversation history, workspace files, Pi system prompt, or local tools are sent to the retrieval service—only tool inputs and fixed retrieval instructions/configuration.

## Configuration: one file

**Edit [`config.ts`](config.ts), then `/reload`.** All user-adjustable defaults live in its single `config` object, with inline comments documenting purpose, available options, caveats, and precedence. No separate web-tools settings JSON is required.

The main settings are:

| Setting | Default | Purpose |
| --- | --- | --- |
| `defaultProvider` | `openrouter` | Provider for both tools in new sessions |
| `search.maxResults` | `8` | Default requested results, 1–20 |
| `search.contextSize` | `medium` | Relative retrieval-context budget: low/medium/high |
| `fetch.defaultObjective` | Summarizable page content | Extraction objective when omitted |
| `output.maxLines` / `maxBytes` | 1,000 / 25,600 | Model-facing Markdown limits |
| `openrouter.model` | `openai/gpt-6.1-sol` | Nested retrieval model, not Pi's model |
| `openrouter.search.engine` / `mode` | `parallel` / `advanced` | Search backend and mode |
| `openrouter.ranking.model` | `typesafe/jev-1.13` | OpenRouter classifier for search relevance |
| `openrouter.ranking.maxResults` | `5` | Maximum selected excerpts, also capped by the call's `max_results` |
| `openrouter.ranking.minScore` | `1.5` | Minimum expected relevance on a 0–3 scale |
| `openrouter.ranking.timeoutMs` | `30,000` | Separate classification deadline |
| `openrouter.fetch.engine` | `parallel` | Extraction backend |
| `openrouter.fetch.maxContentTokens` | 50,000 | Extractor input-content limit |
| `openrouter.maxOutputTokens` | 8,000 | Nested model output budget |
| `openrouter.timeoutMs` | 180,000 | Retrieval-request timeout (ranking has a separate deadline) |
| `perplexity.timeoutMs` | 60,000 | Whole-request timeout |
| `perplexity.fetch` | low / 2 steps / 1,200 tokens | Agent preset and budgets |

OpenRouter search supports explicit `parallel`, `exa`, or `perplexity` engines; fetch supports `parallel`, `exa`, `openrouter`, or `firecrawl`. `config.ts` lists valid mode combinations and explains why upstream `auto`/`native` options are not exposed. Other engine/model configurations are not automatically considered live-verified. Changing the OpenRouter **engine** to `perplexity` still uses OpenRouter credentials/billing and does not select the direct **Perplexity provider** or enable its recency filter.

### Credentials

- OpenRouter: `OPENROUTER_API_KEY`, then Pi's configured `openrouter` credential. The fallback can be disabled in `config.ts`. Both Sol retrieval and Jev classification use the same resolved credential. Jev runs through Pi's OpenRouter classifier catalog/API; changing the chat `endpoint` does not redirect classification.
- Perplexity: `PERPLEXITY_API_KEY` only.
- Optional trusted Perplexity API-root override: `PERPLEXITY_API_BASE_URL`.

Environment variable names and endpoints are also centralized in `config.ts`. Never put secrets in source. Restart Pi after adding environment exports; `/reload` cannot import new shell environment variables. API-root overrides receive your credentials and inputs, so use only trusted endpoints.

### Provider selection

```text
/web status
/web provider                 # interactive selection
/web provider perplexity
/web provider openrouter
/web provider reset           # clear saved session override
```

A successful selection validates local configuration and credential availability without a paid probe. Invalid selections leave the previous provider unchanged. It does not prove that the credential is valid remotely or has sufficient balance.

Selection is saved in the **active session branch**, restored on reload/resume/fork/tree navigation, and does not modify source configuration. Precedence:

1. Saved session-branch override.
2. `--web-provider openrouter|perplexity` CLI flag.
3. `config.ts` → `defaultProvider`.

Reset returns to CLI/config selection. New sessions use the CLI/config default. To change the default globally, edit `defaultProvider`. Commands wait until idle; each tool call also captures its provider before its first await. Historical results always show the provider that actually handled them.

Explicit commands work without a terminal UI; the picker requires a supported UI. Tools, structured output, and provider configuration work in TUI, RPC, JSON, and print modes. Invalid saved/CLI selection fails closed rather than silently sending data to another provider.

## Contract

Both tools return source-first Markdown to the main model, and untruncated structured JSON to codemode. Common fields:

```typescript
{
  provider: "openrouter" | "perplexity" | null, // Null only for selection failure
  status: "ok" | "not_found" | "error",
  sources: [{ title, url, snippet, date, last_updated }],
  report: string | null,  // Separate model-written report, never a source excerpt
  metadata: {
    result_order: "ranked" | "citation" | "unknown",
    retrieval_evidence: "direct_response" | "tool_result" | "tool_execution" | "none",
    model: string | null,
    request_id: string | null,
    tool_calls: number | null,
    cost_usd: number | null,
    ranking?: { // OpenRouter search only, when relevance selection was attempted
      model: string, status: "ranked" | "fallback", candidates: number, selected: number,
      scores: { url: string, score: number }[]
    }
  },
  warnings: string[],
  error: { code, message } | null,
  full_output_path: string | null
}
```

Search adds `operation: "search"`, `query`, and `results` (the same provider sources). Fetch adds `operation: "fetch"`, `url`, `source_url`, `title`, and `content`.

- `snippet` is a provider-returned excerpt or null. Missing dates and costs stay null, not invented values.
- Fetch `content` is a provider excerpt whose normalized URL **exactly matches the requested URL**. Unverified redirects and unrelated citations do not count. All returned sources remain visible separately.
- `report` contains remote-model synthesis/notes when applicable. OpenRouter search always returns `report: null`. Reports are never substituted for `content` or `snippet`.
- Retrieval evidence proves only the stated API/tool behavior, not the truth of every claim or access to every source.
- Retrieval/selection failures return `isError: true` with a structured error. No-results is distinct from failure. Pi's own argument-schema validation and invalid extension configuration can fail before execution.
- Standard errors cover invalid input, unsupported options, configuration/authentication, HTTP/transport, timeout, cancellation, invalid provider responses, and retrieval failure. No automatic retry or cross-provider fallback occurs.

### Provider differences

| Concern | Perplexity | OpenRouter |
| --- | --- | --- |
| Search | Direct `/search` API | Sol invokes one server search tool; Jev scores original annotation excerpts |
| Source order | Ranked results | Jev relevance order; citation order with explicit warning if classification fails |
| `recency` | hour/day/week/month/year | Explicit `unsupported_option` error; never ignored |
| Context size | Provider-defined per-result budget | Engine-dependent; Parallel uses total context |
| Fetch | Agent API with `fetch_url` | Nested model invokes one server fetch tool |
| Notes-only fetch | Error: no tool-result evidence | Can be report-only success **if API confirms execution** |
| Fetch URL mismatch | Error; notes/sources retained | Null page fields with warning; report may remain useful |

The stable contract guarantees consistent interpretation, not identical ranking, latency, cost, excerpts, or provider evidence. OpenRouter requires a confirmed single server-tool execution and a final, valid status response (plus a report for fetch only). Perplexity fetch requires a matching tool result and rejects explicit failed/non-final statuses. Empty extracted text is not replaced by notes. Both remain best-effort extraction, not raw HTML or a complete/verbatim page guarantee. Neither bypasses paywalls or authentication.

### OpenRouter search: Sol → Jev → original excerpts

1. Sol invokes the configured search engine once, then emits only a status object—not a generated retrieval report.
2. Code extracts provider `url_citation` annotations, validates/canonicalizes URLs, and deduplicates URLs in citation order. Missing or whitespace-only excerpts are ineligible. Excerpt strings are never trimmed, paraphrased, or generated by either model.
3. Jev receives the query and eligible results in one classification request, with a relevance-score question per result. The scale runs from 0 (unrelated) to 3 (directly useful); fractional scores are expected values, not truth probabilities.
4. Code sorts by descending score (ties preserve citation order), applies `minScore`, and selects at most `min(max_results, ranking.maxResults)` original source records. By default, search requests up to eight engine results and returns at most five selected excerpts.

The output includes titles, validated URLs, unchanged excerpts, and ranking metadata—not Sol's prose. `ranking.scores` includes all scored candidates, even those not selected. Jev scores usefulness, not factual correctness. Broad queries do not implicitly request current news.

Classification failure, timeout, unavailable model, or malformed scores return eligible excerpts in original citation order, capped to the same count, with `ranking.status: "fallback"` and a warning. There is no retry or model/provider substitution. Caller cancellation remains cancellation. An entirely low-scoring batch returns `not_found`; a claimed successful search with no usable provider excerpts returns an error rather than model-generated evidence.

**Verbatim means unchanged from the provider-returned excerpts**, not full original webpages. Annotations can be incomplete or truncated upstream; local Markdown truncation is still explicit. Jev cannot recover omitted search results or repair incorrect source material. Web fetch and the direct Perplexity provider do not use this ranking stage.

## Output, UI, privacy, and cost

Shared renderers display provider, progress, source counts, report-only cases, errors/no-results, and truncation. Expanded views add sources, warnings, evidence, model, confirmed call count, cost, and full-output path. They are summaries, not the entire page text.

Markdown is capped at configured line/byte limits; a notice is appended after truncation. Full Markdown is written only when needed, into an OS temporary directory with a mode-0600 file. No automatic cleanup is implemented. Structured data is not locally truncated, but provider-side excerpt/token limits still apply.

All web content is untrusted. Safety/citation instructions are shared across providers and appear before excerpts; this is guidance, not prompt-injection sanitization. HTTP(S) validation blocks embedded credentials and other protocols, but is **not a comprehensive private-network/SSRF filter**. Requests do not forward credentials through HTTP redirects.

Retrieval usage and classifier usage are combined and forwarded to Pi when available. Jev costs come from Pi's classifier usage accounting (catalog pricing); combined `metadata.cost_usd` stays null if either stage's cost is unknown. Unknown per-category allocation is not fabricated. Pi's numeric usage fields require zero placeholders for unavailable categories, whereas structured metadata retains null for unknown total cost. Parser/transport failures before a normalized response can lack accounting even if a remote request was billed.

## Layout and adding providers

```text
index.ts             Pi entry point
config.ts            All user-adjustable settings, with inline documentation
contracts.ts         Provider protocol and canonical result types
schemas.ts           Stable tool input/output schemas
selection.ts         CLI/command selection and branch persistence
prompts.ts           Shared main-agent guidance and safety rules
tools.ts             Validation, execution, errors, Pi usage/result adaptation
formatting.ts        Markdown, truncation, private output files
rendering.ts         Shared UI
transport.ts         JSON requests, cancellation, timeout, redacted errors
providers/           Provider registry + isolated adapters
tests/               Offline contract, adapter, transport, UI and selection tests
```

Implement `WebProvider` (`validate`, `search`, `fetch`) and register it in `providers/index.ts`. Add its ID to the contract/output schema, configuration/comments, and shared contract tests. Both operations are mandatory; capabilities declare optional controls. Adapters receive cancellation, a narrow credential resolver, and an OpenRouter classifier callback—not the Pi conversation or tool API. Adapters return normalized data/usage; they never register Pi tools, format final Markdown, or render UI. Provider-internal prompts remain in adapters because direct APIs and model-mediated retrieval need different instructions.

## Migration / installation

This replaces `extensions/perplexity/` and `extensions/openrouter-web-search/`; only `extensions/web-tools/index.ts` should be loaded. Synchronize your dotfiles links after migration and `/reload`. Old tool names are intentionally not registered as aliases. Update any external scripts, tool allowlists, or custom prompts to use `web_search` / `web_fetch` and the new output contract.

Source in this repo: `home/.pi/agent/extensions/web-tools/`. Pi discovers only the directory's `index.ts`. An isolated launch is:

```sh
pi --no-extensions -e ~/Documents/dotfiles/home/.pi/agent/extensions/web-tools \
  --web-provider openrouter
```

## Tests

From `home/.pi`:

```sh
npm run test:web-tools
npm exec --yes --package=typescript -- tsc --noEmit

# Explicit paid opt-in; not part of the offline suite:
WEB_TOOLS_LIVE_TEST=1 npm run test:web-tools:live -- openrouter
WEB_TOOLS_LIVE_TEST=1 npm run test:web-tools:live -- perplexity

# Optional evidence file (outside this repo):
WEB_TOOLS_LIVE_TEST=1 WEB_TOOLS_TEST_EVIDENCE=/tmp/web-tools-live.json \
  npm run test:web-tools:live -- openrouter
```

The live script uses registered shared tools and the same credential resolution as the extension. Each invocation makes two searches and one fetch; OpenRouter searches also make a Jev classification request. The smoke test requires successful ranking, nonempty excerpts, and no generated search report. Live API compatibility/quality is not established by offline tests.

API references for engine settings:
- https://openrouter.ai/docs/guides/features/server-tools/web-search
- https://openrouter.ai/docs/guides/features/server-tools/web-fetch
- https://docs.parallel.ai/integrations/openrouter
