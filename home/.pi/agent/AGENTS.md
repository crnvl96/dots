# Agent Instructions

## Code Navigation

For any file search or grep in the current git-indexed directory, use fff tools. Include the known directory or module in the first search. Use `definitions_only` for declarations. Read more source only when the returned lines need context.

## User-Invocable Review Skills

`thermo-nuclear-code-quality-review` and `thermo-nuclear-review` are explicit-user-invocation only. Never automatically load, apply, or run either skill, even for matching review tasks. Use them only when the user explicitly invokes `/skill:thermo-nuclear-code-quality-review` or `/skill:thermo-nuclear-review`.
