# Dots

Personal dotfiles, managed by [mise](https://mise.jdx.dev/).

## Task list

```terminal
mise run <task>                            # Run any task below by its full name
├── format                                 # Format Neovim and Pi configurations
│   ├── nvim:format                        # Format Neovim Lua using .stylua.toml
│   └── pi:format                          # Format Pi extensions and JSON using .oxfmtrc.json
├── lint                                   # Lint Pi extensions
│   └── pi:lint                            # Lint extensions using .oxlintrc.json; reject warnings
├── typecheck                              # Typecheck Pi extensions
│   └── pi:typecheck                       # Install dependencies, then typecheck using tsconfig.json
│       └── pi:deps                        # Install development dependencies from the lockfile
├── bootstrap:preview                      # Preview all currently loaded bootstrap configuration
├── bootstrap:apply                        # Bootstrap every scope, starting with dotfiles
│   ├── bootstrap:dotfiles                 # Preview and link repository-managed dotfiles
│   └── bootstrap:without-dotfiles         # Bootstrap remaining scopes sequentially, then verify
│       ├── bootstrap:brew                 # Preview and install declared Homebrew packages
│       ├── bootstrap:macos                # Preview and apply macOS defaults and LaunchAgents
│       ├── bootstrap:tools                # Preview and install mise tools, then development dependencies
│       │   └── pi:deps                    # Install development dependencies from the lockfile
│       └── bootstrap:check                # Check Git whitespace, working tree, and bootstrap state
├── pi:deps:upgrade                        # Sync dev dependencies with installed Pi, its TypeBox, and active Node
│   └── pi:deps:upgrade:preview             # Preview dependency versions without installing them
├── brew:upgrade                           # Preview and upgrade declared Homebrew packages
│   └── brew:upgrade:preview               # Preview Homebrew package upgrades without applying them
└── tools:upgrade                          # Preview and upgrade configured mise tools within their version constraints
    └── tools:upgrade:preview              # Preview mise tool upgrades without applying them
```

## Common workflows

Run these commands from the repository root with mise available.

In Pi, use the repository-local `/skill:dots [goal]` skill to be interviewed, agree on a scoped plan, and have the appropriate workflow executed and verified. This skill is user-invocable only; Pi will not select it automatically. The workflows below are common examples, not the only supported routes. Use `/reload` after adding or changing the skill in an active Pi session.

### Bootstrap a machine

```sh
# Link dotfiles first, then install packages and tools, apply macOS settings, and verify
mise run bootstrap:apply
```

If dotfiles are already linked and should remain untouched, use `mise run bootstrap:without-dotfiles` instead. Each scope previews its changes before applying them.

### Upgrade Pi and its development dependencies

```sh
# Upgrade only the mise-managed Pi package
mise upgrade npm:@earendil-works/pi-coding-agent --yes

# Sync dev dependencies with installed Pi, its actual TypeBox version, and active Node
mise run pi:deps:upgrade

# Verify extension compatibility with the updated dependencies
mise run typecheck
```

Use the same dependency-sync step after changing the configured Node major. Commit the resulting `package.json` and `package-lock.json` changes together.

### Format and validate configuration changes

```sh
# Format Neovim and Pi configurations
mise run format

# Check Pi extensions for lint errors and warnings
mise run lint

# Install locked dev dependencies and check extension types
mise run typecheck
```
