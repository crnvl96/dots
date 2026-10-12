#!/usr/bin/env bash
# Prepare a logged-in, dark-mode session outside the recording.
# Usage: prep.sh <session>; see ../../references/demo-videos.md for runtime variables.
set -euo pipefail
S="${1:?Usage: prep.sh <session>}"; D="$(cd "$(dirname "$0")" && pwd)"
: "${DEMO_EMAIL:?Set DEMO_EMAIL at runtime}"
: "${DEMO_PASSWORD:?Set DEMO_PASSWORD securely at runtime}"
: "${DEMO_START_PATH:?Set DEMO_START_PATH to the authorized starting route}"
: "${DEMO_START_TEXT:?Set DEMO_START_TEXT to a visible marker on the start page}"
[[ "$DEMO_START_PATH" == /* && "$DEMO_START_PATH" != //* ]] || { echo "DEMO_START_PATH must be an app-relative path" >&2; exit 1; }
source "$D/runtime.sh"
trap 'rm -f "$DEMO_INIT_SCRIPT"' EXIT
AB() { agent-browser --session "$S" "$@"; }
ref() { AB snapshot -i | grep -F "$1" | head -1 | sed -nE 's/.*ref=(e[0-9]+).*/@\1/p'; }
AB set viewport 1600 1000 >/dev/null
AB open "$DEMO_BASE_URL/" >/dev/null
AB wait --text "SSO LOGIN" >/dev/null
AB click "$(ref 'button "SSO LOGIN"')" >/dev/null
AB wait --text "Log in to Your Account" >/dev/null
# Do not enable shell tracing or log credential values.
AB fill "$(ref 'textbox "Email Address"')" "$DEMO_EMAIL" >/dev/null
AB fill "$(ref 'textbox "Password"')" "$DEMO_PASSWORD" >/dev/null
AB click "$(ref 'button "Login"')" >/dev/null
AB wait --text "Grant Access" >/dev/null
AB click "$(ref 'button "Grant Access"')" >/dev/null
AB wait --text "Agent Home" >/dev/null
# Start page: full load in a fresh tab, then close the old tab.
OLD=$(AB tab list | grep -E '^→' | sed -E 's/.*\[(t[0-9]+)\].*/\1/')
AB tab new "$DEMO_BASE_URL$DEMO_START_PATH" >/dev/null
AB wait --text "$DEMO_START_TEXT" >/dev/null
AB tab close "$OLD" >/dev/null
# Check the applied theme and cursor without exposing the app's storage keys.
AB eval 'JSON.stringify({bg: getComputedStyle(document.body).backgroundColor, cursor: !!document.getElementById("__demo-cursor"), glide: typeof window.__glide})'
AB screenshot "$D/v2-prep-dark.png" >/dev/null
