# Agent instructions

Manage dotfiles with mise. Preserve existing edits. Do not deploy, install,
change system preferences, restart apps, stage, commit, or push unless requested.

## Edit the source

```text
mise.toml                         # deployment and tasks
home/                             # mirrors $HOME; deployed via relative links
├── .config/mise/config.toml       # global tools and macOS preferences
├── .config/homebrew/Brewfile      # Homebrew packages; separate workflow
└── .agents/skills/                # global skills
.agents/skills/                   # repository-only skills, if needed
```

Edit repository sources. Linked config contents change immediately; apps may
need a reload. Tools and macOS preferences require a separate apply step.
**Untracked files under `home/` deploy unless excluded in `mise.toml`; `.gitignore`
is not a deployment exclusion.** Keep secrets and generated files out.

## Use the tasks

Run from the repository root, or use `mise -C /path/to/dotfiles run <task>`.
List tasks with `mise tasks --local`.

| Operation | Inspect / preview | Apply, only when requested | Verify |
| --- | --- | --- | --- |
| Full bootstrap | `mise run bootstrap:preview` | `mise run bootstrap:apply` | `mise run bootstrap:check` |
| Homebrew entries | `mise run brew:check` | Separate workflow; not part of bootstrap | `mise run brew:check` |

`bootstrap:apply` previews, confirms (default: no), applies, then checks.
It can change links and ALL declared macOS preferences, install tools, and run
configured hooks. Stop on conflicts or unrelated changes; never bypass
confirmation without explicit authorization and a reviewed preview.

Use native targeted commands for small changes instead of full bootstrap:

| Operation | Preview | Apply, only when requested | Verify |
| --- | --- | --- | --- |
| Dotfile links | `mise dot apply --dry-run` | `mise dot apply` | `mise dot diff`, `mise dot status --missing` |
| macOS preferences | `mise bootstrap macos defaults apply --dry-run` | `mise bootstrap macos defaults apply` | `mise bootstrap macos defaults status --missing` |

- Dotfile apply changes links only. Mise can repoint symlinks without `--force`.
- Targeted macOS apply changes ALL declared preferences, not just the edited
  key. It does not install tools or restart Dock/Finder.
- macOS and bootstrap commands read the active `~/.config/mise/config.toml`.
  Verify it points to the repository source before using them.
- Task runs do not implicitly install missing tools; explicit bootstrap apply
  can install them. If mise is missing or config is untrusted, report the
  blocker; do not install or trust implicitly.
- `brew:check` runs its stdlib-only script with uv; Python downloads and Homebrew
  auto-update are disabled. Orphans and available upgrades are informational;
  Brewfile drift fails the check. It does not install or remove packages.
- On mise 2026.10.2, `mise bootstrap plan` misses this setup; use
  `bootstrap:preview`. Trusted templates can execute functions during inspection.
- Do not name a wrapper task `bootstrap`: mise invokes that name as a bootstrap
  hook, so a wrapper calling `mise bootstrap` can recurse.

## Keep deployment safe

Do not use `mise dot add`, switch link managers, or force-overwrite unmanaged
paths. For moved, excluded, or removed `home/` sources:

- Record affected links; save contents and permissions outside the repository.
  Preserve unmanaged files and `$MISE_STATE_DIR/dotfiles` retirement records.
- Before changing the deployment target or removing its entry/source tree,
  preview `mise dot unapply --dry-run`; unapply only when authorized, while the
  old config and sources still exist.
- Compare dangling links and empty directories before/after deployment without
  following directory symlinks (`find -P`). Verify targets with `ls -ld` and
  `readlink`; keep repository-only files unlinked. Check the surviving parent
  if a subtree disappears.
- Remove only confirmed obsolete paths; use `rmdir` for empty directories.
  Never recursively delete shared roots such as `~/.config` or `~/.agents/skills`.

## Finish

Run `mise run bootstrap:check` and `mise run bootstrap:preview`. For task
changes, also run `mise tasks validate`. For Homebrew audit script changes,
run `mise run brew:check` and its tests with
`uv run --no-project --no-python-downloads python -B -m unittest discover -s tests -v`.
Report changed files, checks, and pending changes. Distinguish existing drift
from new issues. Edit-only and dry-run requests must not apply anything.
