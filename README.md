# Dots

**[mise](https://mise.jdx.dev/) task list**

```terminal
mise run <task>                            # Run any task below by its full name
├── format                                 # Format Neovim and Pi configurations
│   ├── nvim:format                        # Format Neovim Lua with StyLua
│   └── pi:format                          # Format Pi extensions and agent JSON
├── lint                                   # Lint Pi extensions
│   └── pi:lint                            # Run Oxlint with warnings treated as errors
├── typecheck                              # Typecheck Pi extensions
│   └── pi:typecheck                       # Run strict TypeScript checks without emitting files
├── bootstrap:preview                      # Preview all currently loaded bootstrap configuration
├── bootstrap:apply                        # Bootstrap every scope, starting with dotfiles
│   ├── bootstrap:dotfiles                 # Preview and link repository-managed dotfiles
│   └── bootstrap:without-dotfiles         # Bootstrap remaining scopes sequentially, then verify
│       ├── bootstrap:brew                 # Preview and install declared Homebrew packages
│       ├── bootstrap:macos                # Preview and apply macOS defaults and LaunchAgents
│       ├── bootstrap:tools                # Preview and install globally declared tools
│       └── bootstrap:check                # Check Git whitespace, working tree, and bootstrap state
├── brew:upgrade                           # Preview and upgrade declared Homebrew packages
│   └── brew:upgrade:preview               # Preview Homebrew package upgrades without applying them
└── tools:upgrade                          # Preview and upgrade configured mise tools within their version constraints
    └── tools:upgrade:preview              # Preview mise tool upgrades without applying them
```
