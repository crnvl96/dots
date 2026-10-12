# Recording demo videos (field notes)

These are notes from recording tariff-app demos for product people with agent-browser **0.38.2** on macOS. They cover what worked, what broke, and the recipe that produced a good take on the first try. They add to the CLI's own guide; they don't replace it. Update them whenever a recording teaches you something new.

The scripts adapted from the good take are in [`../examples/tariff-demo/`](../examples/tariff-demo/). Credentials, internal URLs and identifying record values have been removed and must be supplied through environment variables at runtime. Adapt the remaining selectors for another app; don't treat these as a generic tool. App-specific assumptions are listed at the end.

## Read first

```bash
agent-browser skills get core --full
cat "$(agent-browser skills path core)/references/video-recording.md"
```

The CLI's guide covers `record start/stop`, `--fps`, `--cursor`, `--contact-sheet` and `record stop --json`. The first failed attempt skipped it, and it would have exposed the frozen-frame problem straight away (see Verify).

Requirements: `ffmpeg` on `PATH` with `libx264` (mp4) and `libvpx` (webm). `agent-browser doctor` checks for them.

## Runtime configuration and sensitive data

**Before running the examples, the agent must obtain the user's authorized environment and set the variables below in the shell that runs both scripts.** Use an existing secure runtime environment or an approved secrets manager. If a value or authorized source is missing, ask the user; never guess credentials or copy real values into these examples.

| Variable                   | Required by    | Runtime value                                                               |
| -------------------------- | -------------- | --------------------------------------------------------------------------- |
| `DEMO_BASE_URL`            | Both           | Authorized HTTP(S) app origin, without credentials, path, query or fragment |
| `DEMO_EMAIL`               | Preparation    | Authorized demo persona's email                                             |
| `DEMO_PASSWORD`            | Preparation    | Password supplied securely, never hardcoded                                 |
| `DEMO_START_PATH`          | Preparation    | App-relative starting route, beginning with a single `/`                    |
| `DEMO_START_TEXT`          | Preparation    | Visible marker that confirms the start page loaded                          |
| `DEMO_TARIFF_NAME`         | Recording      | Exact visible name of the authorized demo tariff                            |
| `DEMO_CHARGE_NAME`         | Recording      | Exact visible charge list-item name, including any displayed prefix         |
| `DEMO_VERSION_ONE_LABEL`   | Recording      | Exact visible label of the first version option                             |
| `DEMO_VERSION_TWO_LABEL`   | Recording      | Exact visible label of the second version option                            |
| `DEMO_THEME_STORAGE_KEY`   | Optional, both | App's localStorage theme key; omit to disable this override                 |
| `DEMO_THEME_PROFILE_FIELD` | Optional, both | JSON theme field in fetch responses; omit to disable this override          |

- Export required values only at runtime. Do not put secrets, real emails, internal domains, or identifying record names in tracked files, command examples, commit messages or chat/tool output. Never run with shell tracing (`set -x`). Avoid putting literal secrets in shell history or tool calls; refer to an already-provided environment variable or approved secret injection instead.
- `runtime.sh` creates a mode-600 temporary init script containing only the origin and optional theme keys, because browser JavaScript cannot read shell environment variables. Both callers remove that temporary file on exit. Credentials are never included in it.
- The scripts fail before browser actions if their required variables are missing. Auth selectors are still app-specific; inspect and adapt them before logging in.
- Use one unique session for preparation and recording. Once values are securely exported, run:

  ```bash
  DEMO_SESSION="rec-$RANDOM"
  # DEMO_SCRIPTS is the absolute path to this skill's examples/tariff-demo directory.
  bash "$DEMO_SCRIPTS/prep.sh" "$DEMO_SESSION"
  unset DEMO_PASSWORD DEMO_EMAIL
  bash "$DEMO_SCRIPTS/record.sh" "$DEMO_SESSION"
  bash "$DEMO_SCRIPTS/trim.sh"
  ```

- Environment variables prevent accidental source-control disclosure, not all runtime exposure: CLI arguments may be visible to local processes. Use an authorized test account and a trusted machine. Screenshots, videos, snapshots, timings, session state and temporary artifacts may contain identifying data; review them before sharing and keep them out of commits.
- After finishing, unset the remaining `DEMO_*` configuration variables and close any prepared session that was not recorded. Do not publish a recording or operate on real records without authorization.

## Results so far

| Attempt | Recipe                                                                                                           | Raw → final   | Outcome                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| v0      | Ad-hoc commands, `record start --cursor`, mouse commands                                                         | ~130 s        | Bad. First take was 142 s of a single frozen frame; some frames mid-transition; daemon hangs  |
| v1      | One script, fresh tab, forced repaints, freezedetect trim                                                        | 22.2 → 15.5 s | Good on the first take, but too short (~2 s per step) and a white flash from a full page load |
| v2      | v1 + dark mode, `cursor.js` macOS pointer and click ring, `click --human`, ~4 s per step, in-app navigation only | 39.6 → 34.1 s | Good on the first take. Dark mode, smooth pointer, clear clicks                               |

## Recipe (what worked in v2)

### 1. Isolate

- Use a unique session for every command, e.g. `--session rec-$RANDOM`. Never share the `default` session with other agents.
- Use a persona and records that no other agent is touching. In v0 another session saved the same draft while the recording ran, and its text showed up on camera. Check the record's `lock_version` / `updated_*` before starting.
- Keep the flow read-only: no Save, Submit, Publish or Discard on persisted data. Logging in still writes the user's last-login and activity timestamps, so a strictly zero-write run isn't possible.

### 2. Prepare outside the recording (`prep.sh`)

1. Set the required runtime variables from the table above. Both scripts source `runtime.sh`, which exports:
   - `AGENT_BROWSER_COLOR_SCHEME=dark` (dark mode)
   - `AGENT_BROWSER_INIT_SCRIPTS=<temporary configured script>` (the init script, which runs before page JS on every navigation)
2. `set viewport 1600 1000`, then log in.
3. Open the start page with `tab new <url>`, a full load in a fresh tab, then close the old tab. A tab used for a long time can stop repainting; recording it gives one frozen frame.
4. Check the state with `eval`: theme applied (check the computed background colour), cursor overlay mounted, then take a screenshot. The app may ignore `prefers-color-scheme` (see Dark mode).
5. Park the pointer with a real `hover` on an element, so the first `--human` path starts on-screen.

### 3. One script for the take (`record.sh`)

- `set -euo pipefail` plus `trap cleanup EXIT`. The cleanup runs `record stop --json` (if recording) and `close`, so nothing is left running after a failure.
- `record start <raw.mp4> --contact-sheet` at the default 30 fps. **Don't** pass `--cursor` when using `cursor.js`, or there will be two pointers.
- **Look up refs right before each click**, and exit on the first missing one. Refs go stale after any DOM change ("Unknown ref"). When several elements match (e.g. a "Details" button per row), scope the lookup to a parent: `ref_after '<parent pattern>' '<target pattern>'` in `record.sh`.
- **Click with `click <ref> --human --duration 850`.** This moves the pointer along a path, 30–100 px per frame at 30 fps. It was stable on every click, including in-app navigation. Short moves finish faster than `--duration`.
- **After every action, force repaints and hold:** screenshot → `sleep 0.7` → screenshot → `sleep 2.6`, which is about 4 s per step. Without the forced screenshots, headless Chrome sometimes stopped painting after a MUI menu or drawer opened, leaving long frozen stretches and half-drawn frames.
- **Navigate by clicking inside the app.** `open <url>` during the take flashes a white page and "Loading…" for about 1 s, and was the slowest step (3.2 s).
- For text, use `keyboard inserttext`. `keyboard type` goes key by key and took about 30 s for one field during recording.
- Log each step's time to a file; it shows where the time goes.

### 4. Verify every take

- Run `record stop --json` and look at `frames` against `capturedFrames`.
  - `frames` is duration × fps; `capturedFrames` counts distinct frames Chrome actually sent.
  - A healthy take: 1189 / 537 (v2), 667 / 190 (v1). A frozen take gives `capturedFrames` of 1–2.
- **Don't rely on the `--contact-sheet` PNG for quality.** It picks frames that changed by at least 5%, so it is mostly mid-animation frames.
- **Pull one frame per step with ffmpeg and look at it.** Also crop 3–4 consecutive frames during one move to confirm the pointer travels rather than jumps, and check that the click ring shows.

### 5. Trim (`trim.sh`)

- `ffmpeg … -vf freezedetect=n=-90dB:d=<KEEP>` finds still stretches; cut each to `KEEP` seconds (2.5 s worked) with `select='not(between(t,a,b)+…)',setpts=N/FRAME_RATE/TB`.
- **Use `n=-90dB`, not `-60dB`.** At -60 dB the moving 24 px pointer counted as "still", and the trim cut out the pointer's travel and the click ring.
- Some stills are never detected, because pages with small continuous repaints keep the full hold. That's acceptable.
- Finish with `ffprobe` for the duration and a 4x4 contact sheet of the final video (`fps=16/<duration>,scale=640:-1,tile=4x4`), then look at it.
- Pacing: ~4 s hold trimmed to 2.5 s, over 8 steps, gave 34 s. A ~2 s hold was too fast for viewers.

## Dark mode

- `--color-scheme dark` (or `AGENT_BROWSER_COLOR_SCHEME=dark`) only sets `prefers-color-scheme`. Apps that store a theme preference can override it.
- In the example app the theme comes from localStorage **and** a user profile field loaded via JSON fetch responses. Rather than write to the profile, supply `DEMO_THEME_STORAGE_KEY` and `DEMO_THEME_PROFILE_FIELD` at runtime. `cursor.js` sets that localStorage key and rewrites that field's `light`/`system` values to `dark`, only for the configured app origin in that browser.
- For another app, find where it reads the theme before choosing an override.

## Cursor and clicks (`cursor.js`)

- The built-in `--cursor` has no size or colour options. Restyling its overlay was never tried.
- `cursor.js` draws its own overlay:
  - A macOS-style arrow, 24 px tall: black fill, white 1.5 px outline, soft drop shadow. It is `position:fixed` with `pointer-events:none`, top z-index and `aria-hidden`.
  - It follows `mousemove`/`pointermove` with an 80 ms transform transition.
  - On `mousedown` it shows a flashy magenta (`#FF2BD6`) ring growing 20→70 px with a glow over 450 ms, plus a 0.9× press-scale on the arrow.
  - It re-mounts itself when the page re-renders (MutationObserver on `documentElement`).
- `window.__glide(x, y, ms)` animates the overlay without real mouse events. It's there as a fallback in case `--human` misbehaves, but it was never needed.

## Pitfalls seen

- **`mouse move` / `mouse down` / `mouse up` hung the session daemon** ("Resource temporarily unavailable (os error 35)"), and `close` hung afterwards. The only workaround was a new session name. Use `click --human` and `hover` instead.
- `find role button click --name "close"` clicked the wrong button (it opened the user menu). Use scoped snapshot refs instead.
- When grepping `snapshot -i`, a row's button isn't always on the line after the row (`grep -A1` missed it). Scope with an awk range (`ref_after`) instead.
- After in-app navigation, a drawer's slide-in once stalled off-screen and clicks did nothing until a screenshot forced a paint. The forced screenshots after each step cover this.
- Recording follows wall-clock time. Slow commands make long videos, so keep every command inside the take fast.
- macOS has no `timeout` command. Guard tests some other way, or skip the guard.
- Vite HMR inside a podman container sometimes missed source edits (the page kept serving the old module). Restarting only the app container fixed it. Confirm the page serves current code before recording.

## App-specific assumptions in the examples

- `prep.sh`: the SSO login flow (SSO LOGIN → email/password → Grant Access → Agent Home). The origin, persona and starting page come exclusively from runtime variables.
- `record.sh`: the remaining generic step selectors, wait texts and flow (tariff → version → Charges tab → Charge Canvas → charge Details → Version dropdown → second version → close). Record names and option labels come exclusively from runtime variables.
- `cursor.js`: theme overrides are opt-in and supplied through runtime variables; no internal hostname, storage key or profile field is embedded in the source.
- Output file names retain the generic `v2-` prefix from the take the scripts were adapted from.
