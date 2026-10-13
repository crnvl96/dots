# pi-codex-subagents

Codex-shaped, session-scoped subagents for [Pi](https://github.com/earendil-works/pi). Spawn isolated child Pi processes, receive their final responses automatically, steer active work, and inspect sessions in a live overlay.

Requires Pi 0.80.4 or newer and Node.js 24 or newer.

## Dotfiles port

Vendored from [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions/tree/e34f816ec8234f9b012bf6e19f9b94c19d123d03/packages/pi-codex-subagents), version 0.3.5, commit `e34f816ec8234f9b012bf6e19f9b94c19d123d03`. Original MIT license and attribution are preserved in `LICENSE`.

This directory is managed by mise's `symlink-each` dotfiles configuration and auto-loaded from `~/.pi/agent/extensions/codex-subagents/index.ts`. Apply the dotfiles with `mise dotfiles apply`, then restart Pi or run `/reload`. Do not also install the npm package: that would register the same tools twice.

Local changes for Pi 1.1.0:

- Accept explicit `builtin:*` extension identifiers in child configuration.
- Type the overlay's heterogeneous built-in tool registry for Pi's generic tool definitions.
- `home/.pi/agent/pi-codex-subagents/config.json` explicitly enables `builtin:codemode` and the local Perplexity extension in children. Other extensions, including MCP, remain disabled unless explicitly configured. Model and thinking inherit from the parent.
- Store runs in `~/.local/state/pi-codex-subagents/runs`, outside the dotfiles checkout. Retention remains seven days.
- Support provider-scoped tiers via `providerAgents` in the configuration. With this setting, these tiers replace Markdown templates; `agent_type` is required and caller model/thinking overrides are disabled. Malformed routing, unsupported providers, unavailable models, and unsupported thinking levels fail rather than silently falling back.

### Configured tiers

The parent's **current provider** selects the column, including after `/model` changes. There are exactly four agent types:

| `agent_type` | `openai` | `anthropic` and `radius` | Thinking |
|---|---|---|---|
| `light` | `gpt-6-luna` | `claude-haiku-5-5` | `max` |
| `medium` | `gpt-5.6-terra` | `claude-sonnet-5-5` | `high` |
| `high` | `gpt-6.1-sol` | `claude-opus-5-5` | `high` |
| `max` | `gpt-6-astra` | `claude-fable-5-1` | `high` |

Routes use the exact provider ID above, not another provider serving the same model. Direct `anthropic` needs its own authentication; Radius credentials do not enable the Anthropic provider. No role prompts or Markdown templates are added. The existing system prompt and other settings are unchanged.

## Development

### Code map

`index.ts` wires one manager to the parent session's events, completion delivery,
activity widget, tools, and browser. Start there to follow the extension lifecycle.

| Location | Responsibility |
|---|---|
| `runtime/types.ts`, `constants.ts` | Shared data contracts and defaults |
| `runtime/normalization.ts` | Pure configuration/template parsing, validation, and text helpers |
| `runtime/config.ts`, `paths.ts` | Configuration, templates, system prompt, and directory locations |
| `runtime/storage.ts` | Session-scoped records, atomic persistence, retention, and full tool outputs |
| `runtime/resources.ts` | Explicit skill and extension resolution for children |
| `runtime/process.ts` | Process identity, ownership checks, and active/peek markers |
| `runtime/jsonl.ts`, `stream.ts` | Incremental RPC framing and assistant-delta assembly |
| `runtime/events.ts` | Child logging and live-event broadcasting to overlays |
| `runtime/manager.ts` | Recovery, child launch/RPC, finalization, waits, steering, and shutdown |
| `tools/spawn.ts`, `models.ts` | Dynamic spawn schema, validation, and model allowlist resolution |
| `tools/control.ts`, `helpers.ts`, `output.ts` | Wait/list/read/send/interrupt tools and shared result helpers |
| `ui/browser.ts`, `peek.ts`, `format.ts` | Agent browser, live detail overlay, and plain-text labels |
| `test/` | Unit tests, lifecycle/rendering regression tests, resolver, and fake RPC child |

`core.ts` and `peek.ts` retain their previous exports as compatibility facades.
New code should import the focused module it needs. The manager and detail overlay
remain cohesive classes: their state and cleanup stay together rather than being
spread across mutually dependent modules. Section comments in the manager mark
its lifecycle phases.

### Tests

All tests use Node.js 24's standard-library test runner and assertions. No test
framework or new dependency is added.

The **34 unit tests** import only stdlib-backed local modules. They need no Pi
installation, npm install, network access, or API credentials. From the repository
root:

```bash
npm --prefix home/.pi/agent/extensions/codex-subagents run test:unit
```

The existing **52 regression tests** exercise child-process lifecycle, completion
delivery, dynamic tools, and actual Pi rendering. They retain their existing SDK
imports and fake RPC child. Run everything from `home/.pi`:

```bash
npm ci
# TypeScript is provided by the dotfiles' mise tools. The flag also permits
# the Perplexity extension's native-Node .ts imports during the shared check.
tsc -p tsconfig.json --allowImportingTsExtensions
npm run test:subagents
```

Or run `npm test` inside this extension directory once the surrounding Pi SDK
dependencies are installed.

`home/.pi/package.json` pins the SDK's transitive `pi-codemode` dependency to 1.1.0;
1.2.0 removes an export required by Pi 1.1.0. The full suite isolates each file in
its own process so the core suite's module mock cannot affect the overlay suite.
It enables experimental TypeScript transformation (for parameter properties)
and module mocking, with a test-only resolver for local `.js` imports backed by
`.ts` source files. The unit-only command needs neither experimental flag.
Regression tests use unique temporary storage and fake child processes, with no
paid model requests.

## Tools

| Tool | Purpose |
|---|---|
| `spawn_agent` | Spawn a fresh-context child Pi process |
| `wait_agent` | Block for one completion and return its final text |
| `wait_all_agents` | Block until every selected agent finishes |
| `list_agents` | List current-session agents, or explicitly include historical sessions |
| `read_agent_response` | Read an agent's latest final raw text response |
| `send_message` | Steer a running agent or start another turn when settled |
| `interrupt_agent` | Abort the current turn while preserving its session for later messages |

Agent names are unique within their parent session. The same task name can exist safely in different Pi sessions. Read and control tools are always scoped to the current parent session; only `list_agents(include_all: true)` crosses session boundaries, and that view is read-only.

## Agent templates

Templates are user-defined Markdown files in:

```text
~/.pi/agent/pi-codex-subagents/agents/*.md
```

No templates are installed automatically. Example:

```md
---
name: reviewer
description: Focused read-only code review agent
provider: openai-codex
model: gpt-5.6-sol
thinking: high
tools: read,bash,grep,find,ls
skills: web-investigate
extensions: @scope/pi-extra-tools, ~/.pi/agent/extensions/local-helper.ts
hint: Give this reviewer exact file paths and a narrow scope.
---
You are a focused review subagent. Return concise findings with file paths.
```

`provider` and `model` are an optional pair. When both are present, Pi launches that exact provider/model combination. If either is absent, the child inherits the parent agent's provider and model. `thinking` is also optional and otherwise inherits the parent. Template `tools` override inherited tool names.

`skills` may contain skill names or paths. `extensions` may contain local files/directories or npm package names already installed by Pi. Package names are resolved from project-local packages first and then Pi's global npm directory. Missing packages are never installed automatically.

When a template loads extensions but omits `tools`, the child uses Pi's normal tool activation so tools registered by those extensions are available. Set template `tools` when you want an explicit allowlist. Without configured extensions, omitted template tools inherit the parent's active tool names as before.

Automatic extension, skill, prompt-template, and context-file discovery is disabled in children. `AGENTS.md` and `CLAUDE.md` files are never loaded. Each child replaces Pi's default coding prompt with the contents of `~/.pi/agent/pi-codex-subagents/SYSTEM.md`, while only explicitly configured skills and extensions load. This file is created with a minimal subagent prompt when the extension first loads and can be edited directly. If the inherited parent model comes from an extension-registered provider, add that provider extension to the selected template; otherwise the isolated child cannot resolve the provider.

## Configuration

Optional configuration lives at:

```text
~/.pi/agent/pi-codex-subagents/config.json
```

```json
{
  "storageDir": "~/.local/state/pi-codex-subagents/runs",
  "retentionDays": 7,
  "modelResponseTimeoutMs": 600000,
  "models": ["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-4-6"],
  "modelsFromEnabledModels": true,
  "defaults": {
    "skills": ["web-investigate"],
    "extensions": ["@scope/pi-extra-tools"]
  }
}
```

`storageDir` accepts an absolute path, `~/...`, or a path relative to the package configuration directory. By default runs are stored in `~/.pi/agent/pi-codex-subagents/runs`. `retentionDays` defaults to `7`; expired runs and oversized tool outputs are removed when the extension loads. Set it to `0` to disable automatic cleanup. Runtime sockets remain in the operating system temporary directory and are removed when agents stop.

`modelResponseTimeoutMs` limits one model response, from assistant message start to completion, and defaults to 10 minutes. It does not limit tool execution or the agent's total runtime. A response that keeps streaming forever is failed and its child process is terminated so waiters cannot block indefinitely. Set it to `0` to disable this guard.

`shortcut` optionally binds a key to the subagent browser, for example `"shortcut": "ctrl+shift+a"`. No shortcut is assigned by default; omit it or set it to `""` to leave it unbound. Run `/reload` after changing it.

Configuration is read when agents spawn, while cleanup runs when the extension loads. Restart Pi after changing `storageDir` or `retentionDays` so storage lookup and cleanup use the same configuration throughout the process.

Template skills and extensions override configured defaults. Skills explicitly requested by the parent are added to configured template/default skills. Tool selection belongs to the template or is inherited from the parent. Without `providerAgents`, a `model` and `thinking` level requested by the parent override the template and inherited values, so one task can run on another model without a template. With the dotfiles' `providerAgents` configuration, provider/model/thinking are fixed by the chosen tier instead.

## Model routing

An allowlist in `config.json` decides whether a parent may request a `model` and a `thinking` level per spawn, and which models it may pick. Both arguments appear together or not at all: an installation that configures nothing keeps routing in templates and inheritance. Two sources may be combined:

- `models` lists exact `provider/model-id` pairs approved for this extension alone, independent of any Pi setting.
- `modelsFromEnabledModels: true` adds the models Pi already scoped for the session, resolved from the `enabledModels` setting and `--models`. Models approved for the installation need no second approval here, and Pi has already expanded globs, preferred aliases over dated versions, and dropped unavailable entries. When Pi has no model scoping configured, this source adds nothing.

The arguments are offered only when at least one allowed model is available, and `model` enumerates exactly those pairs:

| Configuration | Allowed and available | `model` and `thinking` on the tool |
|---|---|---|
| neither key set | — | absent, routing belongs to templates |
| `"modelsFromEnabledModels": true`, Pi scoping unset | — | absent |
| `"modelsFromEnabledModels": true`, Pi scoping set | 2 models | present, `model` lists those 2 pairs |
| `"models": ["typo/xyz"]` | nothing available | absent, entry reported as a notification |
| both keys set | the union, deduplicated | present, `model` lists the union |

The list is resolved when a session starts: `models` entries are filtered to what is currently available, unavailable entries are reported as a warning notification, and the scoped models are merged in. Editing the configuration or the Pi setting takes effect when the next session starts, matching the `storageDir` and `retentionDays` behavior above. If a provider drops out mid-session, `spawn_agent` refuses that model at spawn time instead of serving a stale route.

An allowed model may belong to an extension-registered provider. Route to one only from a template that loads that provider extension, since children load none of their own.

A thinking level written into an `enabledModels` pattern, such as `anthropic/claude-opus-4-6:high`, is ignored here. `thinking` stays a separate argument, and the child clamps it to what its model supports.

## Completion delivery

A child completion or failure is delivered automatically to its parent session after the child reaches final status. If the parent is active, the result joins the current run; if the parent is idle, it starts a continuation turn. Continue independent work instead of waiting. Use `wait_agent` or `wait_all_agents` only when the next action depends on those responses and no useful work remains meanwhile; an active wait receives the result directly without a duplicate automatic message.

## Commands and TUI

While agents are starting or running, a compact one-line indicator appears above the editor. It shows the task name for one active agent or a count for multiple agents and points to `/subagents`. The indicator disappears when no agents are active.

`/subagents` opens the agent browser for the current session. Each row shows the task name, status, elapsed time, model, and thinking level, with the task preview underneath. Long names are shortened to fit the terminal. Press Tab to switch to the read-only all-sessions view, then Enter to open an agent.

The overlay uses the child working directory for tool rendering and synchronizes in-progress output when opened midway through a run. Use Left/Right to switch between agents in the current browser scope.

Child RPC processes are terminated after completion, failure, or interruption so settled agents do not keep consuming memory. `send_message` starts a fresh child process with the persisted session and continues from there. On startup, the extension also reconciles and terminates validated owned children left behind by an earlier extension process.

## Output limits

Automatic completions, wait tools, and response tools follow Pi's standard 50 KB / 2,000-line output limit. Oversized output is truncated and the complete text is written beside the runtime data; the returned notice includes a path that can be read with Pi's `read` tool.

## Environment

`PI_SUBAGENT_PI_BIN` overrides the Pi executable used for child processes. Normally children use the same Pi installation as the parent.

## License

MIT
