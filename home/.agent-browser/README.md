# Browser demos

`browser-demo` uses smooth pointer movement by default. Recordings default to
60 fps and show a cyan/purple neon cursor, glow, and a double-ring click burst.
The cursor is an inert recording overlay, not an OS cursor replacement. Effects
survive page navigation and are removed when recording stops.

Requires Node.js 22+ (native WebSocket), `agent-browser`, Chrome, and `ffmpeg`.

## Open a demo

```sh
browser-demo https://github.com/react/react --session demo
export AGENT_BROWSER_SESSION=demo
export AGENT_BROWSER_INPUT_MODE=smooth
agent-browser --cdp 9002 --pin-tab snapshot -i
browser-demo record ~/Downloads/demo.mp4 --session demo
# Interact using agent-browser; take a fresh snapshot after navigation.
browser-demo stop --session demo
```

A fresh Chrome launch reuses its startup tab instead of leaving an extra blank
tab behind. Reusing an existing Chrome creates exactly one isolated demo tab,
without navigating or closing existing tabs.

## Attach to a page you opened yourself

Chrome must already expose a CDP endpoint. The Chrome opened by `chrome-debug`
or `browser-demo` exposes port 9002 by default; browse to your desired page in
that Chrome yourself before attaching.

```sh
# Discover existing tabs without creating one.
agent-browser --session manual-demo --cdp 9002 --no-pin-tab tab list

# Replace t1 with the id of your chosen tab from the list.
browser-demo attach --session manual-demo --port 9002 --tab t1

# Subsequent commands stay on that tab.
agent-browser --session manual-demo --cdp 9002 --pin-tab snapshot -i
browser-demo record ~/Downloads/manual-demo.mp4 --session manual-demo
browser-demo stop --session manual-demo
```

`attach` does not launch Chrome, create a tab, navigate, reload, or resize the
page. It fails if the endpoint or tab is unavailable. Target ids from
`tab list --json` can be used instead of session-local `t1` ids.

**Important:** on the first connection, `--pin-tab` intentionally opens a new
tab when the session has no binding. Discover with `--no-pin-tab` first, select
the existing tab, then enable pinning. The wrapper handles this sequence.

Without the wrapper:

```sh
agent-browser --session manual --cdp 9002 --no-pin-tab tab list
agent-browser --session manual --cdp 9002 --pin-tab tab t1
agent-browser --session manual --cdp 9002 --pin-tab snapshot -i
```

For a separate manually controlled debug Chrome on macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.local/state/agent-browser/manual-chrome"
```

Open your page in that window, then use `--port 9222` / `--cdp 9222` in the
commands above. Modern Chrome requires a non-default profile for this
command-line debugging setup. An ordinary Chrome window with remote debugging
disabled cannot be attached to through CDP. Never expose the debugging port to
untrusted networks.

## Movement and capture

- `--input-mode smooth` is the default; `human` and `instant` remain available.
- `~/.agent-browser/config.json` also defaults normal agent-browser commands to
  `smooth`, so subsequent commands do not silently switch back to instant moves.
- Override recording frame rate with `browser-demo record ... --fps 30`.
- For slower, explicitly scheduled movements:
  `agent-browser mouse move 700 380 --duration 800 --steps 60`.
- Always use `browser-demo stop` to save the recording and stop its cursor
  worker. The worker owns only its selected page's CDP connection, never Chrome.

## Tests

```sh
node --test home/.agent-browser/cli.test.mjs
```
