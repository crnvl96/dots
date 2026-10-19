---
name: rex
description: Use the rex CLI to manage Rex sessions, open tabs, arrange panes, run commands, inspect terminal output, and control connected Rex apps.
metadata:
  rex-stub: "2"
---
<!-- Installed by "rex skill setup". Remove it with "rex skill remove". -->

Run `rex __internal skill` and follow the guide it prints. The guide comes from
the installed Rex CLI, so it describes the commands available in that version.

If the command fails, the installed Rex version predates the guide. Start with
`rex whoami --json`, then use `rex --help` and `rex COMMAND --help`.

## Monitor program status with OSC 7501

When watching a running program, use Rex's Program Status Protocol (OSC 7501)
when available instead of relying only on screen parsing or process state. After
obtaining the block ID, query the status reported by the program:

```sh
rex block call -s "$REX_SESSION" -b "$BLOCK_ID" program_status
```

Interpret the returned `records`: `working` means the program is active,
`blocked` means it is waiting for user action, `done` means the task finished,
`error` means it stopped unsuccessfully, and `idle` means it is awaiting work.
Also inspect `app`, `effective_app`, `kind`, `msg`, and `progress` when present.
Use `rex capture` for detailed output, but use `program_status` to determine
whether an interactive agent has finished; an agent process remaining alive does
not by itself mean the task is still running.
