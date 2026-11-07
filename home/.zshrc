# Load machine-specific secrets kept outside this repository.
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

export CONTAINERS_MACHINE_PROVIDER="libkrun"

bindkey -e                        # Use Emacs line editing even when EDITOR/VISUAL points to nvim.
autoload -Uz compinit && compinit # git completion

eval "$(~/.local/bin/mise activate zsh)" # mise

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

# Minimal prompt: read only Git metadata, using zsh builtins throughout.
_minimal_prompt_git() {
  emulate -L zsh
  local root=${PWD:A} gitdir head

  # Reserve psvar[1:2] for the worktree and branch; %v displays names literally.
  psvar[1]=''
  psvar[2]=''

  # Rediscover each time so git init/switch and nested repositories stay current.
  while [[ ! -d $root/.git && ! -f $root/.git ]]; do
    # Bare repositories and Git's administrative directories have no worktree.
    [[ -f $root/HEAD && ( -d $root/objects || -f $root/commondir ) ]] && return 0
    [[ $root == / ]] && return 0
    root=${root:h}
  done

  gitdir=$root/.git
  if [[ -f $gitdir ]]; then
    # Linked worktrees and submodules point to their metadata with a gitfile.
    { IFS= read -r gitdir < "$gitdir"; } 2>/dev/null || return 0
    [[ $gitdir == 'gitdir: '?* ]] || return 0
    gitdir=${gitdir#gitdir: }
    [[ $gitdir == /* ]] || gitdir=$root/$gitdir
  fi

  { IFS= read -r head < "$gitdir/HEAD"; } 2>/dev/null || return 0
  if [[ $head == 'ref: refs/heads/'?* ]]; then
    psvar[2]=${head#ref: refs/heads/}
  elif [[ ( ${#head} == 40 || ${#head} == 64 ) && $head != *[^0-9a-f]* ]]; then
    psvar[2]="detached@${head[1,7]}"
  else
    return 0
  fi
  psvar[1]=${(V)root:t}
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _minimal_prompt_git
PROMPT='%F{cyan}%~%f %(1V.[%F{blue}%1v%f:%F{magenta}%2v%f] .)❯ '
RPROMPT=''
