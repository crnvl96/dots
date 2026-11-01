---
_template:
  title: Implementation spec
  description: For turning the current conversation into a spec
---
> # !Instructions
>
> - Treat the agreed deliverable and acceptance criteria as the scope boundary. Do not invent requirements or expand the scope.
> - Make this document complete and self-contained. Write for an engineer or agent who was not part of the discussion.
> - Summarize the context you have instead of inventing references.
> - Include enough detail to guide implementation and verification. Record missing information as open questions instead of filling gaps with assumptions.
> - Distinguish agreed decisions, facts verified in the codebase, and proposals awaiting a decision. Do not present a proposal or an assumption as an established fact.
> - Confirm any necessary scope change with the user before finalizing this spec.
> - Examples illustrate format and level of detail only. Do not carry their actors, features, or requirements into the spec unless they are part of the agreed scope.

## Problem Statement

> # !Instructions
>
> Describe the problem from the user's perspective, including who is affected and the impact.

## Solution

> # !Instructions
>
> Describe the intended behavior from the user's perspective. Keep this section at a high level; record technical decisions under Implementation Decisions.

## User Stories

> # !Instructions
>
> A numbered list of distinct, relevant user stories proportional to the agreed scope. Use the format:
>
> 1. As an <actor>, I want a <feature>, so that <benefit>
>
> Cover the agreed scope completely without repetition.
> Do not invent requirements or expand the slice just to lengthen the list.
>
> # !Example
>
> 1. As a user importing local notes, I want to see scanning progress and review the scan results before choosing a destination notebook, so that I can confirm what I am importing and where it will go.

## Acceptance criteria

> # !Instructions
>
> A numbered list of observable pass/fail conditions that establish when the agreed deliverable is complete.
>
> - Carry the agreed acceptance criteria into this document so the implementer does not need the original discussion.
> - Cover the agreed scope without repetition. Do not add requirements while making the criteria more precise.
> - Record ambiguity that changes acceptance under Open questions.
>
> # !Example
>
> 1. After the user selects files for import, the import dialog is visible and displays scanning progress before scanning finishes.
> 2. When scanning finishes, the dialog shows the file count and total size. The user can then choose a destination notebook and start the import, with import progress displayed in the same dialog.

## Implementation Decisions

> # !Instructions
>
> Record the technical decisions and verified facts needed to implement the agreed behavior. Include only details relevant to this change, such as:
>
> - Modules that will be built or modified.
> - Interfaces and API contracts.
> - Technical clarifications from the developer.
> - Architectural decisions.
> - Schema changes.
> - Specific interactions.
>
> For each item, distinguish its basis:
>
> - **Agreed decision:** A choice established in the discussion or agreed scope. Summarize the decision and its rationale.
> - **Verified fact:** Existing behavior, structure, or constraints confirmed by inspecting the codebase. Identify what was inspected.
> - **Proposal:** A suggested approach awaiting a decision. Explain the rationale and link it to the relevant open question. Do not make dependent phases unconditional until the decision is resolved.
>
> Include verified file paths, interface signatures, or small code/schema examples when they materially clarify the work. Keep them concise and avoid unnecessary implementation detail.
> Do not invent paths, symbols, contracts, or references. If the codebase has not been inspected, state that limitation and record any necessary verification under Open questions.

## Implementation Phases

> # !Instructions
>
> Break the implementation into phases proportional to the agreed scope. Use as many phases as needed; a small change may need only one.
>
> - Give each phase a numbered heading and a concrete outcome.
> - Order phases so prerequisites come first.
> - Include **Action**, **Why**, and **Verify** for each phase.
> - Include **Dependencies** when the phase relies on another phase, an external prerequisite, or an unresolved decision.
> - Make verification specific enough for an implementer or reviewer to follow. Reference acceptance criteria where relevant.
> - Keep phases consistent with Implementation Decisions. Identify work that cannot proceed until a blocking question is resolved.
>
> # !Example
>
> ### Phase 1: Build the import wizard dialog
>
> - **Action:** Build a single dialog that can display scanning progress, scan results, notebook selection, and import progress.
> - **Why:** The agreed workflow keeps all import steps in one dialog.
> - **Verify:** Render each step with representative data and confirm that its content and controls support the corresponding behavior in acceptance criteria 1 and 2.
>
> ### Phase 2: Connect the import workflow
>
> - **Action:** Open the dialog after file selection and before scanning completes. Pass scan progress and results into the dialog, then connect notebook selection and import progress.
> - **Why:** Users need immediate feedback while scanning and a continuous path from reviewing files to importing them.
> - **Verify:** Run an import with a scan that remains in progress long enough to observe. Confirm that the dialog is visible during scanning, then shows the file count and total size. Choose a notebook, start the import, and confirm that progress appears in the same dialog.
> - **Dependencies:** Phase 1's dialog.

## Testing Decisions

> # !Instructions
>
> Record the testing approach specific to this change:
>
> - Identify the observable behaviors and acceptance criteria to verify.
> - Choose appropriate test levels, such as unit, integration, or end-to-end, and explain why they fit the behavior.
> - Identify the modules or system boundaries exercised by those tests.
> - Include relevant regression coverage for existing behavior affected by the change.
> - Reference similar tests or helpers only when verified in the codebase. If they have not been inspected, state that instead of inventing prior art.
> - Test observable behavior rather than internal implementation details. Keep the amount of testing proportional to the change.
>
> Distinguish established testing decisions from proposals using the same guidance as Implementation Decisions.
>
> # !Example
>
> 1. **Proposed integration test for acceptance criterion 1:** Keep the scan pending and verify that the import dialog is already visible with scanning feedback. This exercises the import workflow and dialog together without relying on internal state names.
> 2. **Proposed workflow test for acceptance criterion 2:** Complete the scan with a known file count and total size, verify the displayed results, choose a notebook, and start the import. Confirm that progress appears in the same dialog.
>
> Existing test patterns have not been inspected in this illustrative example; no specific test file or helper is assumed.

## Out of Scope

> # !Instructions
>
> A list of explicitly agreed exclusions that clarify the boundaries of this spec.
>
> - Include only exclusions established in the discussion or agreed scope. Do not invent exclusions.
> - Write "None" if no exclusions were agreed.

## Open questions

> # !Instructions
>
> A numbered list of unresolved decisions or missing information relevant to the agreed deliverable.
>
> - Label each remaining question **Blocking** or **Deferred**.
> - **Blocking:** Affects agreed behavior, scope, acceptance, or a decision or fact needed to implement the work.
>   - State which decision or phase depends on the answer.
>   - Resolve factual gaps through verification and unresolved decisions with the user before treating the spec as ready for implementation.
>   - Move resolved answers into the relevant decisions, acceptance criteria, or scope section.
> - **Deferred:** Can safely wait without changing the agreed deliverable.
>   - Record why it can wait and when it should be revisited.
>
> Write "None" when no questions remain.
>
> # !Example
>
> 1. **Blocking:** What should the dialog display if scanning fails? Phase 2 needs this decision to implement the failure behavior.
> 2. **Deferred:** Should users be able to save an import configuration for reuse? Saved configurations are explicitly outside the agreed scope, so this can wait until a separate follow-up is considered.

## Further Notes

> # !Instructions
>
> Record relevant context needed to understand or implement the spec that is not covered by a prior section.
>
> - Do not duplicate information already recorded.
> - Keep requirements, decisions, and unresolved questions in their respective sections.
> - Write "None" if there is nothing further to add.
