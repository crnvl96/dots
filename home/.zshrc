# Load machine-specific secrets kept outside this repository.
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

export CONTAINERS_MACHINE_PROVIDER="libkrun"

zed() {
  if (( $# == 0 )); then
    command zed zed://open
  else
    command zed --existing "$@"
  fi
}

wt() {
  git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' |
  while IFS= read -r dir; do
    [ -d "$dir" ] || { printf '\033[31m%-24s\033[0m (missing; run git worktree prune)\n' "${dir##*/}"; continue; }
    branch=$(git -C "$dir" branch --show-current); branch=${branch:-"(detached)"}
    dirty=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    ab=$(git -C "$dir" rev-list --left-right --count '@{u}...HEAD' 2>/dev/null | awk '{printf "↓%s ↑%s", $1, $2}')
    last=$(git -C "$dir" log -1 --format='%cr' 2>/dev/null)
    mark=$([ "$dir" = "$(git rev-parse --show-toplevel)" ] && echo '*' || echo ' ')
    state=$([ "$dirty" -gt 0 ] && printf '\033[33m%3s changed\033[0m' "$dirty" || printf '\033[32m%11s\033[0m' clean)
    printf '%s \033[1m%-24.24s\033[0m %-60.60s %b  %-9s \033[2m%s\033[0m\n' \
      "$mark" "${dir##*/}" "$branch" "$state" "${ab:-no upstream}" "$last"
  done
}

bindkey -e                        # Use Emacs line editing even when EDITOR/VISUAL points to nvim.
autoload -Uz compinit && compinit # git completion

eval "$(~/.local/bin/mise activate zsh)" # mise
eval "$(starship init zsh)"             # starship
