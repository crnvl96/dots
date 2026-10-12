#!/usr/bin/env bash
# One take of the read-only charge-version demo, dark mode, macOS-style cursor (cursor.js),
# smooth pointer moves via `click --human`. Usage: record.sh <session>
# Precondition: prep.sh <session> left the Tariffs list as the active tab.
set -euo pipefail
S="${1:?Usage: record.sh <session>}"; D="$(cd "$(dirname "$0")" && pwd)"
: "${DEMO_TARIFF_NAME:?Set DEMO_TARIFF_NAME to the authorized demo record}"
: "${DEMO_CHARGE_NAME:?Set DEMO_CHARGE_NAME to the visible charge list-item name}"
: "${DEMO_VERSION_ONE_LABEL:?Set DEMO_VERSION_ONE_LABEL to the first option label}"
: "${DEMO_VERSION_TWO_LABEL:?Set DEMO_VERSION_TWO_LABEL to the second option label}"
source "$D/runtime.sh"
MOVE_MS=${MOVE_MS:-850}   # pointer travel per click
HOLD=${HOLD:-2.6}         # extra hold after the two repaint screenshots (~4 s per step)
TMP="$D/.tmp"; mkdir -p "$TMP"
RAW="$D/v2-raw.mp4"; rm -f "$RAW" "$D/v2-stop.json" "$D/v2-timings.txt"
AB() { agent-browser --session "$S" "$@"; }
RECORDING=0

cleanup() {
  rc=$?
  if [ "$RECORDING" = 1 ]; then AB record stop --json > "$D/v2-stop.json" 2>&1 || true; fi
  AB close >/dev/null 2>&1 || true
  rm -f "$DEMO_INIT_SCRIPT"
  echo "cleanup done (exit $rc), session $S closed"
}
trap cleanup EXIT

now() { python3 -c 'import time; print(time.time())'; }
ref() {
  local r
  r=$(AB snapshot -i | grep -F "$1" | head -1 | sed -nE 's/.*ref=(e[0-9]+).*/@\1/p')
  [ -n "$r" ] || { echo "MISSING snapshot reference; inspect the authorized page privately" >&2; exit 1; }
  echo "$r"
}
ref_after() {
  local r
  r=$(AB snapshot -i | awk -v a="$1" -v t="$2" 'index($0,a) {f=1} f && index($0,t) {print; exit}' | sed -nE 's/.*ref=(e[0-9]+).*/@\1/p')
  [ -n "$r" ] || { echo "MISSING scoped snapshot reference; inspect the authorized page privately" >&2; exit 1; }
  echo "$r"
}
glide_click() { AB click "$1" --human --duration "$MOVE_MS" >/dev/null; }
settle() {
  AB screenshot "$TMP/a.png" >/dev/null
  sleep 0.7
  AB screenshot "$TMP/b.png" >/dev/null
  sleep "$HOLD"
}
T0=0
step() {
  local label="$1"; shift
  local t1; t1=$(now)
  "$@"
  local t2; t2=$(now)
  printf '%-30s action %5.2fs  (ends t=%5.1fs)\n' "$label" "$(echo "$t2 - $t1" | bc)" "$(echo "$t2 - $T0" | bc)" | tee -a "$D/v2-timings.txt"
}

# Park the pointer (real mouse event, so --human paths start here and the overlay is visible).
AB hover "$(ref 'heading "Tariffs"')" >/dev/null

AB record start "$RAW" --contact-sheet   # no --cursor: cursor.js draws the only pointer
RECORDING=1
T0=$(now)
settle

s1() { glide_click "$(ref "row \"$DEMO_TARIFF_NAME")"; AB wait --text "Effective start" >/dev/null; }
step "1 open tariff" s1; settle
s2() { glide_click "$(ref_after 'row "v1 ' 'button "Edit"')"; AB wait --text "Eligibility" >/dev/null; }
step "2 open version v1" s2; settle
s3() { glide_click "$(ref 'tab "Charges')"; AB wait --text "Open Charge Canvas" >/dev/null; }
step "3 charges tab" s3; settle
s4() { glide_click "$(ref 'button "Open Charge Canvas"')"; AB wait --text "Click a row to highlight" >/dev/null; }
step "4 open charge canvas" s4; settle
s5() { glide_click "$(ref_after "listitem \"$DEMO_CHARGE_NAME" 'button "Details"')"; AB wait --text "Charge header" >/dev/null; }
step "5 open details drawer" s5; settle
s6() { glide_click "$(ref 'combobox "Version"')"; AB wait --text "$DEMO_VERSION_ONE_LABEL" >/dev/null; }
step "6 open version dropdown" s6; settle
s7() { glide_click "$(ref "option \"$DEMO_VERSION_TWO_LABEL\"")"; AB wait --text "View charge" >/dev/null; }
step "7 pick V2" s7; settle
s8() { glide_click "$(ref 'button "close"')"; AB wait --fn '!document.querySelector(".MuiDrawer-root .MuiPaper-root")' >/dev/null; }
step "8 close drawer" s8; settle

AB record stop --json > "$D/v2-stop.json"
RECORDING=0
cat "$D/v2-stop.json"; echo
