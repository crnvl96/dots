#!/usr/bin/env bash
# Check the installed counterparts of the top-level folders in home/.
# Exit codes: 0 = clean, 1 = dangling links, 2 = scan error.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
roots=()

for source in "$repo_root"/home/* "$repo_root"/home/.[!.]*; do
  [[ -d "$source" ]] || continue
  destination="$HOME/${source##*/}"
  if [[ -e "$destination" || -L "$destination" ]]; then
    roots+=("$destination")
  fi
done

if [[ ${#roots[@]} -eq 0 ]]; then
  echo "No bootstrap destination folders exist yet."
  exit 0
fi

printf 'Checking %s\n' "${roots[@]}"

# Follow symlinks used as scan roots, but do not traverse nested directory links.
if ! dangling=$(find -H "${roots[@]}" -type l ! -exec test -e {} \; \
  -exec sh -c 'for link do printf "%s -> %s\n" "$link" "$(readlink "$link")"; done' sh {} +); then
  echo "Could not complete the symlink scan." >&2
  exit 2
fi

if [[ -n "$dangling" ]]; then
  printf '\nDangling symlinks:\n%s\n' "$dangling"
  exit 1
fi

echo "No dangling symlinks found."
