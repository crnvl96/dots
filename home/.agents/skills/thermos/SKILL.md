---
name: thermos
description: "Launch both thermo-nuclear review passes in parallel, then synthesize their findings. Use for thermos, double thermo review, or combined correctness/security and code-quality audits."
disable-model-invocation: true
---

# Thermos

Run independent correctness/security and maintainability audits, then synthesize their results. Review only; do not fix findings unless the user explicitly authorizes it.

## Workflow

1. Read [review scope and reporting](references/review-workflow.md). Establish the exact target and comparison before reviewing.
2. Gather git status, the scoped diff (including untracked files when applicable), changed-file contents, applicable repository instructions, and any context needed to evaluate the changes without guessing. Do this directly using the host's file and shell tools; do not spawn extra agents just to gather context.
3. Select the two named reviewers (the host loads their definitions automatically):
   - `thermo-nuclear-review-subagent`, using the [deep review rubric](../thermo-nuclear-review/SKILL.md).
   - `thermo-nuclear-code-quality-review-subagent`, using the [code-quality rubric](../thermo-nuclear-code-quality-review/SKILL.md).
   Their canonical definitions are [correctness/security](../../agents/thermo-nuclear-review-subagent.md) and [maintainability](../../agents/thermo-nuclear-code-quality-review-subagent.md); read them manually only for hosts without named-agent support.
4. Launch both reviews concurrently using the host-specific instructions below. Give both reviewers the same repository path, target/base or commit SHA, labeled `### Git / diff output` and `### Changed file contents` sections, relevant repository instructions, and any user focus. For large diffs, supply exact paths and comparison commands so reviewers can read all remaining context themselves; never silently truncate the review scope. Explicitly require read-only review, no nested delegation, prioritized findings with `path:line` evidence, and a short verdict and verification limitations. Children do not inherit the parent conversation.
5. Collect both completed reports. If a reviewer fails or cannot access required context, retry where practical or report the missing pass; never claim the full double review completed without both results.
6. Validate and deduplicate findings, resolve disagreements against the code, and present findings first. Agreement alone is not evidence or a reason to inflate severity. Follow with the unified verdict and any remaining uncertainty. Keep summaries brief; do not repeat individual background reports wholesale if already visible to the user.

## Host-specific orchestration

### Claude Code

Use the native subagent tool (`Agent`, or `Task` on versions that expose that name). In one message, launch two calls with `run_in_background: true` and these `subagent_type` values:

- `thermo-nuclear-review-subagent`
- `thermo-nuclear-code-quality-review-subagent`

The definitions are installed under `~/.claude/agents/`. If custom types are not available in the current session, use an available general-purpose subagent type and include the corresponding reviewer definition and rubric path explicitly in its prompt. Use the host's completion notifications/result retrieval to collect both reports.

### Pi with the subagents extension

Use one `subagents_launch` call with two `tasks`. Set `agent: "thermo-nuclear-review-subagent"` on the correctness task and `agent: "thermo-nuclear-code-quality-review-subagent"` on the quality task. Use fresh, meaningful `name` IDs such as `thermos-correctness` and `thermos-quality` (or suffixed variants on repeated runs); these job IDs are distinct from the reusable `agent` type.

The subagents extension discovers the definitions automatically and injects the selected Markdown body and source directory into each child's system prompt. Give each task a self-contained review assignment; do not copy the definition into its prompt or ask the child to load it first. The definition itself directs the child to its review rubric. Use `subagents_list` if a definition is missing or invalid, and report discovery diagnostics rather than silently substituting a generic review.

Use `tools: ["read", "bash"]` for each reviewer; these support reading source, git inspection, tests, and read-only `gh`/`glab` queries. They are not a security sandbox: explicitly forbid edits, staging, commits, checkout, and remote mutations. Inherit the parent model and thinking level rather than forcing a provider or effort setting.

Retain the exact returned IDs. Completion reports arrive automatically; do not poll. Use `subagents_wait` when synthesis depends on the results, inspect both statuses and reports, and call `subagents_discard` only after integrating them.

### Other hosts or unavailable delegation

Use the host's native parallel review mechanism if available, passing the reviewer definitions and rubric paths explicitly. If no delegation tool exists, disclose that independent parallel reviewers are unavailable and run the two rubric passes locally in sequence. Do not claim independent subagent review in that fallback.
