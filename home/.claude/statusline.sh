#!/usr/bin/env bash
# Claude Code status line:
#   line 1: plan usage (5-hour / weekly) with reset countdowns · context window
#   line 2: model · effort · repo/worktree (branch)
#
# Palette — color only where it carries meaning:
#   structure  labels, separators, units, token counts       dim (adapts to light/dark)
#   identity   model (bold), repo/worktree, branch            default fg · steel blue · mauve
#   load       every "how full" meter (ctx, 5h, week)         sage → amber → coral
#   time       countdown to a reset                           gray → teal as the reset nears
input=$(cat)

j() { jq -r "$1 // empty" <<<"$input" 2>/dev/null; }

c() { printf '\033[38;5;%dm' "$1"; }
rst=$'\033[0m'
dim=$'\033[2m'
bold=$'\033[1m'
repo_c=$(c 110)
branch_c=$(c 139)
sep=" ${dim}·${rst} "

# Load color for a percentage: sage < 50 ≤ amber < 80 ≤ coral
load() {
  local p=${1%.*}
  if [ "$p" -ge 80 ]; then c 167; elif [ "$p" -ge 50 ]; then c 179; else c 108; fi
}

# Meter: colored filled run + dim track, then the percentage in the same color
meter() { # $1 percentage, $2 slots
  local p=${1%.*} n=$2 col filled run="" track="" i
  col=$(load "$p")
  filled=$((p * n / 100))
  for ((i = 1; i <= n; i++)); do [ "$i" -le "$filled" ] && run+="━" || track+="─"; done
  printf '%s' "${col}${run}${rst}${dim}${track}${rst} ${col}${p}%${rst}"
}

# --- Model ---
model=$(j '.model.display_name')
[ -z "$model" ] && model=$(j '.model.id')

# --- Effort (status line JSON first, then env, then settings) ---
effort=$(j '.effort.level // (.effort | strings) // .reasoning_effort')
[ -z "$effort" ] && effort=${CLAUDE_CODE_EFFORT_LEVEL:-}
if [ -z "$effort" ]; then
  for f in .claude/settings.local.json .claude/settings.json "$HOME/.claude/settings.json"; do
    [ -f "$f" ] && effort=$(jq -r '.effortLevel // empty' "$f" 2>/dev/null)
    [ -n "$effort" ] && break
  done
fi
[ -z "$effort" ] && effort="default"

# --- Context window ---
pct=$(j '.context_window.used_percentage')
size=$(j '.context_window.context_window_size')
used=$(j '(.context_window.current_usage | if type=="object" then (.input_tokens + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)) else empty end)')
if [ -z "$pct" ] && [ -n "$used" ] && [ -n "$size" ] && [ "$size" -gt 0 ] 2>/dev/null; then
  pct=$((used * 100 / size))
fi
human() { awk -v n="$1" 'BEGIN{ if (n>=1000000) printf "%.1fM", n/1000000; else if (n>=1000) printf "%dk", n/1000; else printf "%d", n }'; }
if [ -n "$pct" ]; then
  ctx="${dim}ctx${rst} $(meter "$pct" 8)"
  [ -n "$size" ] && ctx+=" ${dim}$(human "$size")${rst}"
else
  ctx="${dim}ctx n/a${rst}"
fi

# --- Repo / worktree ---
# Cap long names to their first 32 chars: "first-32-chars..."
cap() {
  local s=$1
  [ "${#s}" -gt 32 ] && s="${s:0:32}..."
  printf '%s' "$s"
}
dir=$(j '.workspace.current_dir')
[ -z "$dir" ] && dir=$(j '.cwd')
[ -z "$dir" ] && dir=$PWD
loc=""
if top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null); then
  branch=$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null)
  [ -z "$branch" ] && branch=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null)
  gitdir=$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null)
  common=$(cd "$dir" && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
  repo=$(basename "$(dirname "$common")")
  loc="${repo_c}$(cap "$repo")${rst}"
  if [ -n "$gitdir" ] && [ "$gitdir" != "$common" ]; then
    loc+=" ${dim}⎇ wt:${rst}${repo_c}$(cap "$(basename "$top")")${rst}"
  fi
  [ -n "$branch" ] && loc+=" ${dim}(${rst}${branch_c}$(cap "$branch")${rst}${dim})${rst}"
else
  loc="${repo_c}$(cap "$(basename "$dir")")${rst}"
fi

# --- Plan usage (5h / weekly) ---
until_reset() {
  local s=$(($1 - $(date +%s)))
  [ "$s" -le 0 ] && return
  local d=$((s / 86400)) h=$((s % 86400 / 3600)) m=$((s % 3600 / 60))
  if [ "$d" -gt 0 ]; then printf '%dd%dh' "$d" "$h"; elif [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"; else printf '%dm' "$m"; fi
}
# Time color: gray while most of the window is ahead, teal as the reset nears
tc() { # $1 resets_at, $2 window length in seconds
  local left=$((($1 - $(date +%s)) * 100 / $2))
  if [ "$left" -ge 66 ]; then
    c 244
  elif [ "$left" -ge 33 ]; then
    c 109
  elif [ "$left" -ge 10 ]; then
    c 73
  else c 43; fi
}
limit() { # $1 label, $2 jq path, $3 window length in seconds
  local pct at out r
  pct=$(j ".rate_limits.$2.used_percentage")
  at=$(j ".rate_limits.$2.resets_at")
  [ -z "$pct" ] && return
  out="${dim}$1${rst} $(meter "$pct" 8)"
  [ -n "$at" ] && r=$(until_reset "${at%.*}") && [ -n "$r" ] && out+=" $(tc "${at%.*}" "$3")${r}${rst}"
  printf '%s' "$out"
}
u5=$(limit "5h" five_hour 18000)
u7=$(limit "week" seven_day 604800)
usage="${u5}${u5:+${u7:+${sep}}}${u7}"

printf '%s\n' "${usage}${usage:+${sep}}${ctx}"
printf '%s\n' "${bold}${model}${rst}${sep}${dim}eff:${rst}${effort}${sep}${loc}"
