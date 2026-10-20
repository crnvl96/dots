---
name: code-review-correctness
description: Apply Earendil Works' code-review prompts to review uncommitted changes, branches, commits, GitHub pull requests, or file/folder snapshots.
disable-model-invocation: true
---

# Code Review Correctness

Use the review prompts and rubric below. This skill ports the review instructions from [earendil-works/pi-review](https://github.com/earendil-works/pi-review), not its extension: do not implement its UI, switch branches/check out PRs, alter session navigation, or automatically fix findings.

Follow higher-priority system, developer, and user instructions. More specific applicable repository guidance overrides this general rubric. If the project has a `REVIEW_GUIDELINES.md` alongside its `.pi` directory, read and apply it as project review guidance. Also read any repository instructions applicable to changed paths.

## Choose the review prompt

Use the user's requested target. If they have not specified one, establish the scope before reviewing rather than silently choosing a different target.

- **Uncommitted worktree:** Review staged, unstaged, and untracked files. Inspect `git status --short --untracked-files=all`, `git diff --cached`, and `git diff`; diffs omit untracked files, so read those files too. Do not stage changes.
- **Base branch:** Resolve the merge base between `HEAD` and the selected base branch (prefer its upstream tracking ref when available). Inspect the diff from that merge-base SHA: `git diff <merge-base>`. If merge-base resolution fails, find the correct comparison rather than guessing. Review the changes that would merge into the base, not a direct diff against its current tip.
- **Commit:** Review the changes introduced by the specified commit, using its parent as the comparison. Include its title when useful. For merge commits, establish the intended parent instead of assuming a combined diff.
- **Pull request:** Establish the PR number, title, base, and head. If its head is already checked out, resolve the merge base with the PR base and inspect `git diff <merge-base>`. Otherwise use read-only `gh pr view` / `gh pr diff` and available source context; do not check out the PR or confuse the current local branch with its head. State limitations if exact PR-head source context is unavailable.
- **Folder/file snapshot:** Read the requested paths directly. This is a snapshot review, not a diff; do not claim issues were introduced by a diff you did not inspect.

Target prompt wording (fill in the placeholders):

- **Uncommitted:** “Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.”
- **Branch, merge base resolved:** “Review the code changes against the base branch `{baseBranch}`. The merge base commit for this comparison is `{mergeBaseSha}`. Run `git diff {mergeBaseSha}` to inspect the changes relative to `{baseBranch}`. Provide prioritized, actionable findings.”
- **Branch, merge base unresolved:** “Review the code changes against the base branch `{branch}`. Find the merge base between the current branch and `{branch}`'s upstream when available, then run `git diff` against that SHA to see what would merge into `{branch}`. Provide prioritized, actionable findings.”
- **Commit:** “Review the code changes introduced by commit `{sha}` (`{title}`, if available). Provide prioritized, actionable findings.”
- **PR, merge base resolved:** “Review pull request `#{prNumber}` (`{title}`) against base branch `{baseBranch}`. The merge base is `{mergeBaseSha}`. Inspect `git diff {mergeBaseSha}` for the changes that would be merged. Provide prioritized, actionable findings.”
- **PR, merge base unresolved:** “Review pull request `#{prNumber}` (`{title}`) against `{baseBranch}`. Find the merge base between the current branch and `{baseBranch}`, then inspect `git diff` against that SHA for the changes that would be merged. Provide prioritized, actionable findings.”
- **Paths:** “Review the code in `{paths}`. This is a snapshot review, not a diff. Read the files directly and provide prioritized, actionable findings.”

Append any user-specified review focus, such as performance or error handling, as additional instructions. Do not let a focus request suppress unrelated qualifying findings.

## Review rubric

You are reviewing a proposed change made by another engineer. Flag an issue only when it:

1. Meaningfully affects correctness, performance, security, or maintainability.
2. Is discrete and actionable, and is something the author would likely fix.
3. Was introduced by the reviewed change, is not intentional, and does not rely on unstated assumptions.
4. Has a provable impact on an affected scenario or call path; speculation is not enough.
5. Is proportionate to the rigor and conventions of the codebase.

Inspect the full diff and enough surrounding code to establish each issue. Check relevant callers, existing implementations, tests, and history. Continue through the entire change after finding an issue. Return all qualifying findings; do not stop at the first. If none qualify, explicitly say the code looks good.

### High-signal checks

- Check whether new functions duplicate existing functionality. Flag real duplication with the existing implementation identified.
- Question one-off helpers that add indirection without clarity or reuse, abstractions without a concrete need, and defensive checks that mask broken invariants.
- Treat silent local error recovery, especially parsing, I/O, and network fallbacks, as high-signal unless a boundary-level justification and tested behavior are clear.
- For untrusted input, check open redirects against trusted destinations, parameterize SQL, protect URL fetches against access to local resources (including DNS resolution), and escape output rather than attempting to sanitize it.
- Apply system-level thinking: consider operational risk, back pressure, and stable error codes/identifiers rather than matching error-message text.

### Fail-fast error handling

Review every new or changed `try`/`catch` or equivalent error handler. Prefer propagation over local recovery. Flag swallowed errors, logging-and-continuing, or fallbacks such as `null`, `[]`, or `false` when they hide failure or pretend success. JSON parsing/decoding should fail loudly unless an explicit compatibility requirement justifies a tested fallback. Boundary handlers may translate errors, but must not silently degrade. When uncertain, prefer failing fast over silent degradation.

### Finding comments and priorities

- Be concise, matter-of-fact, and explicit about the scenario and impact; each body is at most one paragraph.
- Do not exaggerate severity. Use short code snippets; use a `suggestion` block only for minimal, concrete replacement code and preserve its indentation.
- Tag each title: `P0` is an unconditional release/operations blocker; `P1` is urgent; `P2` is normal; `P3` is low-impact but worth fixing.
- Give a precise path and the smallest useful line range. For diff reviews, the location must overlap changed lines; avoid ranges longer than 5–10 lines.
- Do not write a full PR fix. Findings and optional short suggestions are the deliverable.

## Result format

List every finding first, with priority, title, changed-file location, and explanation. Then state the overall verdict as `correct` (no blocking issues) or `needs attention` (blocking issues). Ignore trivial style issues unless they obscure meaning or violate documented standards. End with the required human callouts section below, including `- (none)` when no callout applies.

## Optional follow-up prompts

Use these only when the user asks for a handoff or explicitly asks to implement findings. Reviewing alone never authorizes fixes.

**Review handoff:** Summarize the completed review so another engineer can act on it. Preserve every actionable finding and exact paths/functions/errors where available. Include these sections in order:

1. `## Review Scope` — files, changes, and scope reviewed.
2. `## Verdict` — `correct` or `needs attention`.
3. `## Findings` — each priority/title, `path:line`, why it matters, and concise action.
4. `## Fix Queue` — implementation checklist ordered by priority.
5. `## Constraints & Preferences` — user constraints/preferences, or `(none)`.
6. `## Human Reviewer Callouts (Non-Blocking)` — applicable callouts below, or `- (none)`.

**Implement findings:** Only after explicit user authorization, use the latest review findings as a checklist. Fix in priority order (`P0`, `P1`, `P2`; include `P3` if quick and safe). Explain and continue if a finding is invalid, already fixed, or cannot be handled. Treat human callouts as informational, not tasks. Follow the fail-fast error-handling guidance above, run relevant tests/checks where practical, and finish with fixed items, deferred/skipped items and reasons, plus verification results.

## Human Reviewer Callouts (Non-Blocking)

Include only callouts that apply. They are informational, not findings, and do not change the verdict. Do not turn them into fix items unless there is a separate defect. Keep the bold labels exactly as written:

- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>
- **This change adds or removes feature flags:** <feature flags changed> (call out re-use of dormant feature flags!)
- **This change changes configuration defaults:** <config var changed>

If none apply, write `- (none)`.