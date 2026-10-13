# Agent browser

Repo-managed defaults and two commands for local Chrome screenshots and demos.
Requires Node 24, Google Chrome, agent-browser 0.39.0 or newer, and ffmpeg for recording.
Mise already declares Node and agent-browser; the global Brew package list declares ffmpeg.

## Install

From the dotfiles repo, preview and apply the existing home-directory mapping:

```sh
mise bootstrap --only dotfiles --dry-run
mise bootstrap --only dotfiles --yes
```

This seeds `~/.agent-browser/` and the executable commands in `~/.local/bin/`.
That bin directory must be on PATH (it already is on this machine).
If an existing shell still has the old alias, run `unalias chrome-debug` or open a new shell.

## One-step demo setup

```sh
browser-demo http://localhost:3000 --session product-demo --wait '#app-ready'
```

Defaults: CDP port **9002**, viewport **1440×900 CSS pixels**, **2× device scale**,
**dark color preference**, and **human pointer movement**. PNG screenshots are
2880×1800 without changing the responsive layout. Dark preference does not force
an app that overrides its own theme to become dark.

The command starts or reuses its dedicated Chrome, attaches agent-browser, opens
a **new pinned tab**, applies settings before navigation, and waits for the DOM,
the optional readiness selector, loaded fonts, and two render frames. It does not
use arbitrary page sleeps or `networkidle` (which hangs on many live apps).

If `--session` is omitted, a stable name is derived from the current worktree and
port. The command prints the name and subsequent commands. It cannot export
variables into the parent shell; copy its printed `export` if desired:

```sh
export AGENT_BROWSER_SESSION=product-demo
agent-browser snapshot -i
agent-browser click @e3
```

Human mode persists in the configured session. Native `--human`, `--duration`,
`--steps`, and `--seed` remain available for individual mouse actions. No injected
mouse-movement script or custom pointer overlay is needed.

Overrides:

```sh
browser-demo https://example.com --port 9222 --session another-demo \
  --viewport 1920x1080 --scale 2 --input-mode smooth
```

Each setup invocation opens a new tab rather than navigating a tab chosen
implicitly by CDP attachment. Different sessions may share the browser on a port,
but have their own bound tabs. Use different ports for separate browser profiles
and authentication contexts. Do not operate on one session concurrently.

## Screenshots and recordings

```sh
browser-demo screenshot ./artifacts/page.png --session product-demo --wait '#ready'
browser-demo screenshot ./artifacts/full.png --session product-demo --full

browser-demo record ./artifacts/demo.mp4 --session product-demo
agent-browser --session product-demo click @e3
agent-browser --session product-demo drag @e1 @e2 --human
browser-demo stop --session product-demo
```

Capture helpers require an active named session and preserve its existing viewport
and scale. They do not silently start a fresh browser if that session is missing.
Output paths can contain spaces; parent directories are created automatically.

- Screenshots use lossless PNG. `--full` captures the full page.
- Videos use MP4/H.264 or WebM/VP8, **30 fps**, and the native animated pointer
  with click ripple. Add `--fps 60` for short motion-heavy takes.
- Recording starts on the existing page: no reload, no cold hydration, no lost auth.
- Take clean screenshots **before starting or after stopping recording**. The
  recording pointer overlay is included in screenshots taken during recording.
- Use `--wait <selector>` for application-specific readiness. Fonts and render
  frames do not guarantee data loading, image decoding, or animation completion.
- Prefer normal motion for demos. For stable screenshots of animated apps, opt
  into `agent-browser --session product-demo set media dark reduced-motion` when
  appropriate; the helpers do not alter application animation settings.
- Native extras are available directly: `record start ... --contact-sheet`,
  `screenshot --annotate`, or `screenshot --if-changed` for agent inspection.

## Chrome only

```sh
chrome-debug https://example.com
chrome-debug http://localhost:3000 --port 9222 --timeout 20
```

This replaces the old URL-specific shell alias. It starts a detached Chrome,
waits up to 15 seconds for CDP, and prints an explicit attachment command.
When reusing its browser it opens the requested URL in a new tab.

Only a Chrome whose PID, profile, port, and CDP endpoint match the launcher's
ownership record is reused. An unrelated listener is rejected; choose another
port rather than killing it. CDP uses loopback, with a dedicated profile separate
from your personal Chrome. **Do not expose or forward the CDP port to untrusted
clients:** anyone with access can control the browser and read authenticated data.

Profiles are persistent to retain test logins, not disposable `/tmp` profiles:

```text
~/.local/state/agent-browser/chrome/<port>/
├── profile/       # cookies, login state, browser cache; never commit
├── owner.json    # managed PID and CDP identity
└── chrome.log    # startup diagnostics
```

Quit the dedicated Chrome window when done. `agent-browser close` disconnects the
session; externally launched Chrome is not owned by agent-browser. To reset login
state, quit that Chrome first, then remove its port-specific state directory.
After a failed startup, inspect `chrome.log` and close any partially started
Chrome before retrying. If a launcher was killed and left `launch.lock`, ensure no
launch is in progress before removing that lock directory.

Environment overrides:

- `CHROME_DEBUG_EXECUTABLE`: Chrome binary path; defaults to the macOS Google Chrome executable.
- `CHROME_DEBUG_STATE_DIR`: parent directory for port-specific profiles and ownership files.

## Global defaults

`config.json` supplies **dark**, **PNG**, and **instant** movement for ordinary
agent-browser usage. Demo setup opts its own session into **human** movement.
A fixed port, profile, session, disabled TLS checks, and recording cursor are not
global defaults.

Native precedence: user `~/.agent-browser/config.json` → project
`./agent-browser.json` → environment → CLI flags. Viewport/scale are runtime
commands, not invented config keys. Run `agent-browser skills get core --full`
for version-matched documentation and `agent-browser doctor` for diagnostics.

## Checks

No npm dependencies or root tasks are added. From this directory:

```sh
npm test
node --check cli.mjs
oxlint .
oxfmt --check .
shellcheck --shell=sh ../.local/bin/chrome-debug ../.local/bin/browser-demo
shfmt -ln posix -i 2 -d ../.local/bin/chrome-debug ../.local/bin/browser-demo
```

Tests use local fake browser processes to verify argument validation, session/tab
setup, readiness, safe reuse, ownership rejection, and startup failures without
opening real Chrome. Real screenshot/video smoke tests can use a local test app
and an unused port; keep artifacts outside this repository.
