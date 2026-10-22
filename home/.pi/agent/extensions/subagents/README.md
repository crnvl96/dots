# subagents

An in-process Pi extension for selectively delegating substantial, well-bounded tasks to background agents. Children have isolated conversations and share the parent's working directory and callable tools. The parent can keep working while they run.

Source: `home/.pi/agent/extensions/subagents/`. Pi loads `index.ts`. `definitions.ts` discovers reusable agent definitions; `catalog.ts` advertises them to the parent. Session/runtime/tool modules handle launches, and the dashboard displays jobs.

## Delegation policy

**Work directly by default.** Independence alone is not a reason to spawn a child. The launch tool's description and parent prompt guidelines require a clear benefit that outweighs startup, context gathering, and coordination overhead, unless the user explicitly requests subagents:

- **Parallel progress:** a substantial independent workstream while the parent continues useful, non-overlapping work.
- **Context isolation:** broad exploration or high-volume logs/test output that would crowd the parent conversation.
- **Independent verification:** a separate assessment of a consequential change.

Keep routine searches, a few file reads, small edits, ordinary test commands, and tightly coupled planning/implementation/testing in the parent. Use parallel tool calls for simple concurrency. Keep the immediate critical path local rather than launching a child and immediately waiting, unless isolation or independent verification warrants the handoff.

Normally start with **one or two children**, not one per file, command, or phase. Add more only for clearly justified substantial workstreams. Give each child a bounded outcome, necessary context, relevant paths, constraints, file ownership, and expected concise evidence/results. Do not repeat delegated work in the parent; review and integrate its findings instead.

These are **model-facing guidelines, not runtime limits**. Explicit launches still work, larger batches are supported, and no classifier, extra model call, approval gate, or hard concurrency cap is added. Tests protect the registered guidance; they do not prove that every model will follow it.

## Tools

| Tool | Purpose |
| --- | --- |
| `subagents_list({})` | Rescan named agent definitions and return names, descriptions, source paths, and validation diagnostics; not running jobs. |
| `subagents_launch({ tasks })` | Start a batch of children, optionally using named definitions, and immediately return IDs and task metadata. |
| `subagents_steer({ id, prompt })` | Queue guidance for a running child, or recover the result if it has already finished. |
| `subagents_status({ id? })` | Inspect progress without waiting; an exact ID includes the available final report. |
| `subagents_wait({ ids, timeoutMs? })` | Wait for all selected children and return their reports; an optional timeout returns current snapshots without stopping them. |
| `subagents_discard({ ids })` | Release retained finished reports after reviewing and integrating them. |

Completion reports arrive automatically. **Do not poll status in a loop.** Use status to diagnose a job or recover a report; use wait when the next step depends on one or more children's results.

## Named agent definitions

The extension discovers Markdown agent definitions automatically, advertises their names/descriptions in the parent's system prompt, and loads the selected body into the child's system prompt **in code**. The child does not have to read its definition file to acquire its role. Supporting skills/references linked from that body still need to be read as instructed.

Discovery recursively scans:

- User: `~/.agents/agents/` and `~/.claude/agents/`.
- Trusted project: `.agents/agents/` and `.claude/agents/` from the working directory up to the nearest repository root (`.git` directory or worktree file). Outside a repository, only the working directory is scanned.

Nearest project definitions override ancestor projects, which override user definitions. At each directory, `.agents` takes precedence over `.claude`. Symlinked files/directories are followed, canonical paths deduplicate aliases, and directory cycles are skipped. Filenames need not match the declared name. Duplicate names within one discovery root keep the first file in sorted traversal order and produce a diagnostic.

Project definitions are skipped unless Pi reports the project trusted. The extension does not execute scripts or hooks while discovering files. It rescans at each parent turn, list call, and named launch, so additions, edits, and removals take effect without restarting. A launch snapshots its selected bodies; already-running children keep their original instructions.

Example definition:

```markdown
---
name: correctness-reviewer
description: Review changed code for correctness and security defects.
---
Review only; do not modify files. Report verified findings with path:line evidence.
```

Supported frontmatter is `name`, `description`, and optional `model: inherit`. The body must be nonempty. Names are lowercase kebab-case starting with a letter, at most 64 characters. Definitions are limited to 128 KiB. The canonical source path and base directory are injected with the body so relative references resolve from the definition, not the reviewed workspace.

This is Claude-style discovery, **not full Claude configuration compatibility**. Other frontmatter (including `tools`, `disallowedTools`, model aliases, `permissionMode`, hooks, and memory settings) rejects the definition with a diagnostic; it is never silently treated as enforced. Select model, provider, effort, and exact Pi tools through the existing launch fields. Definitions with a recognizable name but invalid settings block lower-priority definitions of that name. If malformed YAML or an unreadable file prevents name identification, the diagnostic explains that a lower-priority definition may still be available.

Use `subagents_list` to inspect the current catalog and errors. Listing returns metadata, not full bodies. A missing/invalid requested type fails the whole launch batch before any child starts or job IDs are reserved. Generic tasks that omit `agent` behave as before.

```json
{
  "tasks": [
    {
      "name": "review-parser",
      "agent": "correctness-reviewer",
      "prompt": "Review the uncommitted changes in src/parser.ts.",
      "tools": ["read", "bash"]
    }
  ]
}
```

`name` is the unique job ID; `agent` is the reusable definition's frontmatter name. Several jobs can use the same definition. Named jobs include `agentType` and `agentFile` in launch/status/wait snapshots. System-prompt order is the inherited parent prompt, the child-session instructions, the selected role, then the optional task append. This preserves the extension's parent-inheritance contract instead of replacing it with a standalone role prompt.

Discovery and body loading are deterministic, but choosing a suitable named agent from its description is still a model decision. For a guaranteed selection, explicitly request that name or set `tasks[].agent` when calling the tool. No background review is launched just because a definition exists.

## Launching children

```json
{
  "tasks": [
    {
      "name": "review-parser",
      "prompt": "Review src/parser.ts for edge cases. Do not edit files; report findings with file paths.",
      "thinkingLevel": "high",
      "tools": ["read", "bash"]
    },
    {
      "name": "write-tests",
      "prompt": "Write parser regression tests. Own only tests/parser.test.ts; do not edit implementation files. Run the tests and report results."
    }
  ]
}
```

Each task supports:

| Field | Default / behavior |
| --- | --- |
| `name` | Required short, meaningful kebab-case name, e.g. `review-parser`. This is the agent identifier shown in the UI and used by every tool. 1–48 characters; lowercase ASCII letters/digits with single hyphens between segments, starting with a letter. Must be unique in the session, even after discard or history eviction. |
| `prompt` | Required, nonblank, self-contained task. |
| `agent` | Optional exact frontmatter name from `subagents_list`. Its body and canonical source directory are automatically inserted into the child system prompt. |
| `model` | Parent model ID. Must resolve with the selected provider. |
| `provider` | Parent provider. |
| `thinkingLevel` | Parent context's thinking level, falling back to Pi's current setting. Accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Provider/model support still applies. |
| `tools` | The same tool set a new Pi session would have: built-ins, extension tools, codemode, and MCP. Supply exact names to choose a subset; `[]` disables tools. `subagents_ask` stays available unless the list is empty. |
| `appendSystemPrompt` | Extra text appended after the parent session's effective system prompt and the child-only appendix. It does not replace the parent prompt. An empty string is ignored. |

The entire batch is validated before any child starts, including missing/invalid names and duplicate names within the batch or session. A rejected batch reserves no names. Children then run concurrently with separate names and Agent instances.

**Names are IDs, not aliases.** Pass `"review-parser"` in the `id` field of steer/status and in the `ids` arrays of wait/discard. Launch results and completion reports use that same name unchanged; there is no public UUID or prefix lookup. Use a new name (such as `review-parser-followup`) for subsequent work. Internal provider session IDs remain separate.

Names stay reserved until session cleanup so stale tool calls or queued notifications cannot be confused with a different child. Only the short name strings are reserved—not the discarded jobs, prompts, or reports.

There is no built-in concurrency limit, deadline, automatic retry, or per-child spend cap; use modest batches and stop unwanted work.

A child does **not** inherit the parent conversation. It always receives the parent session's effective system prompt. It inherits the parent model, thinking level, Pi settings, tools, extensions, and MCP servers unless the task overrides those. A selected `agent` adds its role instructions after the inherited prompt and child appendix. `appendSystemPrompt` follows the role; neither replaces the parent prompt. It is a separate in-memory Pi session in the same workspace. File ownership should be explicit when children can edit the same files.

The default comes from `ctx.tools`, not the parent's active model declarations. Callable tools are declared directly to the child even when the parent accesses them through codemode. Hidden, model-only, and otherwise non-callable tools are not inherited.

Child tools run inside the child session, with that session's extensions and permission hooks. Tool selection is **not a security sandbox**. `subagents_ask` is injected so a child can tell the parent about a gap or a needed decision immediately. The parent receives that as a steering message and can steer the child or ask the user.

### Structured launch result

```json
{
  "ids": ["review-parser", "write-tests"],
  "agents": [
    {
      "id": "review-parser",
      "prompt": "Review src/parser.ts for edge cases...",
      "model": "<selected-model>",
      "provider": "<selected-provider>",
      "status": "running",
      "activity": "Starting",
      "pendingSteers": 0,
      "elapsedMs": 0,
      "notification": "pending",
      "error": null,
      "notificationError": null,
      "result": null,
      "fullOutputPath": null
    }
  ]
}
```

This abbreviated example illustrates one snapshot; the actual `agents` array contains one entry per launched ID. State can advance before the launch returns. Legacy tool-result `details.ids` remains available. Codemode receives the structured object rather than needing to parse a sentence containing agent names.

## Completion delivery and steering

A completed, failed, or manually stopped child sends one custom message containing:

- Its ID and final status.
- A short task description, with full task/model/provider metadata in message details.
- The last assistant response and an error message when applicable.
- A full-response file path if the report was truncated.

Reports use Pi's **steering queue** with `triggerTurn: true`. While the parent is busy, they are made available at a safe model-turn boundary **after the current tool batch finishes**, not injected between a tool call and its result. When the parent is idle, they trigger a new turn. Pi's configured steering queue policy applies, so several reports may be consumed across several turns.

This fixes the previous follow-up behavior: reports could wait behind a long-running parent tool loop until after the parent gave its final answer. During that interval, steering the completed child only returned “not running,” leaving the parent without its findings.

Guidance to a child follows the same safe-boundary principle:

```json
{ "id": "review-parser", "prompt": "Focus on malformed input. Do not change the public API." }
```

The result is `{ "accepted": true, "agent": { ...snapshot } }` when queued. It does not interrupt an in-flight tool.

If the child is completed, failed, stopped, or already stopping, the tool returns **`accepted: false`**, its status, and the available bounded report. This is a normal completion race, not a tool error. The guidance was not sent, and the child is **never silently restarted**. Launch a new task if more work is required. Unknown/expired IDs and blank guidance are errors.

Provider errors and aborts are hard exits; queued guidance cannot restart a failed request. Manual stop clears queued guidance.

## Waiting for dependencies

Use `subagents_wait` to hold the parent's tool call until **all** selected children have finished and report preparation/enqueueing has settled:

```json
{ "ids": ["review-parser", "write-tests"] }
```

The result is `{ "timedOut": false, "agents": [ ...snapshotsWithResults ] }`, in the requested ID order. A failed or manually stopped child also finishes a wait: **check each `status` and `error`**, not just `timedOut`, before proceeding. Already-finished children return immediately. Unselected children continue independently.

An optional deadline bounds only this wait, not the children:

```json
{ "ids": ["review-parser"], "timeoutMs": 60000 }
```

If it expires, the tool returns `timedOut: true` and current snapshots, including any reports already available. Omitting `timeoutMs` waits without a deadline; valid values are integers from 1 to 2147483647 milliseconds. Cancelling the parent wait does **not** stop the children. A session change/shutdown cancels pending waits and children according to the lifecycle rules below.

IDs must be exact, unique, nonempty, and retained when the wait begins. An in-flight wait keeps references to its selected jobs even if finished history is pruned. Waiting is event-driven and makes no provider requests. Automatic completion notifications remain enabled and may repeat reports returned by the wait; the wait does not consume or acknowledge them. It waits for report preparation, **not** for the parent to read a queued notification. A notification failure still returns the recoverable report with `notification: failed`.

For a substantial review where separate assessments justify the handoff, waiting immediately is appropriate. This is not the default pattern for small tasks. For example, in codemode:

```javascript
const launched = await tools.subagents_launch({ tasks: [
  { name: "review-parser", prompt: "Review src/parser.ts. Do not edit files; report edge cases." },
  { name: "review-tests", prompt: "Review tests/parser.test.ts. Do not edit files; report coverage gaps." },
] });
const result = await tools.subagents_wait({ ids: launched.ids });
text(result); // Inspect every child status and report before the dependent step.
```

## Inspecting status and recovering results

```json
{}
```

Lists retained jobs with activity, model/provider, elapsed time, queued-guidance count, status, and notification state. The list intentionally omits final report bodies.

```json
{ "id": "review-parser" }
```

Returns one snapshot with its available final report. Inspection never waits for a running child and makes no model/API call. IDs for tools must be exact kebab-case names; prefixes and aliases are not accepted.

Snapshot states:

- `status`: `running`, `stopping`, `completed`, `failed`, or `stopped`.
- `activity`: live, automatically derived detail such as `Starting`, `Thinking`, `Writing response`, `Running <tool names>`, or `Working`, followed by the final outcome. Displayed in the widget and dashboard; no child status tool is needed.
- `notification: pending`: the child is still working or the report is being prepared.
- `notification: queued`: handed to Pi's queue; **not an acknowledgement that the parent has read it**.
- `notification: failed`: synchronous notification enqueue/preparation failed; `notificationError` contains the error. An already-prepared report remains recoverable through status or late steering.
- `result`: bounded completion report, or `null` if unavailable/not requested.
- `fullOutputPath`: complete response file when successfully saved, otherwise `null`.

A completed child's report can already be inspected while its large-output file is still being written. The interim report states that the file is being prepared. Inspection does not consume, resend, or duplicate the automatic notification.

## Discarding finished subagents

After reviewing and integrating a report, the parent should release it when it is no longer needed:

```json
{ "ids": ["review-parser"] }
```

Call **`subagents_discard`** with exact, unique IDs. The whole batch is validated before anything is removed: running/stopping jobs, pending report preparation, unknown IDs, duplicates, and cancelled calls are rejected. Failed or stopped children can be discarded once report preparation settles, including reports recovered after notification failure.

Discarding removes the jobs from the dashboard, widget, and status/steering/wait lookup. An already-running wait retains its selected reports until it returns; future calls with discarded IDs fail. A dashboard displaying an explicitly discarded report returns to the list. Discard does **not** retract queued notifications, erase parent transcript messages, or delete full-response files that delivered messages may still reference.

Queueing a report does not prove that the parent has read it. Therefore reports are not automatically discarded on enqueue: the parent decides when they are no longer needed. The launch tool includes guidance to discard reviewed reports. If the parent does not do so, only the latest 20 settled reports remain as a bounded recovery fallback.

## Dashboard

**Click the subagent widget** to open the dashboard. This is the only entry point: no command or opening keyboard shortcut is registered. The widget appears when there are running jobs or retained finished reports. Click a row inside the dashboard to open that child.

The dashboard is an overlay; it does not switch parent sessions. Its presentation is heavily inspired by Claude Code's compact background-task UI, while retaining Pi's theme and native transcript components:

- **Name-first rows:** each child's meaningful kebab-case name is its label and ID, with lifecycle state and elapsed time aligned on the right when there is room. Full task prompts do not appear in the list or parent widget; inspect a child to see its assignment.
- **Clear outer frame, quiet interior:** a theme-accent rounded border surrounds both the dashboard and its stop-confirmation view (warning-colored for confirmation). Flat headers, thin separators, a `›` selection pointer, and emphasized task text keep the interior compact without full-width selection backgrounds. Mouse coordinates account for the frame; compact layouts keep it too.
- **Indented activity:** `⎿` detail lines show what each child is doing, queued guidance, its model, tool-use count, and reported token usage where space permits.
- **Compact parent widget:** an animated asterisk-style indicator, running/finished counts, up to four short active-agent names with activity/time, and a `Click to view` hint. No task prompts or opening keybinding hints. Failed results remain explicitly marked when work finishes.
- **Child detail view:** clicking a row opens that child's live session. The editor is focused, shows a cursor, and accepts typing. Enter sends: a steer while the child is running, or a new turn when it is idle. The session stays available until discard, so you can continue the conversation after the first report.

Tool-use counts include started calls, including failed calls. Token totals sum provider-reported finalized assistant messages; live partial snapshots are not added, and zero/unknown totals are omitted. These are per-child UI metrics, not a new billing ledger or parent usage aggregation. Colors follow the current Pi theme rather than hardcoding Claude's palette. On narrow terminals, names/details are clipped safely and lower-priority metadata may be omitted.

| Action | Default key |
| --- | --- |
| Select a child in the list | Up / Down |
| Open its transcript / steering editor | Enter or `s` |
| Send a message from the live editor | Enter |
| Stop selected child from the list | `x`, then `y` to confirm |
| Stop child while viewing transcript | Ctrl+X, then `y` |
| Cancel stop confirmation | `n` or Esc |
| Back to list / close overlay | Esc |
| Scroll transcript | PgUp / PgDn or mouse wheel |
| Jump to top / resume following live output | Ctrl+Home / Ctrl+End |
| Toggle thinking / expand tool output | Ctrl+T / Ctrl+O |

Pi keybindings apply to navigation and toggle actions. Scrolling pauses live-follow; jumping to the end resumes it. The editor keeps separate drafts for viewed jobs. In **fullscreen mode**, click the widget to open the dashboard and click either line of a child entry to open its transcript/editor. Transcript blocks and the editor also support mouse interaction. Pi routes mouse input in **fullscreen mode**, which this dotfiles configuration uses. Regular-mode Pi leaves mouse input to the terminal, so the dashboard cannot be opened there with this mouse-only entry point. Keyboard navigation, steering, scrolling, and closing still work inside an already-open dashboard.

Stopping is available through the interactive dashboard; there is no model-callable stop tool. Cancellation cannot undo file changes, external requests, or charges already incurred. A tool that ignores its abort signal can delay stopping.

The tools also work in print, JSON, and RPC modes. The dashboard and animated widget require interactive TUI mode; RPC does not render this custom terminal overlay.

## Lifecycle, retention, and limits

- Live sessions stay in this extension runtime until discard, history eviction, or session cleanup, so the dashboard can keep sending messages. Discard and eviction dispose the child session. Memory is bounded by the latest 20 settled sessions, not by an unbounded history.
- Only report metadata, counters, and bounded final text remain for finished jobs. The parent can remove those with `subagents_discard`; at most the latest **20 settled reports** are kept otherwise. In-flight report preparation is not prematurely evicted.
- The previous 20-job cap already prevented unlimited growth in finished-job count, but each retained Agent could hold a large, unbounded conversation and tool outputs. Releasing heavy state addresses that cost without depending on the parent remembering to discard reports. Finished agents make no further model calls; the widget animation timer stops when no jobs remain active.
- An already-open **report** remains visible if the history limit evicts it (at most one extra pinned report). Explicit discard releases that view too. Neither restores an evicted/discarded job to the status/steering APIs.
- Session start, session shutdown, tree navigation, and extension reload cancel old children, clear runtime history, close dashboards, and suppress notifications still being prepared for the old session. Notifications already handed to Pi follow Pi's session/queue lifecycle.
- Parent tool-call cancellation after launch does not cancel children: background work intentionally outlives that call.
- These are not detached workers: shutting down a one-shot Pi process cancels unfinished children. Keep the parent session/process alive when their results are required; use `subagents_wait` to explicitly hold the parent until dependencies finish. Otherwise the extension does not block parent completion.
- Completed custom messages are stored in the parent's session transcript, but child Agent state is not persisted or resumed. After restart, read old completion messages from the session rather than querying old IDs.
- Reports are truncated at Pi's default limits (**2,000 lines / 50 KiB**). Complete Markdown is saved to a private temporary file only when needed. If saving fails, the bounded report explicitly says so. Temporary artifacts are not automatically deleted by this extension.
- The extension uses the configured model registry and credentials; it requires no separate “subagent API key.” Provider requests still cost money. Child inference usage is **not currently aggregated into the parent's session totals** by this extension; consult provider usage/billing for authoritative spend.
- No automatic notification/read acknowledgement or retry is implemented. Recover a retained report with `subagents_status` if delivery is uncertain; discard it only after reviewing it.

## Installation

The dotfiles source is linked into `~/.pi/agent/extensions/subagents`, where Pi discovers `index.ts` automatically. Tests and this README sit beside it and are not loaded. Run `/reload` after code changes, preferably once current children have finished: reloading cancels their runtime.

To load only this extension for one invocation:

```sh
pi --no-extensions \
  -e ~/Documents/dotfiles/home/.pi/agent/extensions/subagents
```

It is independent of the Perplexity and OpenRouter web extensions. A child can use their tools when they are available and selected.

## Tests

From `home/.pi`:

```sh
npm run test:subagents
```

The default suite uses real in-process Agents and controlled provider streams, without paid API requests. `npm run test:subagents:live` runs the existing real-CLI/RPC test with a scripted local provider (also free).

For an explicit paid test using your configured credentials:

```sh
SUBAGENTS_LIVE_TEST=1 npm run test:subagents:paid
# Optional: SUBAGENTS_LIVE_PROVIDER=openai SUBAGENTS_LIVE_MODEL=gpt-6.1-sol
```

The paid test uses low effort, allows one tool-free child, caps parent turns, and aborts after two minutes. A real parent model must choose a newly discovered fixture agent by description and launch it with `agent`. A random token exists only in the definition body: the test asserts it was injected into the child's request, absent from the parent's launch prompt, returned by the child, and integrated by the parent. Temporary files and child sessions are cleaned up. It does not edit the working repository or mutate remote services. Provider billing is authoritative; a failed test can still incur charges.

Coverage includes:

- Named definition parsing, invalid settings, shadowing, deterministic precedence, trusted-project gating, nested directories, symlink aliases/cycles, bounded reads, and fresh discovery after edits/deletions.
- Catalog advertisement without body leakage, automatic child prompt injection (including fallback prompt construction), source paths, named-job metadata, generic-task isolation, and atomic rejection of missing/invalid definitions.

- Real Pi extension loading, absence of opening commands/shortcuts, conservative delegation descriptions/guidelines, required kebab-case names, atomic duplicate-name validation, name reservation/reset, inheritance, tool selection and permission-hook delegation.
- Concurrent runs, queued guidance, failure/abort handling, stopping, and session cleanup.
- Structured launch results, nonblocking status, late-steering races, result recovery after enqueue failure, and pending artifact writes.
- Explicit waits for single/batched dependencies, timeouts, cancellation, failed children, retained results, and session cleanup.
- A **real busy parent Agent** receiving child findings after its current tool completes and before its next model request—without an extra post-final follow-up.
- Bounded report history, automatic heavy-state/render-cache release, atomic explicit discard, preserved in-flight waits and artifact links, output truncation, UI timers, scroll/focus behavior, framed mouse interaction, narrow terminals, and both real TUI renderers.
- Name-first styling without prompt leakage into the widget/list, real fullscreen mouse opening, aligned lifecycle states, compact widget failure indicators, real tool/token counters, and finished-transcript controls.
