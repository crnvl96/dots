---
_template:
  title: Implementation tickets
  description: For breaking a plan, spec, or conversation into numbered tracer-bullet tickets in one note, each declaring its blocking edges
---
> # !Instructions
>
> Populate a single note with all implementation tickets. Do not create a separate note for each ticket.
>
> ## Slicing workflow
>
> 1. **Gather context.** Read the current conversation and the supplied references.
>    - Read linked notes and relevant issue bodies and comments when available.
>    - Identify the agreed scope before proposing tickets.
> 2. **Explore the codebase.** Verify the current implementation when the repo is available.
>    - Look for necessary prefactoring: make the change easy, then make the easy change.
>    - If the repo or a required reference is unavailable, state the limitation rather than inventing facts.
>    - Ask for missing context when it affects the breakdown.
> 3. **Draft slices and blocking edges.** Apply the slicing rules below.
>    - Name only dependencies that genuinely prevent a ticket from starting.
>    - Check that the dependency graph has no cycles.
> 4. **Get approval in chat before saving the completed breakdown.**
>    - Present a numbered list with each ticket's title, blockers, and deliverable.
>    - Ask whether the granularity is right, the blocking edges are correct, and any tickets should be merged or split.
>    - Iterate until the user explicitly approves the breakdown.
> 5. **Populate this note.** Write the approved tickets using the structure below.
>    - Keep all tickets in this one note.
>    - Stop after saving. Approval of the breakdown is not permission to implement.
>
> ## Slicing rules
>
> - Prefer tracer-bullet vertical slices: a narrow but complete path through every relevant layer, including tests.
> - Do not split ordinary feature work into isolated schema, API, or UI tickets.
> - Each completed slice must be demoable or verifiable on its own.
> - Size each ticket to fit in a single fresh context window.
> - Put necessary prefactoring before the work it enables.
>   - Keep it narrowly scoped and independently verifiable.
>   - Add blocking edges only to the tickets that need it.
> - Avoid specific file paths and code snippets in tickets; they go stale quickly.
> - Wide mechanical refactors are the exception to vertical slicing.
>   - When a rename or shared-type change fans across the codebase and no vertical slice can land green, use **expand–contract**.
>   - **Expand:** add the new form alongside the old so existing callers keep working.
>   - **Migrate:** move callers in batches sized by blast radius, such as a package or directory.
>     - Each batch is its own ticket, blocked by the expand ticket.
>     - Keep CI green between batches while the old form remains available.
>   - **Contract:** remove the old form once no callers remain.
>     - Block this ticket on every migration batch.
>   - If even migration batches cannot stay green independently, retain the sequence on a shared integration branch.
>     - Make the sequence's tickets prerequisites of a final integrate-and-verify ticket.
>     - Explicitly state that green CI is promised only at that final integration point.
>     - Give intermediate tickets concrete local verification criteria without claiming they can land independently.
>
> ## Formatting
>
> - Repeat the ticket structure below once per ticket, placing tickets one below another.
> - Use a level-one heading for each ticket: `# 1. Ticket title`, `# 2. Ticket title`, and so on.
> - Number tickets consecutively in ascending order, starting at 1.
> - Keep each ticket's sections as level-two headings, in the order shown below.
> - When initially organizing the tickets, place prerequisites before the tickets they block where possible.
> - When adding tickets later, preserve existing tickets and their numbers. Append new tickets using the next available number.
> - Use ticket numbers to reference blockers within this note, for example, "Ticket 2 — Add account sign-in".
> - Use links for external specs, issues, and blocking tickets when available. Do not invent references.
> - Apply the section instructions below to every ticket, not just the first.
> - Replace placeholders with actual content. Do not copy instructions or examples into the populated note.

# 1. [Ticket title]

## Parent

> # !Instructions
>
> Reference the parent request, discussion note, spec, or issue for this ticket.
> Repeat the reference in each ticket, even when several tickets share the same parent.
> If the source is only the conversation, summarize the agreed request and identify it as conversation context.
> Do not invent a link or require a spec that has not been written yet.

## What to build

> # !Instructions
>
> Describe the end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.
> For necessary prefactoring or wide-refactor tickets, describe the verifiable technical outcome and the behaviour that must remain unchanged.
> Identify any shared integration-branch constraint explicitly.

## Acceptance criteria

> # !Instructions
>
> List concrete, verifiable outcomes required for this ticket to be complete.
> Use plain bullets and replace the empty bullet below with the ticket's actual criteria.

-

## Blocked by

> # !Instructions
>
> List each blocking ticket, using its number and title for tickets in this note or a link for external tickets.
> If there are no blockers, write "None (can start immediately)".
> Omit this section only when blockers have already been set as native dependency edges in the issue tracker.
