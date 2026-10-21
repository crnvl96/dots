# /usage

A private, on-demand balance dashboard for Pi 1.3.0. Source: `home/.pi/agent/extensions/usage.ts`.

Run `/usage` to open a centered, theme-aware overlay with rounded borders, Codex usage bars, and provider balances. Each card loads independently; a failed provider does not block the others.

- **r** refreshes all providers (ignored while already loading).
- **Esc**, **Enter**, **q**, or **Ctrl+C** closes and cancels outstanding work.
- **↑ / ↓**, **Page Up / Page Down** scroll on shorter terminals.
- Narrow terminals wrap text; all output is bounded to the available terminal width.

The command requires Pi's interactive terminal mode. It does not write balances to the conversation, ask a model, spend inference credits, or poll in the background.

## Installation

Pi auto-discovers `~/.pi/agent/extensions/usage.ts`. This repository uses individual symlinks from that directory into `home/.pi/agent/extensions/`. Link this file in the same way as the other extensions, then run `/reload` (or restart Pi).

For a one-off explicit load:

```sh
pi -e ~/Documents/dotfiles/home/.pi/agent/extensions/usage.ts
```

No additional npm dependencies or settings changes are required. Restart Pi after exporting new environment variables; `/reload` cannot import a changed shell environment.

## Provider support

### OpenAI Codex — subscription usage

Reads the primary and secondary usage windows, their actual durations (typically 5 hours / 7 days), percentages **used**, and reset countdowns. It does not derive subscription usage from local session token totals or OpenAI API spend. Missing windows are not displayed as zero.

Authentication uses Pi's **`openai-codex`** provider. In Pi 1.3.0 this appears as **OpenAI Codex (legacy)** under `/login`. Pi resolves and refreshes the token; the account ID is extracted from its JWT in memory.

**Important:** Pi 1.3.0 also has an `openai` provider with a newer “Sign in with ChatGPT” direct-token flow. That token targets `api.openai.com` with a different scope. Its compatibility with the Codex usage endpoint is unverified, so this extension deliberately does not substitute it or an ordinary `OPENAI_API_KEY`. You may need to sign into the legacy Codex provider for this card even if the newer OpenAI provider already works for chat. You do not need to change your selected chat model.

Endpoint: `GET https://chatgpt.com/backend-api/wham/usage`, with bearer authentication and `ChatGPT-Account-Id`.

This is the endpoint used by the Codex backend client, **not a stable public billing API**. Access restrictions or upstream changes can make this card unavailable. Codex extra purchased credits, model-specific limits, and code-review quotas are not included in the two primary plan bars.

### OpenRouter — account credit balance

Endpoint: `GET https://openrouter.ai/api/v1/credits`.

Shows `total_credits - total_usage` in USD, including a genuine zero or negative balance. The detail line shows total usage and purchased credits. These are account totals, **not an individual key's spending allowance**.

OpenRouter's current reference specifies a **management key** for this endpoint. Configure a separate environment variable:

```sh
export OPENROUTER_MANAGEMENT_KEY='your-management-key'
```

Treat management keys as sensitive: they have broader privileges than inference keys. This extension uses the key only for the read-only credits endpoint and does not install it as your model credential.

Credential precedence:

1. `OPENROUTER_MANAGEMENT_KEY`
2. `OPENROUTER_API_KEY`
3. Pi's configured `openrouter` provider credential

The latter two are tried for accounts whose key has access. Registry credentials configured for a nonstandard OpenRouter endpoint are not forwarded to public OpenRouter; use the dedicated environment variable for the official account instead. Codex likewise rejects nonstandard configured origins. A `403` produces an explicit management-key-required message, not a fabricated balance. The extension does not silently replace account balance with `/api/v1/key` allowance data.

### Earendil Radius — organization funds

Uses Pi's configured `radius` provider credential, including its normal OAuth refresh or `RADIUS_API_KEY` support.

1. `GET /v1/context` resolves the credential's organization.
2. `GET /v1/organizations/{organizationId}/billing` reads live accounting state.

Shows **available** USD as the main value, with credit balance and reserved funds beneath. Available funds equal credit balance minus reservations and may be negative while prior requests settle. This is the credential's **organization**, not a separate personal balance. No organization ID is hardcoded.

The gateway comes from resolved provider-scoped `PI_RADIUS_GATEWAY`, process `PI_RADIUS_GATEWAY`, resolved auth base URL, or the first configured Radius model's base URL; otherwise it defaults to `https://radius.pi.dev`. Only its HTTPS origin is used for the root-level billing API routes. Embedded URL credentials, query strings, fragments, and HTTP gateways are rejected. Custom gateways must expose compatible context and billing endpoints.

### Perplexity — unavailable through the documented API

No documented remaining-credit endpoint was found. The card says **Not exposed by API** and points to:

<https://console.perplexity.ai/project/billing>

No Perplexity credential is read and no Perplexity request is sent. Enterprise historical credit-consumption analytics and individual request costs are not remaining account credits. The extension does not scrape browser sessions, read cookies, invent balance endpoints, or estimate credits from local usage.

## Privacy and failure handling

- All usage requests are read-only GETs; no model calls or billing mutations.
- Pi's credential resolver can refresh OAuth tokens and persist refreshed credentials as usual.
- Each provider has a 12-second deadline covering credential resolution and HTTP/body parsing.
- Closing the overlay cancels HTTP work and suppresses late results. Pi's credential-resolution API does not expose cancellation; an in-progress OAuth refresh may finish after closing, but no subsequent usage request is sent.
- Redirects are rejected. Credentials are sent only to the relevant provider endpoint (or configured Radius origin).
- Errors display safe local messages/status codes, never raw response bodies, bearer tokens, account IDs, organization IDs, or credential resolver errors.
- Results exist only in overlay memory. There are no balance caches, logs, transcript entries, or periodic timers.
- Values are formatted to cents, so a positive amount smaller than half a cent displays `$0.00`.

## Verification

From `home/.pi`:

```sh
npm run test:usage
tsc --noEmit
```

Tests use mocked transport and credentials: parser validation, real zero/negative balances, safe error handling, credential selection, organization lookup, custom gateway isolation, timeouts/cancellation, independent loading, refresh/close lifecycle, non-TUI guards, and ANSI-aware width/height constraints. They do not verify live provider permissions or replace an interactive visual smoke test.

## References

- [Codex usage backend](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)
- [OpenRouter credits reference](https://openrouter.ai/docs/api/api-reference/credits/get-credits.md)
- [OpenRouter key allowance reference](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key.md)
- [Radius public OpenAPI](https://radius.pi.dev/v1/openapi.json)
- [Perplexity API documentation](https://docs.perplexity.ai/)
