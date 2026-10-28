---
_template:
  title: Implementation spec
  description: For turning the current conversation into a spec
---
## Source / Related notes

> # !Instructions
>
> Link the source ticket note and identify the ticket number and title when this spec covers a slice.
> Treat that ticket's agreed deliverable and acceptance criteria as the scope boundary.
> Link other relevant requests, discussion notes, specs, or issues when available.
> For unsliced work sourced only from the conversation, summarize that context instead of inventing a reference.
> Confirm any necessary scope change with the user before finalizing the spec.

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
> Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.
>
> Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

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
> Any further notes about the feature.
