---
name: dots
disable-model-invocation: true
description: Interview the user, select a scoped workflow, then execute and verify it in this dotfiles repository. Use when the user wants help bootstrapping a machine, managing dotfile links, installing or upgrading Homebrew packages or mise tools, synchronizing Pi development dependencies, formatting or validating configuration, or choosing another repository maintenance workflow.
---

# Dotfiles workflow router

Help the user clarify what they want to accomplish, select the smallest appropriate workflow, and execute it after agreeing on the scope. Do not assume they want a full machine bootstrap.

Use the user's request and the conversation as the initial goal and context, including any request appended to `/skill:dots`. If no goal is supplied, ask what the user wants to accomplish.

## 1. Understand the repository and interview the user

- Resolve the repository root from this skill's location (`../../..`), not from an assumed working directory. Read its agent instructions, README (especially Task list and Common workflows), and mise.toml. Inspect relevant scripts and managed configuration when needed to understand the actual effects of a task.
- Treat the README's common workflows as reference examples, not an exhaustive menu. Use current task definitions as the source of truth for execution, dependencies, previews, and ordering.
- Start a short interview before making changes. Ask 1–3 focused questions at a time, then wait for answers. Use the supplied goal and conversation context; do not ask again for information already given.
- Clarify the desired outcome, affected scope (dotfiles, Homebrew, macOS settings, mise tools, Pi dependencies, Neovim, or something else), and whether the user wants inspection/preview only or changes applied. Ask about constraints only when they affect the route: for example, preserving existing links, upgrading only Pi versus all tools, or retaining version constraints.
- If the goal is unspecified, begin with an open question and a few examples rather than asking the user to choose task names. If it is already clear, briefly confirm your understanding and ask only about unresolved choices.
- Read-only inspection is allowed during the interview. Do not install, upgrade, format, relink, edit configuration, or apply system changes before the plan is confirmed.

## 2. Route and confirm

- Prefer existing tasks run with `mise run <task>` from the repository root. Select only the tasks needed for the user's goal; do not default to a full bootstrap or all upgrades.
- Reference routes include machine bootstrap (with or without dotfile linking), Pi upgrade followed by dependency synchronization and typechecking, and formatting/linting/typechecking configuration changes. Discover narrower or other routes from the full task list and relevant configuration.
- Compose tasks or use a justified direct command when no existing task covers the goal. Do not invent task names, create a new task merely to execute a one-off request, or limit the workflow to the README examples.
- Present a concise plan: intended outcome, affected scope, exact ordered commands, expected changes, available previews, and verification. Explain material side effects such as dependency installation or global package/system changes.
- Respect task composition: a parent task already runs its dependencies and nested tasks. Do not separately repeat those steps unless there is a specific reason.
- Ask the user to confirm the plan and wait before executing it. For preview-only requests, exclude every applying step; a task described as "preview and apply" is not a preview-only task.

## 3. Execute and verify

- Execute the confirmed workflow, respecting dependencies and sequential ordering. Use existing preview tasks and built-in dry runs where available; do not invent unsupported dry-run flags.
- If a preview reveals unexpected changes or a scope broader than agreed, pause and ask before applying. If the preview is embedded in a task that immediately applies, use its underlying preview command first when review is needed.
- Preserve unrelated working-tree changes. Do not commit, push, delete data, or expand the agreed scope without explicit authorization.
- Stop on failures, explain the blocker, and ask before taking a materially different or broader recovery action. Do not continue to steps that depend on a failed step.
- Run verification appropriate to the selected scope. Do not run mutating or unrelated checks merely because they appear in another common workflow.
- Finish with a concise summary of the route taken, commands and checks completed, changes made (or previewed only), and any remaining issues. If task definitions or recommended workflows changed, update the README task tree and common workflows in accordance with the repository instructions.
