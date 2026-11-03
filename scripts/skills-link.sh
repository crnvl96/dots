#!/usr/bin/env bash
set -euo pipefail

src_root="home/.agents/skills"
dst_root="home/.claude/skills"

git ls-files -z -- "$src_root" | while IFS= read -r -d '' src; do
  rel="${src#"$src_root"/}"
  case "$rel" in
    .DS_Store|*/.DS_Store|node_modules/*|*/node_modules/*|.git/*|*/.git/*) continue ;;
  esac

  dest="$dst_root/$rel"
  mkdir -p "$(dirname "$dest")"
  target="$(python3 -c 'import os, sys; print(os.path.relpath(sys.argv[1], os.path.dirname(sys.argv[2])))' "$src" "$dest")"

  if [[ -L "$dest" && "$(readlink "$dest")" == "$target" ]]; then
    echo "$dest -> $target"
    continue
  fi
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "refuse: $dest exists and is not a symlink" >&2
    exit 1
  fi
  if [[ -L "$dest" ]]; then
    ln -sfn "$target" "$dest"
  else
    ln -s "$target" "$dest"
  fi
  echo "$dest -> $target"
done
