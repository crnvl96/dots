# perplexity

A Pi extension that exposes two web retrieval tools, independent of Pi's main chat model:

- `perplexity_search({ query, max_results?, search_context_size?, recency? })`: ranked web sources with extracted excerpts from Perplexity Search.
- `perplexity_fetch({ url, objective? })`: extracted content from a known HTTP(S) page through Perplexity's Agent API and its `fetch_url` tool.

Search is a direct Search API request, not a nested chat completion. Fetch uses a remote agent with fixed instructions. Neither request includes the Pi conversation, workspace files, or Pi system prompt; only the supplied tool inputs and the extension's request configuration are sent. The remote agent has no local shell/file tools.

## Installation and credentials

Source: `home/.pi/agent/extensions/perplexity/` in this dotfiles repo. Pi loads `index.ts`.

Pi normally discovers that directory from `~/.pi/agent/extensions/`, but `home/.pi/agent/settings.json` explicitly excludes it with `"-extensions/perplexity/index.ts"`. Its presence on disk does **not** mean it is enabled.

For a one-off isolated launch without changing settings:

```sh
export PERPLEXITY_API_KEY='your-key'
pi --no-extensions \
  -e ~/Documents/dotfiles/home/.pi/agent/extensions/perplexity
```

`--no-extensions` disables automatic extension loading (including built-ins); `-e` explicitly loads this extension. For persistent use, remove the exclusion from your own settings and let normal discovery load it. This documentation does not change settings.

Authentication uses **only** `PERPLEXITY_API_KEY` from Pi's process environment, trimmed of surrounding whitespace. There is no fallback to Pi's provider credentials or an OpenRouter key. Missing or whitespace-only keys fail before a network request.

If you add the export to `.zshrc`, start a fresh terminal (or source it) and **restart Pi**. `/reload` cannot import new shell environment variables into an already-running Pi process.

## API configuration

| Setting | Value |
| --- | --- |
| Default base URL | `https://api.perplexity.ai` |
| Optional base override | `PERPLEXITY_API_BASE_URL` |
| Search endpoint | `POST /search` |
| Fetch endpoint | `POST /v1/agent` |
| Authentication | `Authorization: Bearer <PERPLEXITY_API_KEY>` |
| Request encoding | JSON, with `Content-Type: application/json` |
| Request timeout | 60 seconds; combined with Pi's tool cancellation signal |
| Automatic retries | None |

The base override is trimmed, trailing slashes are removed, and a blank value falls back to the default. Endpoint paths are appended to it. Only use a trusted override: it receives the API key and request data.

HTTP failures include the status and an extracted API error message. When no structured message is available, the extension uses up to 1,000 characters of trimmed response text, then the status text or a generic fallback. Successful responses must parse as JSON objects; an empty successful body is treated as `{}` and still must satisfy the tool's response parser. Fetch timeout errors are translated to a 60-second timeout message; other transport/cancellation errors propagate.

## Tool parameters and requests

### `perplexity_search`

| Parameter | Schema / default | Behavior |
| --- | --- | --- |
| `query` | Required string, minimum length 1 | Sent as `query`; use separate calls for distinct subtopics |
| `max_results` | Optional integer, 1–20; default `8` | Sent as `max_results` |
| `search_context_size` | Optional `low`, `medium`, or `high`; default `medium` | Amount of extracted context per result |
| `recency` | Optional `hour`, `day`, `week`, `month`, or `year` | Sent as `search_recency_filter`; omitted when absent |

Example tool arguments:

```json
{
  "query": "latest TypeScript release official announcement",
  "max_results": 5,
  "search_context_size": "high",
  "recency": "month"
}
```

The response must contain a `results` array. The parser preserves response order and skips malformed entries: each accepted entry needs a nonempty string title and URL and a string snippet (which may be empty). Missing or non-string `date` and `last_updated` become `null`. The requested result count is not a guarantee; an empty parsed array returns a no-results message rather than an error.

### `perplexity_fetch`

| Parameter | Schema / default | Behavior |
| --- | --- | --- |
| `url` | Required string, minimum length 1 | Normalized with `URL`; must be absolute HTTP(S), without embedded credentials |
| `objective` | Optional string, minimum length 1 | Trimmed before use; blank/absent uses the default objective |

The default objective is: “Return enough of the page content for another assistant to summarize it.”

Example tool arguments:

```json
{
  "url": "https://www.typescriptlang.org/docs/",
  "objective": "Extract the sections relevant to migrating an existing project."
}
```

Each invocation sends one Agent API request with these fixed settings:

| Setting | Value |
| --- | --- |
| `preset` | `low` |
| `tools` | `[{ "type": "fetch_url", "max_urls": 1 }]` |
| `max_steps` | `2` |
| `max_output_tokens` | `1200` |
| `store` | `false` |

The input includes the normalized URL and objective. Input and instructions tell the agent to fetch exactly that URL, use only `fetch_url`, avoid searching or substituting pages, and briefly describe what was fetched. These are instructions and caps, not proof that the requested page was retrieved. `max_output_tokens` is the agent's output budget, not a documented extracted-page character limit. `store: false` is a request setting, not a broader claim about provider retention.

The parser takes the **first valid** content entry from `output` items of type `fetch_url_results`. It requires a nonempty URL and string snippet, and falls back to the URL when the title is absent or empty. It joins valid `output_text` parts from message items as fetch notes. It does not verify that the returned source URL equals the requested URL.

A response with `status: "failed"` throws. So does a response with neither parsed content nor nonempty notes. **Notes alone are accepted**: the Markdown explicitly says no `fetch_url_results` content was returned, and structured page fields are `null`. There is no server-tool execution counter check or general enforcement that every other status is final/successful.

## Result contract and limits

Both tools declare an `outputSchema` and return two representations:

- `content`: readable Markdown for the model, head-truncated at **1,000 lines or 25 KiB (25,600 bytes)**, whichever limit is reached first. A truncation notice is appended after that limit.
- `structuredContent`: untruncated parsed JSON for programmatic callers such as codemode scripts. This means no local Markdown truncation, **not** guaranteed full provider results or complete page text.

Search structured output:

```typescript
{
  query: string;
  results: {
    title: string;
    url: string;
    snippet: string;
    date: string | null;
    last_updated: string | null;
  }[];
}
```

Fetch structured output:

```typescript
{
  url: string;                 // Requested, normalized URL
  source_url: string | null;   // URL from the first parsed fetch result
  title: string | null;
  content: string | null;      // Extracted snippet, not the agent's notes
  notes: string | null;        // Joined assistant output text
}
```

If Markdown is truncated, its complete version is written to `output.md` inside a new OS temporary directory named `pi-perplexity-search-*` or `pi-perplexity-fetch-*`. The notice includes the file path and shown/total line and byte counts. The extension does not implement cleanup of these files. No file is written for untruncated output.

Tool `details` are separate from structured output:

- Search: query, optional request ID, parsed results, and optional truncation metadata/full-output path.
- Fetch: normalized URL, optional response ID/model, parsed content, snippet character count, optional API cost, and optional truncation metadata/full-output path.

Fetch cost is read only from a numeric `payload.usage.cost.total_cost` and stored as `details.costUsd`. Neither tool returns Pi's nested `usage` field. **The fetch cost shown in tool details/UI is not added to Pi's session usage totals by this extension**, and no nested token accounting is reported. Cost, request IDs, model, and temporary-file paths are not fields in either structured output schema.

## UI and retrieval limitations

The call display shows the search query or fetch URL. Progress displays “Searching Perplexity…” or “Fetching with Perplexity…”. Final collapsed results show a search result count or fetched title/URL plus extracted-snippet character count, with a truncation marker when applicable.

Expanded search results list titles and URLs. Expanded fetch results show the requested URL, optional model, and optional API cost formatted to six decimal places. Both show the full-output path when truncated. The custom expanded view is a summary, not the complete excerpts/page text. A notes-only fetch can still display “Fetched … (0 characters)”; inspect the actual result before treating that as successful page extraction.

Fetch is best-effort, not a raw HTTP/HTML downloader, and does not guarantee a full or verbatim page. It does not bypass login walls or paywalls. Remote accessibility and extraction quality can limit results. URL validation rejects unsupported protocols and embedded credentials; it is not a comprehensive private-network or hostname filter.

Tool guidance tells the model to cite source URLs and treat excerpts, page text, and fetch notes as untrusted external material, not instructions. Markdown also includes safety/citation reminders (except the short no-search-results message); head truncation can omit trailing reminders. These are behavioral guidance, not content sanitization or a guarantee against prompt injection. Fetch important search results before relying on details absent from their excerpts.

## Tests

From `home/.pi`:

```sh
# Offline tests; mocked transport, no live API calls or charges
npm run test:perplexity
```

The package requires Node.js 24 or newer. Tests live in `perplexity.test.ts` beside `index.ts`. Pi does not load them: a directory entry is only `index.ts`.

Coverage includes credentials and base URL handling, JSON headers/body, timeout signal creation, cancellation and timeout errors, API error extraction/fallbacks, malformed responses, search parsing/Markdown, URL normalization/rejection, fetch parsing/Markdown, cost extraction, and structured-content conversion/null defaults.

These are transport-helper and response-helper tests, **not live API or end-to-end registered-tool tests**. They do not exercise tool registration/execution, actual request construction by each tool, schema validation through Pi, truncation/temp-file writes, UI rendering, or codemode dispatch. Some transport tests use arbitrary paths such as `/v1/search` and `/chat/completions`; those are helper fixtures, not this extension's real endpoints. There is no Perplexity live-test script in the current package. Passing these tests does not establish live endpoint compatibility, retrieval quality, or accounting in Pi's session totals.
