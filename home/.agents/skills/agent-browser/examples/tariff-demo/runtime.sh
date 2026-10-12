#!/usr/bin/env bash
# Shared runtime configuration. Source this from prep.sh or record.sh.
# Never put credentials or identifying demo values in these tracked examples.
: "${DEMO_BASE_URL:?Set DEMO_BASE_URL to the authorized app origin at runtime}"
DEMO_BASE_URL=${DEMO_BASE_URL%/}
export AGENT_BROWSER_COLOR_SCHEME=dark

# Browser init scripts cannot read shell environment variables. Generate a temporary
# script containing only the origin and optional theme keys, never credentials.
DEMO_INIT_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/agent-browser-demo.XXXXXX")
if ! python3 - "$D/cursor.js" "$DEMO_INIT_SCRIPT" <<'PY'
import json, os, sys
from urllib.parse import urlsplit

url = urlsplit(os.environ["DEMO_BASE_URL"])
if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
    raise SystemExit("DEMO_BASE_URL must be an HTTP(S) origin without credentials, a path, query, or fragment")
config = {
    "origin": f"{url.scheme}://{url.netloc}",
    "themeStorageKey": os.environ.get("DEMO_THEME_STORAGE_KEY", ""),
    "themeProfileField": os.environ.get("DEMO_THEME_PROFILE_FIELD", ""),
}
with open(sys.argv[1]) as source, open(sys.argv[2], "w") as output:
    output.write("window.__demoConfig = " + json.dumps(config) + ";\n")
    output.write(source.read())
PY
then
  rm -f "$DEMO_INIT_SCRIPT"
  exit 1
fi
export AGENT_BROWSER_INIT_SCRIPTS="$DEMO_INIT_SCRIPT"
