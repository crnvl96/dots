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
| Dotfile links | `mise run preview` | `mise run deploy` | `mise run check` |
| macOS preferences | `mise run macos:status`, `mise run macos:preview` | `mise run macos:apply` | `mise run macos:check` |
| Full bootstrap | `mise run bootstrap:status`, `mise run bootstrap:preview` | Separate authorization required | `mise run bootstrap:check` |

`deploy` and `macos:apply` preview, confirm (default: no), apply, then check.
Stop on conflicts or unrelated changes; never bypass confirmation without
explicit authorization and a reviewed preview.

- `deploy` changes links only. Mise can repoint symlinks without `--force`.
- `macos:apply` applies ALL declared preferences, not just the edited key. It
  does not install tools or restart Dock/Finder.
- macOS and bootstrap tasks read the active `~/.config/mise/config.toml`.
  Verify it points to the repository source before using them.
- Task runs do not auto-install tools. If mise is missing or config is untrusted,
  report the blocker; do not install or trust implicitly.
- Use targeted tasks for small changes. On mise 2026.10.2, `bootstrap:plan`
  misses this setup; use `bootstrap:preview`. Trusted templates can execute
  functions during inspection.

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

Run `mise run check` and `mise run preview`. For macOS changes, also run
`mise run macos:check`; for task changes, run `mise tasks validate`.
Report changed files, checks, and pending changes. Distinguish existing drift
from new issues. Edit-only and dry-run requests must not apply anything.
