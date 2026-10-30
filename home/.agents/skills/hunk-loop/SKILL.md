---
name: hunk-loop
description: Keep a loop running on a hunk review session to respond to user feedback.
disable-model-invocation: true
---

## Instructions

- Use the hunk-review skill.
- Start a background bash loop that runs `hunk session comment list --repo . --type user --json` every few seconds and prints when the output changes.
- Check that output between steps, and answer any new note with `hunk session comment add --reply-to <id>`.
- Keep track of note IDs you've already answered.
