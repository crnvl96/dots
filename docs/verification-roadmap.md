# Verification roadmap

Expand the existing mise verification setup to cover every repository file type, without redesigning it. This document records existing coverage and proposed additions; it does not implement tools, schemas, or tasks.

## Coverage by file type

Inventory: repository regular files, including hidden files and the newly added roadmap and server; excludes `.git`, `node_modules`, ignored files, and the two skill-directory symlinks (their target Markdown files are counted once). Markdown includes this roadmap.

**Legend**

- ✅ **Implemented**: every required check for the row is configured and reachable through a mise task across its repository scope. This describes coverage, not a claim that checks were run or passed during this audit.
- 🗓️ **Planned**: coverage is missing, partial, or a scope decision remains open.
- **Won't do**: intentionally no tool for that purpose, not an unfinished implementation.
- Tool names describe the intended destination. The last column distinguishes what exists from what is proposed. Recommendations remain open to approval.
- Schema/native validation is separate from linting and programming-language typechecking. A formatter parsing a config or an editor offering schema completion is not task-based schema validation.

| File type | Files / scope | Formatter | Linter | Typechecker | Schema / native validation | Status | Current coverage and next steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.ts` | 1: `home/.pi/agent/extensions/perplexity.ts` | `oxfmt` | `oxlint` | `tsc` | Won't do | ✅ Implemented | `format` → `pi:format`; `lint` → `pi:lint`; `typecheck` → `pi:typecheck` → `pi:deps`. Configuration: `.oxfmtrc.json`, `.oxlintrc.json`, `tsconfig.json`. |
| `.lua` | 16: `home/.config/nvim/**/*.lua` | StyLua | LuaLS diagnostics (proposed) | LuaLS type diagnostics (proposed) | Won't do | 🗓️ Planned | `format` → `nvim:format` already covers Lua. LuaLS is installed and configured in Neovim, but no mise task runs its diagnostics. Reuse LuaLS rather than add a second analyzer; see scope decisions below. |
| `.json` | 11: root configs/manifests, Pi, Claude, Neovim snippets and lockfile | `oxfmt` | Won't do | Won't do | JSON parsing + Ajv against per-file schemas; explicit exceptions below | 🗓️ Planned | `pi:format` covers only `home/.pi/agent/{keybindings,mcp,settings}.json` (3 of 11). Expand formatting to the remaining files and add task-based schema validation. |
| `.toml` | 3: `mise.toml`, `.stylua.toml`, `home/.config/mise/config.toml` | `oxfmt` (recommended); Taplo is an alternative | Won't do | Won't do | Taplo syntax/duplicate-key checks; schema validation with a draft-compatible validator | 🗓️ Planned | No formatter or validation task covers these files. Schemas are available for mise and StyLua. Check validator compatibility before choosing Taplo for schema validation; see below. |
| `.md` | 6: `README.md`, `AGENTS.md`, `docs/verification-roadmap.md`, and 3 `SKILL.md` files | `oxfmt` | Won't do | Won't do | Won't do | 🗓️ Planned | Oxfmt supports Markdown, but no current task targets it. Add all root, `docs/`, and hidden-directory Markdown files to formatting coverage. No Markdown linter or typechecker, by design. |
| `.mjs` | 4: `scripts/{pi-deps,server}{,.test}.mjs` | `oxfmt` | `oxlint` | `tsc` with `allowJs` + `checkJs` (proposed) | Won't do | 🗓️ Planned | Current formatter/linter globs and `tsconfig.json` exclude these scripts. `docs:test` covers server behavior, not formatting/linting/types. Expand verification scope; JavaScript typechecking would need a deliberate configuration change and possibly JSDoc annotations. |
| `.sh` (Bash) | 1: `home/.claude/statusline.sh` | `shfmt` | ShellCheck | Won't do | `bash -n` syntax check | 🗓️ Planned | No current task coverage. Target the hidden-directory script explicitly and preserve its Bash dialect. Syntax checking must not execute the statusline script. |
| `.ghostty` | 1: `home/.config/ghostty/config.ghostty` | Won't do | Won't do | Won't do | Ghostty `+validate-config --config-file=…` | 🗓️ Planned | Use Ghostty's own parser to check keys and values against the repository file. No generic formatter or external schema proposed. |
| Extensionless: `.gitignore` | 1: root `.gitignore` | Won't do | Won't do | Won't do | Won't do (proposed exemption) | 🗓️ Planned | Confirm intentional manual-review-only coverage. Git ignore patterns are not shell syntax; don't send this file to shell tools. |
| Extensionless: `ripgreprc` | 1: `home/.config/nvim/ripgreprc` | Won't do | Won't do | Won't do | Controlled `rg` smoke check with `RIPGREP_CONFIG_PATH` | 🗓️ Planned | No current task coverage. Exercise the repository config against a temporary fixture to check accepted flags and expected matching, distinguishing “no matches” from an error. |

### Scope decisions before implementation

- **Lua:** linting and type diagnostics are recommendations, not existing requirements. If both are explicitly “won't do,” Lua is already implemented for formatting-only coverage. If adopted, make LuaLS CLI diagnostics use the same LuaJIT runtime, Neovim/plugin libraries, and allowed globals as the editor. Ensure findings fail the task; generating a diagnostics report alone is insufficient.
- **JavaScript:** recommend `tsc`/`checkJs` for the dependency and docs-server scripts, without converting them to TypeScript. Confirm whether this is worthwhile or should be “won't do.” Their existing Node tests are useful additional verification, but do not replace formatter/linter/typechecker coverage.
- **Git ignore patterns:** recommend an explicit exemption rather than a bespoke linter. Mark the row implemented only after accepting that it has no required automated checks.
- **Generated files:** include lockfiles in parsing/validation. Decide whether formatting should leave their generator-produced layout untouched; document any formatting exemption by path.

## JSON and TOML schema roadmap

Only `.oxfmtrc.json` and `.oxlintrc.json` currently declare `$schema`. Neither JSON nor TOML has a dedicated schema-validation task. Existing tool invocations may reject invalid tool configuration, and `pi:deps` runs `npm ci`, but these do not provide a complete schema-validation workflow.

All actions below are **planned**, including adding schema references. “Not confirmed” means the audit did not establish a suitable published schema; it does not assert that none exists.

| Configuration file(s) | Schema availability / source | Current association | Planned action / caveat |
| --- | --- | --- | --- |
| `.oxfmtrc.json` | [Oxfmt schema](https://unpkg.com/oxfmt/configuration_schema.json); also shipped in the installed package | `$schema` present | Validate explicitly against the installed version's schema, or a version-pinned copy/URL. The current unversioned URL can drift ahead of the installed tool. |
| `.oxlintrc.json` | [Oxlint schema](https://unpkg.com/oxlint/configuration_schema.json); also shipped in the installed package | `$schema` present | Same version-alignment policy as Oxfmt. Schema validation complements running the actual linter. |
| `package.json` | [SchemaStore package schema](https://www.schemastore.org/package.json) | None | Add `$schema` if compatible with npm and validate through mise. |
| `tsconfig.json` | [SchemaStore TypeScript config schema](https://www.schemastore.org/tsconfig.json) | None | Add `$schema` and schema validation; retain `tsc` as the authority for compiler-option semantics and source types. |
| `home/.claude/settings.json` | [Claude Code settings schema](https://www.schemastore.org/claude-code-settings.json), also [recommended by Claude's docs](https://code.claude.com/docs/en/ide-integrations) | None | Add `$schema` and validation. Check compatibility with the installed Claude version, particularly less-documented settings; don't remove settings merely to satisfy a mismatched schema. |
| `home/.pi/agent/settings.json` | [Official Pi settings schema](https://pi.dev/schemas/settings.schema.json) published by current upstream | None | Verify compatibility with installed Pi before adding `$schema` and validation. Installed Pi `1.1.0` does not ship this schema; a current upstream schema is not automatically a version-matched contract. |
| `home/.pi/agent/keybindings.json` | [Official Pi keybindings schema](https://pi.dev/schemas/keybindings.schema.json) published by current upstream | None | Verify schema and loader compatibility with installed Pi; use an external association if metadata would be interpreted as a keybinding. |
| `home/.pi/agent/mcp.json` | Pi-specific published schema not confirmed; fetching the candidate `mcp.schema.json` URL failed | None | Check upstream/installed Pi's configuration contract, including `exposure`, before selecting or defining a schema. Don't substitute another client's MCP schema blindly. Until then, parse JSON and document the schema gap. |
| `home/.config/nvim/after/snippets/html.json` | SchemaStore lists a [VS Code-style snippets schema](https://raw.githubusercontent.com/Yash-Singh1/vscode-snippets-json-schema/main/schema.json) | None | Verify against Neovim's snippet consumer. Associate externally: a top-level `$schema` string could be treated as a snippet entry. |
| `package-lock.json` | Suitable published schema not confirmed in the inspected SchemaStore catalog | None; generated | Parse JSON; retain `npm ci` for manifest/lockfile consistency. Don't insert metadata into a generated lockfile. Record a schema exemption unless a maintained, lockfile-version-compatible schema is found. |
| `home/.config/nvim/nvim-pack-lock.json` | Published schema not confirmed | None; generated | Parse JSON; preserve Neovim ownership. Use an external association if a maintained schema is found; otherwise document a schema exemption. |
| `mise.toml`, `home/.config/mise/config.toml` | [Official mise schema](https://mise.jdx.dev/schema/mise.json), including `dotfiles` and `bootstrap` | None | Add `#:schema https://mise.jdx.dev/schema/mise.json` to each file and validate against a version-compatible schema. The published schema declares Draft 2020-12. |
| `.stylua.toml` | [SchemaStore StyLua schema](https://www.schemastore.org/stylua.json) | None | Add a `#:schema` comment and validation. Match the installed StyLua options; inspect the fetched schema's actual draft rather than assuming compatibility from its filename. |

### Validation safeguards

- **Association is not enforcement.** Add `$schema` to hand-maintained JSON only when its consumer accepts it; use `#:schema` comments for TOML. Keep external file-to-schema mappings for generated files and formats whose top-level keys are application data.
- **Handle schema drafts explicitly.** [Taplo documents Draft 4 support](https://taplo.tamasfe.dev/cli/usage/validation.html), while mise's current schema uses Draft 2020-12 and the installed Oxfmt/Oxlint schemas use Draft 7. Verify support in the selected Taplo version; don't assume its accepting a schema URL means all keywords are enforced. If needed, parse TOML to data and reuse Ajv with the appropriate draft support. [Ajv CLI supports Draft 7, 2019-09, and 2020-12](https://ajv.js.org/packages/ajv-cli.html); Draft 4 needs separate support.
- **Keep validation read-only.** Do not use coercion, default insertion, or removal of additional properties to make configs pass. Report mismatches for review.
- **Don't overpromise typo detection.** Some schemas allow additional properties. Record that limitation rather than claiming schema validation rejects every unknown setting.
- **Make schema retrieval reproducible.** Prefer installed-version schemas or pinned/cached copies, resolve referenced schemas, and report unavailable schemas as errors rather than silently skipping validation. Never send config contents or credentials to an online validator; fetch schemas and validate locally.

## Suggested implementation order

1. **Expand existing tool scopes:** Oxfmt for Markdown, all intended JSON, TOML, and `.mjs`; Oxlint for `.mjs`. Preserve the existing `format`, `lint`, and `typecheck` entry points and working TypeScript coverage. Ensure discovery includes root dotfiles and hidden directories, excludes dependencies and `.git`, and doesn't double-count symlink targets.
2. **Add config validation:** associate the confirmed schemas, resolve version/draft compatibility, and make local validation reachable through mise. Give every JSON/TOML file either a schema-backed check or an explicit syntax-only/schema exemption.
3. **Add the remaining checks:** shfmt/ShellCheck/Bash syntax, Ghostty validation, the ripgrep fixture check, and approved Lua/JavaScript diagnostics. Integrate with existing entry points where appropriate; introduce a small validation task only if useful. No replacement task framework is proposed.
4. **Close each row:** verify task scope and nonzero failure behavior, document approved “won't do” decisions, and then change 🗓️ to ✅. Provide non-mutating formatter-check modes for verification in addition to formatting writes. Update the README task tree and common workflows whenever tasks or their composition change.

## Research references

- [Oxfmt language support](https://oxc.rs/docs/guide/usage/formatter/language-support.html): JavaScript/TypeScript, JSON, Markdown, and TOML are supported. Oxfmt `0.72.0` and Oxlint `1.87.0` were installed during this audit.
- [Taplo schema associations](https://taplo.tamasfe.dev/configuration/using-schemas.html) and [validation](https://taplo.tamasfe.dev/cli/usage/validation.html).
- [LuaLS CLI diagnosis reports](https://github.com/LuaLS/lua-language-server/wiki/Diagnosis-Report): supports workspace checks; requires deliberate diagnostic configuration and task failure handling.
- [ShellCheck](https://man.archlinux.org/man/extra/shellcheck/shellcheck.1.en) and [shfmt](https://man.archlinux.org/man/extra/shfmt/shfmt.1.en): shell linting and formatting/syntax parsing.
- [Ghostty CLI reference](https://man.archlinux.org/man/ghostty.1): `+validate-config` accepts a specific config file; the installed CLI help confirms this.
- [SchemaStore catalog](https://www.schemastore.org/api/json/catalog.json) and [JSON schema association caveats](https://code.visualstudio.com/docs/languages/json.md): schema references can change application data, so external associations are sometimes necessary.
