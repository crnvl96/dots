---
_template:
  title: Jira bug
  description: For preparing a Jira-ready bug ticket draft in Inkdrop
---
> # !Instructions
>
> Filling this template prepares a Jira-ready draft in Inkdrop.
> Do not create or update a Jira issue unless the user separately requests publication.
>
> ## Scope and audience
>
> - Parent: nest under an Epic. If it isn't obvious, ask which one.
> - Size: 13 points at most.
> - Done includes the fix, tests, review, deploy to an integration environment and verification.
>   - Don't create subtasks while scoping.
> - Audience: write for someone who wasn't in the room.
>   - Unlike stories, bugs are expected to carry relevant technical specifics: file names, logs, error values.
>   - Evidence about the defect belongs here; detailed implementation decisions and execution steps belong in linked specs and plans.
> - Keep the agreed scope consistent with any linked implementation artifacts.
>   - Surface conflicts rather than silently changing the requirements.
> - Replace placeholders with actual content. Do not copy instructions or examples into the populated note.
>
> ## Evidence handling
>
> - Distinguish observed facts, reported behaviour, and hypotheses.
> - Do not invent reproduction steps, inputs, environments, frequency, impact, or root causes.
> - Preserve the exact wording of relevant diagnostics.
>   - Redact secrets and sensitive data, clearly marking redactions.
>   - Use labeled excerpts for long logs and mark omissions explicitly.
>   - Link or attach the full sanitized capture when available.
> - If the available Jira tooling cannot upload attachments, identify what must be attached manually.
> - Do not claim an attachment was uploaded when it was not.
>
> ## Publishing, only when requested
>
> - Use native Jira dependency edges for genuine blocking issues where supported.
> - If the available tooling cannot set those edges, retain the blocking links and identify the manual step needed.
> - Do not claim an issue was published or a dependency was set unless it actually happened.
# Summary

> # !Instructions
>
> One line that states the problem and why it's a bug.
> Example: "Saving a charge version drops its effective date (expected: date persists)".

## Expected vs. actual

> # !Instructions
>
> Describe the expected behaviour and the observed or reported deviation.
> Link the requirement or other evidence for the expected behaviour when available.
> If the expectation is disputed or unknown, surface that decision instead of assuming it.

- **Expected:** [Expected behaviour]
- **Actual:** [Observed or reported behaviour]

## Impact and frequency

> # !Instructions
>
> Record what is known and label unknowns explicitly.
> - Who or what is affected, and how work is disrupted.
> - Frequency: always, intermittent, or observed once, with supporting counts or conditions when available.
> - Whether a workaround is known and what it involves.
> - Observed data loss, security, or operational consequences, if any.
>
> Distinguish confirmed impact from potential consequences or reports that have not been verified.
> Do not infer severity or a broad blast radius from thin evidence.
> Do not treat an unknown impact as proof that there is no impact.

- **Affected users or systems:** [Known scope, or unknown]
- **Frequency:** [Observed frequency, or unknown]
- **Workaround:** [Known workaround, confirmed none, or unknown]
- **Consequences:** [Observed consequences, or unknown]

## Steps to reproduce

> # !Instructions
>
> Give concrete steps with the persona or role and input data used, sanitized where necessary.
> Distinguish confirmed reproduction steps from reported steps or suspected triggers.
> State when reproduction is unconfirmed or intermittent.
> Do not invent missing steps or imply deterministic reproduction without evidence.
> If no sequence is known, replace the numbered placeholders with what is known and the evidence needed to investigate.

**Reproduction status:** [Confirmed / reported but unconfirmed / intermittent / not yet reproduced]

1. [Step]
2. [Step]

**Environment:**

> # !Instructions
>
> Include the environment (e.g. local / QA / prod), build or commit, and browser where relevant.
> Include other relevant versions or platform details when known.
> Mark missing details as unknown rather than guessing.

## Diagnostics

> # !Instructions
>
> Include relevant stack traces, logs, error messages, failing values, and versions exactly as captured, subject to redaction.
> Label each capture with its source and relevant timestamp or environment when known.
> Clearly mark redactions and omissions in excerpts.
> Link full sanitized captures when available.
> Keep any root-cause hypotheses separate from captured evidence and label them as unconfirmed unless verified.
> Remove this section if there are no diagnostics or hypotheses to report.

```text title="Diagnostic capture or labeled excerpt"
[Sanitized stack trace, log excerpt, error message, or failing values]
```

## Acceptance criteria

> # !Instructions
>
> Use plain bullets only, never [ ] checkboxes.
> Each criterion must be an observable pass/fail condition specific to this fix.
> Leave out CI, lint or release boilerplate.
> The ticket isn't Done until every bullet holds.
> Do not prescribe an unverified root cause or implementation as an acceptance condition.

- [Criterion]

## Test plan

> # !Instructions
>
> Describe how the fix will be verified against the original failure and relevant regression risks.
> Give steps QA or a reviewer can follow, with expected results.
> Include suitable automated regression coverage where feasible; do not force it when another verification method is appropriate.
> For intermittent bugs, explain the observation conditions and limits of the evidence.
> If verification cannot yet be defined, state what evidence or investigation is needed and what remains blocked.
> Do not silently remove this section or claim successful verification before it occurs.

1. [Verification action and expected result, or investigation needed to define verification]

## Links

> # !Instructions
>
> Include only references that exist. Do not invent links or create artifacts just to fill this section.
> Include the Epic and, when available:
> - Original report or discussion.
> - Related Jira issues and relevant docs.
> - Sanitized evidence or attachment references.
> - Implementation ticket note, identifying the ticket number and title.
> - Implementation spec and implementation plan.
> - Genuine blocking Jira issues, clearly distinguished from merely related issues.
>
> If the Epic is unresolved, ask which one rather than fabricating a reference.
> Identify any attachments that still need to be added manually.
> When publication is requested, use native Jira dependency edges where supported.

- Epic: [Epic link]
