# Taking screenshots (field notes)

These are notes from taking screenshots of a web app to verify UI changes and share them in PRs and chat, with agent-browser **0.38.2** on macOS. Add only sanitized lessons whenever a session teaches you something new: never record credentials, real emails, internal URLs, record ids or identifying values in these notes. The sensitive-data rules in [demo-videos.md](demo-videos.md#runtime-configuration-and-sensitive-data) apply here too.

## Runtime configuration

Before running commands, obtain the user's authorized runtime configuration and securely export these variables in the shell running the screenshot task:

| Variable | Runtime value |
|---|---|
| `DEMO_BASE_URL` | Authorized HTTP(S) app origin, without credentials, path, query or fragment |
| `DEMO_START_PATH` | App-relative route to capture, beginning with a single `/` |
| `DEMO_START_TEXT` | Visible marker confirming that the intended page loaded |

Use an existing secure environment or approved secrets manager. Ask for missing values or an authorized source; never guess credentials. If login is required, obtain the authorized persona and credentials the same way, and adapt the login workflow before waiting for the page marker. Do not hardcode or log sensitive values, put literal secrets in shell history or tool calls, or enable shell tracing (`set -x`). Unset runtime configuration and credentials when finished.

Run the example below from the target repository root, after excluding the output folder as described in **Naming and storage**. It uses one unique session for the whole task and closes it on exit. The default example does not install a cursor overlay.

## Defaults: 2x resolution, dark theme

```bash
set -euo pipefail
: "${DEMO_BASE_URL:?Securely export the authorized app origin at runtime}"
: "${DEMO_START_PATH:?Export the app-relative screenshot route at runtime}"
: "${DEMO_START_TEXT:?Export a visible page marker at runtime}"
[[ "$DEMO_START_PATH" == /* && "$DEMO_START_PATH" != //* ]] || { echo "DEMO_START_PATH must be app-relative" >&2; exit 1; }
git check-ignore -q screenshots/01-what-state.png || { echo "Exclude screenshots/ before capture" >&2; exit 1; }
mkdir -p ./screenshots
S="shot-$RANDOM"
AB() { agent-browser --session "$S" --color-scheme dark "$@"; }
trap 'AB close >/dev/null 2>&1 || true' EXIT
AB set viewport 1600 1000 2 >/dev/null   # third argument = deviceScaleFactor
AB open "${DEMO_BASE_URL%/}$DEMO_START_PATH" >/dev/null
# Perform any required authorized login before waiting for the page marker.
AB wait --text "$DEMO_START_TEXT" >/dev/null
sleep 0.7
AB screenshot ./screenshots/01-what-state.png >/dev/null
```

- **2x:** `set viewport <w> <h> 2` sets `devicePixelRatio` to 2. Checked: an 800×600 viewport produced a 1600×1200 PNG. The layout stays at `<w>`×`<h>` CSS pixels; only the image is sharper. Recording video at 2x has not been tried.
- **Dark:** pass `--color-scheme dark` (or `AGENT_BROWSER_COLOR_SCHEME=dark`) on every command. Without it, the browser follows the host's macOS appearance, so the result depends on the machine. Checked: with the flag, `prefers-color-scheme: dark` matched; with `--color-scheme light`, it didn't.
- **Viewport width of at least 1280 px; 1600×1000 worked well.** At 900 px wide, a fixed-width (~1000 px) drawer didn't fit and its left edge went off-screen.

## Before shooting

- **Confirm the theme actually applied.** Apps can ignore `prefers-color-scheme` when the user has a stored preference (localStorage or a profile setting). In one app only one persona had a dark profile, so screenshots taken as other personas came out light. Check the computed background colour with `eval`.
- **Theme overrides require configuration before the session starts.** The optional override in [`../examples/tariff-demo/cursor.js`](../examples/tariff-demo/cursor.js) cannot read shell variables directly. Securely export `DEMO_BASE_URL` and the relevant optional `DEMO_THEME_STORAGE_KEY` / `DEMO_THEME_PROFILE_FIELD`, set `D` to the absolute path of this skill's `examples/tariff-demo` directory, and source `"$D/runtime.sh"` before the first browser command. That helper generates and exports `AGENT_BROWSER_INIT_SCRIPTS`; include `rm -f "$DEMO_INIT_SCRIPT"` in the exit cleanup after closing the session. See [demo-videos.md](demo-videos.md#runtime-configuration-and-sensitive-data) for details. **This script also adds a cursor overlay.** For clean screenshots without a cursor, use an authorized dark-theme persona or adapt a theme-only init script; do not change the user's persisted theme preference without permission.
- **Confirm the page runs the current code.** A dev server's hot reload inside a container once missed a source edit and kept serving the old module, so screenshots showed old behaviour. Check the loaded module contains the change (e.g. fetch its URL and search for a string you added), or restart the app container, before shooting.
- **Use your own session and persona.** Choose one unique `--session` per screenshot task and reuse it for every command in that task. Use a persona and records no other agent is using, and `close` the session at the end, including on failure. In one session another agent kept editing the same record while screenshots were being taken.

## Getting a settled frame

- Wait for content, not time: `wait --text "<marker>"` (or `wait --fn '<condition>'`) for the state you want, then pause about 0.7 s before the screenshot so drawer and menu animations finish. Without the pause, drawers came out half-drawn.
- Headless Chrome sometimes stops repainting after a menu or drawer opens. An extra throwaway `screenshot` forces a paint. Once a drawer stayed off-screen until one was taken.
- Look up element refs right before each click; they go stale after any DOM change.

## Naming and storage

- **Look at every screenshot before naming it** (e.g. with an image-reading tool). One file was named for the result it was meant to show, but it showed something else because the page was running old code. Name files by what they actually show, and rename any that don't match.
- Use numbered, descriptive names in step order: `NN-<what>-<state>.png` (e.g. `05-drawer-draft-editable.png`).
- **Exclude screenshots before capture.** Use a dedicated folder at the target repo root, such as `screenshots/`. Resolve the local exclusion file with `git rev-parse --git-path info/exclude` and add `/screenshots/` before generating any images (local only; never commit the exclusion file). In a git worktree, that path resolves to the main checkout's exclusion file, so the rule applies to every worktree. Verify with `git check-ignore screenshots/01-what-state.png`. Ignore rules do not protect already-tracked files: check `git ls-files -- screenshots/` and choose another untracked folder if necessary rather than removing user files. Adapt the example's paths and guard if you choose another folder.

## Sharing

- **Keep shareable screenshots clean.** Typed test text showed up in a screenshot behind an open dropdown. Clear only temporary, unsaved test edits made by the agent during the current task before shooting anything meant for sharing. Never discard pre-existing user edits, delete records or change persisted data without explicit permission. If cleanup would affect someone else's work or persisted state, ask first or use another authorized demo record.
- **Review for sensitive data before sharing:** names, emails, internal URLs, ids and record values. Redact or crop if needed.
- **Pick 1–2 per audience.** For a PR or a chat thread, choose the screenshots that show the change: the new state, plus a contrasting state if it helps (e.g. editable vs view-only). Skip any with test data visible.

## Test data

- Prefer read-only flows. When a screenshot needs data that doesn't exist, create it only through the app's normal product API (never direct database writes or test-only endpoints), and only with the user's approval.
- **Account for everything you created:** kind of record, ids, the change set or container it lives in, and any side effects on other screens. Report the details through an authorized private channel or untracked local record so the user can clean it up. Do not copy real ids or identifying values into tracked documentation, public PRs or chat threads; keep any lessons added to this reference generic and sanitized.
