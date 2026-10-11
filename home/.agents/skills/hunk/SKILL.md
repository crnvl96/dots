---
name: hunk
description: Interacts with live Hunk diff review sessions via CLI. Inspects review focus, navigates files, hunks, and exact lines, reloads session contents, adds inline review comments, and paints attention marks on character ranges. Use when the user has a Hunk session running or wants to review diffs interactively.
---

# Hunk

Hunk ships its own up-to-date skill. Before doing anything else:

1. Run `hunk skill path review` to get the bundled skill path.
2. Read the file at that path and follow its instructions.

If `hunk` is not installed or the command fails, tell the user and stop.
