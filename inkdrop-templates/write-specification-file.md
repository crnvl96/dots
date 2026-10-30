---
_template:
  title: Implementation spec
  description: For turning the current conversation into a spec
---
> # !Instructions
>
> Treat the agreed deliverable and acceptance criteria as the scope boundary.
> Make this document complete and self-contained.
> Summarize the context you have instead of inventing references.
> De thorough and meticulous on your writing. This document alone must be enough to guide the complete implementation.
> Confirm any necessary scope change with the user before finalizing this spec.

## Problem Statement

> # !Instructions
>
> The problem that the user is facing, from the user's perspective.

## Solution

> # !Instructions
>
> The solution to the problem, from the user's perspective.

## User Stories

> # !Instructions
>
> A numbered list of distinct, relevant user stories proportional to the agreed scope. Use the format:
>
> 1. As an <actor>, I want a <feature>, so that <benefit>
>
> Cover the agreed scope completely without repetition.
> Do not invent requirements or expand the slice just to lengthen the list.

> # !Example
>
> 1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending

## Implementation Decisions

> # !Instructions
>
> A list of implementation decisions that were made. This can include:
>
> - The modules that will be built/modified
> - The interfaces of those modules that will be modified
> - Technical clarifications from the developer
> - Architectural decisions
> - Schema changes
> - API contracts
> - Specific interactions
>
> Do not include specific file paths or code snippets.


## Implementation Phases

### Phase 1:

### Phase 2:

> # !Instructions
>
> Example:
>
> ## Implementation Phases
>
> ### Phase 1: Merged wizard dialog component
>
> - **Action**: Build one `Dialog` with a `switch (step)` selecting content + actions for scanning/stats/notebook/progress (see the step union sketched below); merge the two old stylesheets under a new root class
> - **Why**: A single dialog instance is required for the wizard; scanning and progress share one status-line renderer to minimize new UI surface
> - **Verify**: Manually render each step in isolation and confirm its content and actions
>
> ### Phase 2: Reorder orchestration in index.tsx
>
> - **Action**: Replace the two `useModal()` calls with one (see the state shape sketched below); add `step`/`filePaths`/`totalSize`/`selectedBookId` state; call `openImportDialog()` first, open the dialog immediately at `scanning`, then transition through `stats` → `notebook` → `progress`
> - **Why**: Implements "files first" — the wizard opens immediately and shows live scan progress
> - **Verify**: `npm run dev`, trigger the import command, confirm the dialog opens before scanning and advances through all four steps
> - **Dependencies**: Phase 1's wizard dialog component

## Testing Decisions

> # !Instructions
>
> A list of testing decisions that were made. Include:
>
> - A description of what makes a good test (only test external behavior, not implementation details)
> - Which modules will be tested
> - Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

> # !Instructions
>
> A description of the things that are out of scope for this spec.

## Open questions

> # !Instructions
>
> Label each remaining question **Blocking** or **Deferred**.
> - **Blocking:** affects agreed behaviour, scope, or a decision needed to plan the work.
>   - Resolve it with the user before treating the spec as ready for planning.
>   - Move resolved answers into the relevant decisions or scope section.
> - **Deferred:** can safely wait without changing the agreed slice.
>   - Record why it can wait and when it should be revisited.
>
> Write "None" when no questions remain.
> Examples of questions to classify:
>
> - Does this need to behave the same way on every platform, or is divergence OK?
> - Where should this live in the UI (which pane, menu, or section)?
> - Should it be on by default, or opt-in behind a setting?
> - Is there an existing pattern or component in the app to follow instead of inventing a new one?

## Further Notes

> # !Instructions
>
> Any further notes about the feature that aren't covered by any prior section.
> You are free to add here any information that is relevant to ensure the correct implementation of this document.
