# Perplexity tools for Pi

Adds `perplexity_search` (ranked web results with excerpts) and
`perplexity_fetch` (content from a known HTTP/HTTPS URL). Pi discovers this
folder through `index.ts`.

## Configuration

Export `PERPLEXITY_API_KEY` in the environment that starts Pi, then restart Pi.
Optionally set `PERPLEXITY_API_BASE_URL` to override `https://api.perplexity.ai`.
Requests have a 60-second timeout and respect tool cancellation.

Large outputs are limited to 1000 lines or 25KB (half of Pi's defaults, to keep
web content lean). When truncated, the full Markdown is saved to a temporary
`output.md` file and its path is included in the result. Both tools remind the model to treat external text as untrusted and
to cite source URLs.

Both tools declare an `outputSchema`, so codemode scripts receive structured,
untruncated results instead of the Markdown text.

## Code map

- **`index.ts`** — entrypoint; registers search, then fetch.
- **`search.ts`** — search schema, execution, result details, and UI rendering.
- **`fetch.ts`** — fetch schema, execution, result details, and UI rendering.
- **`client.ts`** — authenticated POST requests, cancellation, and API errors.
- **`responses.ts`** — URL validation, response parsing, structured results, and Markdown formatting.
- **`output.ts`** — Pi truncation and full-output file persistence.

Start with the relevant tool file and follow its imports for shared behavior.
The input types remain exported from `index.ts`.

## Tests

Use Node.js 24 or newer (matching the surrounding Pi configuration):

```sh
# From the repository root:
node --test home/.pi/agent/extensions/perplexity/*.test.ts

# Or from home/.pi:
npm run test:perplexity
```

Tests import only Node's standard library and the dependency-free local
transport/response modules. They mock HTTP calls, require no API key or network
access, and need no dependency installation, compilation, or test framework.
Pi itself supplies the existing runtime dependencies used by the tool and
output modules.
