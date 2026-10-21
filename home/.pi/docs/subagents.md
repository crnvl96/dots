# subagents

An in-process Pi extension for selectively delegating substantial, well-bounded tasks to background agents. Children have isolated conversations and share the parent's working directory and callable tools. The parent can keep working while they run.

Source: `home/.pi/agent/extensions/subagents.pi.ts`.

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
| `subagents_launch({ tasks })` | Start a batch of children and immediately return IDs and task metadata. |
| `subagents_steer({ id, prompt })` | Queue guidance for a running child, or recover the result if it has already finished. |
| `subagents_status({ id? })` | Inspect progress without waiting; an exact ID includes the available final report. |
| `subagents_wait({ ids, timeoutMs? })` | Wait for all selected children and return their reports; an optional timeout returns current snapshots without stopping them. |

Completion reports arrive automatically. **Do not poll status in a loop.** Use status to diagnose a job or recover a report; use wait when the next step depends on one or more children's results.

## Launching children

```json
{
  "tasks": [
    {
      "prompt": "Review src/parser.ts for edge cases. Do not edit files; report findings with file paths.",
      "thinkingLevel": "high",
      "tools": ["read", "bash"]
    },
    {
      "prompt": "Write parser regression tests. Own only tests/parser.test.ts; do not edit implementation files. Run the tests and report results."
    }
  ]
}
```

Each task supports:

| Field | Default / behavior |
| --- | --- |
| `prompt` | Required, nonblank, self-contained task. |
| `model` | Parent model ID. Must resolve with the selected provider. |
| `provider` | Parent provider. |
| `thinkingLevel` | Parent context's thinking level, falling back to Pi's current setting. Accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Provider/model support still applies. |
| `tools` | Active parent-callable tools, excluding this extension's orchestration tools. Supply exact names to choose a subset; `[]` disables tools. Explicit tools must be callable in the parent's context. |
| `systemPrompt` | General-purpose subagent instructions. A supplied value replaces these instructions; an explicit empty string is respected. |

The entire batch is validated before any child starts. Children then run concurrently with separate IDs and Agent instances. There is no built-in concurrency limit, deadline, automatic retry, or per-child spend cap; use modest batches and stop unwanted work.

A child does **not** inherit the parent conversation, parent system prompt, or project instructions automatically. Include the task context, relevant file paths, constraints, expected output, and any required instructions in its prompt. File ownership should be explicit when children can edit the same workspace.

Child tools call `ctx.executeTool()` so Pi's validation, permission hooks, and tool-result handling still apply. Tool selection is **not a security sandbox**: for example, `bash` can access the workspace and tools that orchestrate other tools can have broader reach. Subagent orchestration tools are excluded from direct child tool selection; this is not a security boundary against indirect orchestration.

### Structured launch result

```json
{
  "ids": ["<uuid-1>", "<uuid-2>"],
  "agents": [
    {
      "id": "<uuid-1>",
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

This abbreviated example illustrates one snapshot; the actual `agents` array contains one entry per launched ID. State can advance before the launch returns. Legacy tool-result `details.ids` remains available. Codemode receives the structured object rather than needing to parse a sentence containing UUIDs.

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
{ "id": "<exact-child-id>", "prompt": "Focus on malformed input. Do not change the public API." }
```

The result is `{ "accepted": true, "agent": { ...snapshot } }` when queued. It does not interrupt an in-flight tool.

If the child is completed, failed, stopped, or already stopping, the tool returns **`accepted: false`**, its status, and the available bounded report. This is a normal completion race, not a tool error. The guidance was not sent, and the child is **never silently restarted**. Launch a new task if more work is required. Unknown/expired IDs and blank guidance are errors.

Provider errors and aborts are hard exits; queued guidance cannot restart a failed request. Manual stop clears queued guidance.

## Waiting for dependencies

Use `subagents_wait` to hold the parent's tool call until **all** selected children have finished and report preparation/enqueueing has settled:

```json
{ "ids": ["<exact-child-id-1>", "<exact-child-id-2>"] }
```

The result is `{ "timedOut": false, "agents": [ ...snapshotsWithResults ] }`, in the requested ID order. A failed or manually stopped child also finishes a wait: **check each `status` and `error`**, not just `timedOut`, before proceeding. Already-finished children return immediately. Unselected children continue independently.

An optional deadline bounds only this wait, not the children:

```json
{ "ids": ["<exact-child-id>"], "timeoutMs": 60000 }
```

If it expires, the tool returns `timedOut: true` and current snapshots, including any reports already available. Omitting `timeoutMs` waits without a deadline; valid values are integers from 1 to 2147483647 milliseconds. Cancelling the parent wait does **not** stop the children. A session change/shutdown cancels pending waits and children according to the lifecycle rules below.

IDs must be exact, unique, nonempty, and retained when the wait begins. An in-flight wait keeps references to its selected jobs even if finished history is pruned. Waiting is event-driven and makes no provider requests. Automatic completion notifications remain enabled and may repeat reports returned by the wait; the wait does not consume or acknowledge them. It waits for report preparation, **not** for the parent to read a queued notification. A notification failure still returns the recoverable report with `notification: failed`.

For a substantial review where separate assessments justify the handoff, waiting immediately is appropriate. This is not the default pattern for small tasks. For example, in codemode:

```javascript
const launched = await tools.subagents_launch({ tasks: [
  { prompt: "Review src/parser.ts. Do not edit files; report edge cases." },
  { prompt: "Review tests/parser.test.ts. Do not edit files; report coverage gaps." },
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
{ "id": "<exact-child-id>" }
```

Returns one snapshot with its available final report. Inspection never waits for a running child and makes no model/API call. IDs for tools must be exact; the dashboard command additionally accepts unique prefixes.

Snapshot states:

- `status`: `running`, `stopping`, `completed`, `failed`, or `stopped`.
- `activity`: live, automatically derived detail such as `Starting`, `Thinking`, `Writing response`, `Running <tool names>`, or `Working`, followed by the final outcome. Displayed in the widget and dashboard; no child status tool is needed.
- `notification: pending`: the child is still working or the report is being prepared.
- `notification: queued`: handed to Pi's queue; **not an acknowledgement that the parent has read it**.
- `notification: failed`: synchronous notification enqueue/preparation failed; `notificationError` contains the error. An already-prepared report remains recoverable through status or late steering.
- `result`: bounded completion report, or `null` if unavailable/not requested.
- `fullOutputPath`: complete response file when successfully saved, otherwise `null`.

A completed child's report can already be inspected while its large-output file is still being written. The interim report states that the file is being prepared. Inspection does not consume, resend, or duplicate the automatic notification.

## Dashboard

Open with **`/subagents`**, **Ctrl+Shift+A**, or click the subagent widget. `/subagents <unique-ID-prefix>` opens a particular child.

The dashboard is an overlay; it does not switch parent sessions. It shows native assistant messages, thinking blocks, tool execution/progress/errors, running timers, and completed transcripts. Theme-aware headers, colored lifecycle badges, and a two-line selection highlight distinguish task state and focus without changing the controls.

| Action | Default key |
| --- | --- |
| Select a child in the list | Up / Down |
| Open its transcript / steering editor | Enter or `s` |
| Send guidance from the editor | Enter |
| Stop selected child from the list | `x`, then `y` to confirm |
| Stop child while viewing transcript | Ctrl+X, then `y` |
| Cancel stop confirmation | `n` or Esc |
| Back to list / close overlay | Esc |
| Scroll transcript | PgUp / PgDn or mouse wheel |
| Jump to top / resume following live output | Ctrl+Home / Ctrl+End |
| Toggle thinking / expand tool output | Ctrl+T / Ctrl+O |

Pi keybindings apply to navigation and toggle actions. Scrolling pauses live-follow; jumping to the end resumes it. The editor keeps separate drafts for viewed jobs. In **fullscreen mode**, click the widget to open the dashboard and click either line of a child entry to open its transcript/editor. Transcript blocks and the editor also support mouse interaction. Regular-mode rendering is supported, but Pi leaves mouse input to the terminal in that mode; use keyboard controls there.

Stopping is available through the interactive dashboard; there is no model-callable stop tool. Cancellation cannot undo file changes, external requests, or charges already incurred. A tool that ignores its abort signal can delay stopping.

The tools also work in print, JSON, and RPC modes. The dashboard and animated widget require interactive TUI mode; RPC does not render this custom terminal overlay.

## Lifecycle, retention, and limits

- Live jobs and transcripts exist only in this extension runtime. Running jobs plus the latest **20 settled jobs** are retained for inspection; in-flight report delivery is not prematurely evicted.
- An already-open transcript remains visible even if the history limit evicts its job. That does not restore the job to the status/steering APIs.
- Session start, session shutdown, tree navigation, and extension reload cancel old children, clear runtime history, close dashboards, and suppress notifications still being prepared for the old session. Notifications already handed to Pi follow Pi's session/queue lifecycle.
- Parent tool-call cancellation after launch does not cancel children: background work intentionally outlives that call.
- These are not detached workers: shutting down a one-shot Pi process cancels unfinished children. Keep the parent session/process alive when their results are required; use `subagents_wait` to explicitly hold the parent until dependencies finish. Otherwise the extension does not block parent completion.
- Completed custom messages are stored in the parent's session transcript, but child Agent state is not persisted or resumed. After restart, read old completion messages from the session rather than querying old IDs.
- Reports are truncated at Pi's default limits (**2,000 lines / 50 KiB**). Complete Markdown is saved to a private temporary file only when needed. If saving fails, the bounded report explicitly says so. Temporary artifacts are not automatically deleted by this extension.
- The extension uses the configured model registry and credentials; it requires no separate “subagent API key.” Provider requests still cost money. Child inference usage is **not currently aggregated into the parent's session totals** by this extension; consult provider usage/billing for authoritative spend.
- No notification/read acknowledgement or automatic retry is implemented. Recover a retained report with `subagents_status` if delivery is uncertain.

## Installation

The dotfiles source is linked into `~/.pi/agent/extensions/subagents.pi.ts`, where Pi discovers it automatically. Run `/reload` after code changes, preferably once current children have finished: reloading cancels their runtime.

To load only this extension for one invocation:

```sh
pi --no-extensions \
  -e ~/Documents/dotfiles/home/.pi/agent/extensions/subagents.pi.ts
```

It is independent of the Perplexity and OpenRouter web extensions. A child can use their tools when they are available and selected.

## Tests

From `home/.pi`:

```sh
npm run test:subagents
npm exec --yes --package=typescript -- tsc --noEmit
```

Tests use real in-process Agents and controlled provider streams, without paid API requests. Coverage includes:

- Real Pi extension loading, conservative delegation descriptions/guidelines, task validation, inheritance, tool selection and permission-hook delegation.
- Concurrent runs, queued guidance, failure/abort handling, stopping, and session cleanup.
- Structured launch results, nonblocking status, late-steering races, result recovery after enqueue failure, and pending artifact writes.
- Explicit waits for single/batched dependencies, timeouts, cancellation, failed children, retained results, and session cleanup.
- A **real busy parent Agent** receiving child findings after its current tool completes and before its next model request—without an extra post-final follow-up.
- Bounded history, output truncation, UI timers, scroll/focus behavior, mouse interaction, narrow terminals, and both real TUI renderers.
