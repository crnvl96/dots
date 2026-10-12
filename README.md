# Dots

Personal dotfiles, managed by [mise](https://mise.jdx.dev/).

## Docs

Keep browsable documentation in [`docs/`](docs/), starting with the [verification roadmap](docs/verification-roadmap.md). Markdown files can be placed in subfolders; no index file or registration is needed.

```sh
mise run docs:serve
```

Open <http://127.0.0.1:8787/> for an index grouped by folder. Each document has index/previous/next links and heading anchors; relative Markdown links work normally. Refresh after edits to pick up changed or newly added files. Only `.md` files under `docs/` are served; local image assets are not. Raw HTML is displayed as text. Stop with Ctrl+C.

Use `mise run docs:serve 9000` for another port and `mise run docs:test` to run the server tests. Both tasks install locked development dependencies first. The server is [`scripts/server.mjs`](scripts/server.mjs), using Node's HTTP server and Markdown-it; there is no frontend build.

## Task list

```terminal
mise run <task>                            # Run any task below by its full name
├── format                                 # Format Neovim Lua, Pi extensions, JSON, TOML, Markdown, JavaScript, and shell scripts
│   ├── nvim:format                        # Format Neovim Lua using .stylua.toml
│   ├── pi:format                          # Format Pi TypeScript extensions using .oxfmtrc.json
│   ├── json:format                        # Format all non-lockfile JSON, including hidden directories, using .oxfmtrc.json
│   ├── toml:format                        # Format all TOML, including hidden files and directories, using .oxfmtrc.json
│   ├── docs:format                        # Format all Markdown, including hidden directories, using .oxfmtrc.json
│   ├── scripts:format                     # Format scripts/**/*.mjs using .oxfmtrc.json
│   └── shell:format                       # Format home/.claude/statusline.sh with shfmt (Bash, two spaces)
├── json:format:check                      # Check non-lockfile JSON formatting without writing files
├── toml:format:check                      # Check TOML formatting without writing files
├── docs:format:check                      # Check Markdown formatting without writing files
├── scripts:format:check                   # Check JavaScript script formatting without writing files
├── shell:format:check                     # Check Bash formatting without writing files
├── lint                                   # Lint Pi extensions, JavaScript scripts, and shell scripts
│   ├── pi:lint                            # Lint extensions using .oxlintrc.json; reject warnings
│   ├── scripts:lint                       # Lint scripts using .oxlintrc.json; reject warnings
│   └── shell:lint                         # Lint home/.claude/statusline.sh with ShellCheck; reject all findings
├── shell:syntax                           # Check Bash syntax with /bin/bash -n without executing the script
├── typecheck                              # Typecheck Pi extensions and JavaScript scripts
│   ├── pi:typecheck                       # Install dependencies, then typecheck using tsconfig.json
│   │   └── pi:deps                        # Install development dependencies from the lockfile
│   └── scripts:typecheck                  # Check .mjs with strict checkJs using tsconfig.scripts.json
│       └── pi:deps                        # Install development dependencies from the lockfile
├── scripts:test                           # Run all scripts/**/*.test.mjs with Node's test runner
│   └── pi:deps                            # Install development dependencies from the lockfile
├── docs:serve                             # Browse docs Markdown on localhost (default port 8787)
│   └── pi:deps                            # Install development dependencies from the lockfile
├── docs:test                              # Test docs rendering, navigation, and file access
│   └── pi:deps                            # Install development dependencies from the lockfile
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

# Verify extension and script compatibility with the updated dependencies
mise run typecheck
```

Use the same dependency-sync step after changing the configured Node major. Commit the resulting `package.json` and `package-lock.json` changes together.

### Format and validate configuration, documentation, and script changes

```sh
# Format Neovim Lua, Pi extensions, non-lockfile JSON, TOML, Markdown, JavaScript, and shell scripts
mise run format

# Check JSON, TOML, Markdown, JavaScript, and shell formatting without changing files
mise run json:format:check
mise run toml:format:check
mise run docs:format:check
mise run scripts:format:check
mise run shell:format:check

# Check Pi extensions, JavaScript scripts, and shell scripts for lint findings
mise run lint

# Check Bash syntax without executing the status-line script
mise run shell:syntax

# Install locked dev dependencies and check extension and JavaScript types
mise run typecheck

# Run dependency-sync and docs-server behavioral tests
mise run scripts:test
```

JSON formatting includes root and hidden-directory configuration files, but excludes the generated `package-lock.json` and `home/.config/nvim/nvim-pack-lock.json` to preserve their generator-owned layout. JSON schema validation is not yet implemented.

TOML formatting covers `mise.toml`, `.stylua.toml`, and `home/.config/mise/config.toml`, as well as future non-ignored TOML files. It does not run bootstrap or install tools. Dedicated TOML syntax/duplicate-key and schema validation remain planned.

StyLua and LuaLS (`lua-language-server`) are declared Homebrew packages, not mise tools. Use `bootstrap:brew` to install them and `brew:upgrade` to upgrade them; `bootstrap:tools` and `tools:upgrade` do not manage them.

Shell checks explicitly cover `home/.claude/statusline.sh`: shfmt uses the Bash dialect and two-space indentation, ShellCheck rejects all findings, and `/bin/bash -n` checks compatibility with macOS system Bash without executing the script. shfmt and ShellCheck are declared Homebrew packages installed by `bootstrap:brew`; the shell verification tasks do not install tools or run the script.
