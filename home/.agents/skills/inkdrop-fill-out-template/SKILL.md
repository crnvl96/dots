---
name: inkdrop-fill-out-template
description: Fill out the specified note template in Inkdrop
argument-hint: [note-link]
---

# Fill out the note template

You're given a link to an Inkdrop note that was **created from a template** (it has a
`sourceTemplateId`). Its body already holds the template's blank scaffold — headings and
placeholder fields waiting to be filled in. Your job is to fill that scaffold in place,
following the template's own instructions, and save it back.

This is usually a **planning** step: fill out the plan, then **wait for the user's
confirmation before writing any code**.

## Read the note together with its template

Read the note with `includeTemplate: true` so you get the scaffold **and** the source
template's guidance in one call:

```
read-note { noteId: "note:…", includeTemplate: true }
```

The response gives you two things:

- **The note body** — the scaffold you'll fill in. Its top section usually holds the user's
  own input (the request, links to related notes) above a `* * *` divider.
- **The source template body** (embedded as an extra text block) — the _how-to_. Templates
  carry their guidance in blockquotes:
  - `> # !Instructions` — the steps for filling this specific template out.
  - `> # !Example` — a fully worked example of a completed note.

  These blocks live **only in the template**, never in the note. Read them, apply them —
  **do not copy them into the note.**

Also read every note the scaffold links to (related notes, prior art) — they're context you
need before you can fill it out well.

## Ask when a decision is needed

When more than one reasonable approach exists — and the choice changes what you'd build —
state your recommendation with its reasoning and **confirm before finalizing**.
Use `AskUserQuestion` if there are any decisions needed (show the options with short previews).
Bake the answer into the note's decisions section as resolved, so the plan reflects the real
choice rather than hedging. Record assumptions you _didn't_ ask about explicitly too, so they're
reviewable.

## Save, then wait

Write the filled-out scaffold back with `update-note` (pass the current `_rev`). For small
follow-up edits later — checking off status boxes as work progresses — `patch-note` is cheaper
than resending the whole body.

Then **stop**: report a short summary and the `inkdrop://note/<id>` link, surface the decisions
you're waiting on, and wait for the user's explicit go-ahead before touching any code.
