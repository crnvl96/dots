# Thermos dotfiles port

Source: [cursor/plugins/thermos](https://github.com/cursor/plugins/tree/main/thermos)

Upstream revision: `9b93e81fb2921b9263d9463c15bafeabfe3903aa` (plugin version `1.0.0`).
License: MIT, copyright 2026 Cursor. The upstream license is preserved in each skill directory and in `home/.agents/agents/LICENSE`.

## Installed resources

- `thermos`: parallel correctness/security and maintainability review, followed by a unified report.
- `thermo-nuclear-review`: standalone correctness/security rubric.
- `thermo-nuclear-code-quality-review`: standalone maintainability rubric.
- `thermo-nuclear-review-subagent` and `thermo-nuclear-code-quality-review-subagent`: reviewer definitions.

Canonical files live under `home/.agents/skills/` and `home/.agents/agents/`. Relative symlinks under `home/.claude/skills/` and `home/.claude/agents/` point back to those files. Deploy using `mise dotfiles apply --prune`; preview with `mise dotfiles apply --dry-run --prune` first.

The old `code-review-correctness` and `code-review-quality` skills and their Claude aliases are replaced by these resources.

## Usage

In Claude Code, start a fresh session after deployment to discover custom agents, then run `/thermos` for both passes, `/thermo-nuclear-review` for correctness/security, or `/thermo-nuclear-code-quality-review` for maintainability. Specify a branch/base, commit, PR/MR, uncommitted worktree, or snapshot target.

In Pi, run `/reload`, then `/skill:thermos`, `/skill:thermo-nuclear-review`, or `/skill:thermo-nuclear-code-quality-review`. The double review uses the subagents extension's named-agent discovery. It scans the deployed agent directories, advertises the reviewer types, and automatically injects the selected definition when `tasks[].agent` names it. `subagents_list` shows the discovered types and validation diagnostics. If delegation is unavailable, the skill discloses that and performs two local passes instead.

## Porting changes

- Preserved both upstream review rubrics, including security/devex/feature-leak checks and the strict maintainability/1k-line/code-judo standards.
- Replaced Cursor plugin installation and Cursor-only Task orchestration with native Claude Code and Pi instructions. No plugin manifest, logo, or Cursor installation is required.
- Added shared target selection, repository guidance, read-only boundaries, actionable findings, calibrated severity, and honest verification limitations.
- Kept the upstream skills' `disable-model-invocation: true` frontmatter for explicit invocation where supported.
- Removed upstream guidance to launch shell/explore subagents merely to collect context; the parent gathers it directly and launches only the two substantial reviews.
- Did not port optional automation mentioned only in upstream metadata (take-the-wheel/FSD); no such implementation is present in this upstream Thermos directory. Reviews never authorize automatic fixes or remote mutations.
