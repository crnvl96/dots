---
_template:
  title: Jira feature
  description: For preparing a Jira-ready feature ticket draft in Inkdrop
---
> # !Instructions
>
> Sources: Notion "Jira Best Practices" (wins on conflict) + gigawatt-eng:gigawatt-jira skill.
>
> Filling this template prepares a Jira-ready draft in Inkdrop.
> Do not create or update a Jira issue unless the user separately requests publication.
>
> ## Scope and audience
>
> - Parent: nest under an Epic. If it isn't obvious, ask which one.
> - Size: one deliverable unit of value, 13 points at most.
>   - 13 is for high-uncertainty work like a PoC or design investigation.
>   - Split monoliths; don't fragment into 1-pointers.
> - Done includes tests, docs, code review, deploy to an integration environment and verification.
>   - Don't split those out, and don't create subtasks while scoping.
> - Audience: engineers, PMs and designers. Write for someone who wasn't in the room.
> - Keep this ticket aligned with the agreed request and any linked implementation artifacts.
>   - If their scopes conflict, surface the conflict and confirm the resolution rather than silently choosing one.
> - This is not an implementation spec or plan.
>   - Keep technical design decisions in the linked implementation spec.
>   - Keep execution steps in the linked implementation plan, not in this ticket.
>   - Leave out file paths, class or function names unless a reader needs them to understand the issue.
> - Replace placeholders with actual content. Do not copy instructions or examples into the populated note.
>
> ## Publishing, only when requested
>
> - Use native Jira dependency edges for genuine blocking issues where supported.
> - If the available tooling cannot set those edges, retain the blocking links and identify the manual step needed.
> - Do not claim an issue was published or a dependency was set unless it actually happened.
# Summary

> # !Instructions
>
> One line that a non-engineer can follow. State the outcome.
> Example: "Let CSRs add a version to a charge from its parent's draft set".

## Context

> # !Instructions
>
> Explain the user or business problem, why it matters, and who it affects in 2–4 sentences.
> Link the source, such as a Slack thread, design, Notion doc, or related ticket.

## What needs to be done

> # !Instructions
>
> Give a concise description of the agreed scope and intended outcome.
> Describe what needs to be true when this ships, not code steps.
> Leave actor motivations to User Stories and detailed pass/fail conditions to Acceptance criteria.

## User Stories

> # !Instructions
>
> Write a proportional set of distinct, relevant user stories using this format:
>
> 1. As an <actor>, I want a <feature>, so that <benefit>
>
> Cover the relevant actors, needs, and benefits without repetition.
> Do not repeat every acceptance criterion as a user story.
> Do not invent requirements or expand the ticket just to lengthen the list.

> # !Example
>
> 1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending.

## Acceptance criteria

> # !Instructions
>
> Use plain bullets only, never [ ] checkboxes.
> Each criterion must be an observable pass/fail condition specific to this change.
> Leave out CI, lint, release or version-bump boilerplate.
> The ticket isn't Done until every bullet holds.
> If requirements change, update these with your Tech Lead and PM first.

- [Criterion]

## Test plan

> # !Instructions
>
> Include one whenever it can reasonably be worked out.
> Write steps QA or a reviewer can follow, with expected results tied to the acceptance criteria.
> Remove the section if no test plan can be derived.
> If missing decisions prevent verification from being defined, record them under Open questions rather than hiding the uncertainty.

1. [Action and expected result]

## Out of Scope

> # !Instructions
>
> Describe what is explicitly outside this ticket's agreed scope.

## Open questions

> # !Instructions
>
> Label each remaining question **Blocking** or **Deferred**.
> - **Blocking:** affects agreed behaviour, scope, acceptance, or another decision needed to implement the ticket.
>   - Resolve it before marking the ticket ready for implementation.
>   - Put resolved answers into the relevant scope or acceptance section.
>   - Confirm changes to requirements with the Tech Lead and PM.
> - **Deferred:** can safely wait without changing the agreed deliverable.
>   - Record why it can wait and when it should be revisited.
>
> Write "None" when no questions remain.
> A draft may contain blocking questions; do not present it as ready for implementation.

## Further Notes

> # !Instructions
>
> Include relevant information that does not belong above.
> Do not duplicate the linked implementation spec or plan.
> Remove this section if there is nothing further to add.

## Links

> # !Instructions
>
> Include only references that exist. Do not invent links or create artifacts just to fill this section.
> Include the Epic and, when available:
> - Source request or discussion.
> - Designs, docs, and related Jira issues.
> - Implementation ticket note, identifying the ticket number and title.
> - Implementation spec.
> - Implementation plan.
> - Genuine blocking Jira issues, clearly distinguished from merely related issues.
>
> If the Epic is unresolved, ask which one rather than fabricating a reference.
> When publication is requested, use native Jira dependency edges where supported.

- Epic: [Epic link]
