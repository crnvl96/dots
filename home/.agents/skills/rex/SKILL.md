---
name: rex
description: Use the rex CLI to manage Rex sessions, open tabs, arrange panes, run commands, inspect terminal output, and control connected Rex apps.
metadata:
  rex-stub: "2"
---


Run `rex __internal skill` and follow the guide it prints. The guide comes from the installed Rex CLI, so it describes the commands available in that version.

If the command fails, the installed Rex version predates the guide. Start with `rex whoami --json`, then use `rex --help` and `rex COMMAND --help`.

When watching a running program, use Rex's Program Status Protocol (OSC 7501) when available instead of relying only on screen parsing or process state.

When launching instances of coding agents (claude code, pi, etc...), by default inherit the parameters (provider, model, thinking level, etc..) from the parent.
