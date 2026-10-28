---
_template:
  title: Implementation plan
  description: For capturing requirements, assessing risks, and phasing an
    implementation before writing any code
---
## Requirements

- What's being changed?
- Why is it being changed?
- What's explicitly out of scope?
- Related notes or prior art (link them):

## Related notes

> # !Instructions
>
> Link the agreed implementation spec and, when applicable, its source ticket note with the ticket number and title.
> Link relevant prior art without inventing references.
> If there is no separate spec, identify the user-approved requirements that define this plan's scope.

* * *

> # !Instructions
> 
> ## Planning Steps
> 
> 1. **Analyze the request** and restate requirements in clear terms.
>    - Treat the agreed spec, or explicit user-approved requirements, as the scope boundary.
>    - If investigation reveals a missing decision or requires a scope change, ask the user rather than silently changing requirements.
>    - Resolve blocking spec questions before finalizing the plan.
> 2. **Ground the plan** in relevant codebase patterns when the repo is available
> 3. **Break down into phases** with specific, actionable steps.
>    - Require an **Action** and **Verify** entry for every phase.
>    - Identify dependencies where relevant.
>    - Make verification concrete: name the checks and expected observable outcomes.
>    - Include agreed TDD seams where appropriate, including the behaviour to test first.
> 4. **Identify dependencies** between components
> 5. **Assess risks** and potential blockers
> 6. **Estimate complexity** (High/Medium/Low)
> 
> ## Planning versus execution
>
> - When initially filling the plan, leave all implementation phases unchecked.
> - Keep execution results pending until the work actually happens.
> - Do not fabricate completed changes, dates, branches, commits, or test results.
> - During execution, update Status with observed progress and verification results.
> - Record actual outcomes and commits in Outcome only after they exist.
> - Follow-up may list known deferred work during planning, clearly labeled as such.
> - Add execution-discovered follow-ups only when they are actually discovered.
> - The example below illustrates a plan updated during execution, not initial completion.
>
> ## Formatting
> 
> - **One fact per bullet.** Never pack several facts into one sentence separated by semicolons or parentheses. Split into sub-bullets instead.
> - **Current State**: one `###` subsection per topic (a slice, a file, a call site, tests, consumers) if it gets long. Under the heading, a one-line scope (file path, branch, where it's staged), then flat bullets with `file:line` references. Nest only where a bullet branches (e.g. mobile vs desktop).
> - **Decisions Needed**: a numbered list. Each item is a bold title and a one-line question, then each option as a task sub-item: bold name, "(Recommended)" on the one you'd pick, and a one-line summary. Nest one consideration per bullet under each option. Once the user settles a decision, check it (`1. [x]`), delete the other options, and drop the chosen option's checkbox.
> - **Status**: each phase is a task with a one-line summary, then sub-bullets listing what was done, one change per bullet.
> 


## Requirements Restatement

## Current State

What does the code actually do today? Verify against source, don't assume. One `###` per topic.

### Topic

`src/file.ts`.

- One fact per bullet, with a `:line` reference.
- Nest only where a bullet branches:
  - branch A
  - branch B

```js filename="example.js" title="Current implementation" line=30
if (isMacOS()) {
  enableFeature()
} else {
  // not supported on this platform yet
}
```

## Decisions Needed

1. **Decision title.** What needs deciding, in one line. Confirm before implementing.
   - [ ] **Option A (Recommended)**: what it does.
     - One consideration per sub-bullet.
   - [ ] **Option B**: the alternative.
     - Why it loses, one reason per sub-bullet.

## Implementation Phases

### Phase 1: [Title]

- **Action**:
- **Verify**:
- **Dependencies**: None, or the prerequisites for this phase.
- **TDD seam**: Agreed behaviour to test first, or not applicable with a reason.

### Phase 2: [Title]

- **Action**:
- **Verify**:
- **Dependencies**: None, or the prerequisites for this phase.
- **TDD seam**: Agreed behaviour to test first, or not applicable with a reason.

## Dependencies

- New libraries, APIs, or services this requires (or note if none):

## Risks

- **HIGH / MEDIUM / LOW — Risk description**: Risk details and mitigation plan.

## Estimated Complexity

- Per phase:
- Total:

## Status

- [ ] **Phase 1**: [Summary] — pending.
- [ ] **Phase 2**: [Summary] — pending.

## Outcome

Pending implementation.

## Follow-up

> # !Example
>
> ## Requirements
>
> - The `import-markdown` plugin's UX is backwards — it opens a select-notebook dialog before the native file picker, then shows a separate progress dialog. Merge `select-book-dialog.tsx` + `progress-dialog.tsx` into one wizard-style dialog (native pick → scanning → stats → notebook → progress).
> - Out of scope: adding folder import support on Windows/Linux (Electron can't combine `openFile` + `openDirectory` there).
>
> ## Related notes
>
> (none — first design pass on this UX, not a follow-up to a prior bug/idea note)
>
> * * *
>
> ## Requirements Restatement
>
> Reorder the flow to pick files **first**, then walk the user through a single wizard-style `Dialog` with four in-place steps — Scanning → Stats → Select Notebook → Progress — replacing the two separate dialog components with one. The wizard opens immediately after the picker returns and shows live scan progress while the selection is measured.
>
> ## Current State
>
> ### Command flow
>
> `src/index.tsx`.
>
> - The command shows the notebook-select dialog **first** (`:28`).
> - The native picker opens only inside that dialog's callback (`:30`), backwards from the desired flow.
>
> ```tsx filename="src/index.tsx" line=28 title="Notebook is chosen BEFORE the native picker opens"
> const handleNotebookSelected = useCallback(
>   async (destBookId: string | null) => {
>     const { filePaths } = await openImportDialog({
>       isFolderOnly: destBookId === null
>     })
>     ...
> ```
>
> ### Dialogs
>
> `src/select-book-dialog.tsx`, `src/progress-dialog.tsx`.
>
> - Two separate `useModal()` instances (`src/index.tsx:21-22`).
> - The progress dialog stacks on top of the still-open notebook dialog during scanning.
> - Each dialog has its own stylesheet under `styles/`.
>
> ### Scanning
>
> `src/scan.ts`.
>
> - `checkSizeOfFiles` is synchronous (`:12-40`), so nothing repaints while it runs.
>
> ## Decisions Needed
>
> 1. [x] **Cross-platform picker mode.** Which file types can the picker select on each OS?
>    - **Keep today's live behavior (Recommended)**: macOS picks files+folders, Win/Linux files only.
>      - Electron can't combine `openFile` + `openDirectory` on Windows/Linux.
>      - Folder import on Win/Linux is already unreachable, so this is zero regression.
> 2. [x] **Notebook step: confirm vs. auto-advance.** Should a notebook row click import right away?
>    - **Capture-then-confirm (Recommended)**: a row click stores the notebook; an Import button commits.
>      - `NotebookListBar` has no controlled "selected" prop, so a row click can't stay visually highlighted.
>      - The Import button gives the user a visible confirmation step.
>
> ## Implementation Phases
>
> ### Phase 1: Merged wizard dialog component
>
> - **Files**: `src/import-wizard-dialog.tsx`, `styles/import-wizard-dialog.css`
> - **Action**: Build one `Dialog` with a `switch (step)` selecting content + actions for scanning/stats/notebook/progress (see the step union sketched below); merge the two old stylesheets under a new root class
>
> ```ts filename="src/import-wizard-dialog.tsx" line=1 title="Proposed step union for the merged wizard"
> type WizardStep = 'scanning' | 'stats' | 'notebook' | 'progress'
> // oversized-file errors render within 'stats'; importError renders within 'progress'
> // 'scanning' and 'progress' share one status-line renderer, parameterized by label (Decisions Needed #4)
> ```
>
> - **Why**: A single dialog instance is required for the wizard; scanning and progress share one status-line renderer to minimize new UI surface
> - **Verify**: Manually render each step in isolation and confirm its content and actions
>
> ### Phase 2: Reorder orchestration in index.tsx
>
> - **Files**: `src/index.tsx`
> - **Action**: Replace the two `useModal()` calls with one (see the state shape sketched below); add `step`/`filePaths`/`totalSize`/`selectedBookId` state; call `openImportDialog()` first, open the dialog immediately at `scanning`, then transition through `stats` → `notebook` → `progress`
>
> ```ts filename="src/index.tsx" line=21 title="Proposed state shape, replacing the two separate useModal() instances above"
> const wizardDialog = useModal()
> const [step, setStep] = useState<WizardStep>('scanning')
> const [filePaths, setFilePaths] = useState<string[]>([])
> const [totalSize, setTotalSize] = useState(0)
> const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
> ```
>
> - **Why**: Implements "files first" — the wizard opens immediately and shows live scan progress
> - **Verify**: `npm run dev`, trigger the import command, confirm the dialog opens before scanning and advances through all four steps
> - **Dependencies**: Phase 1's wizard dialog component
> - **Risk**: Low
>
> ## Dependencies
>
> - None — reuses `Dialog` and `NotebookListBar` already exposed via `getEnv().components.classes`; no new npm packages
>
> ## Risks
>
> - **MEDIUM — Async scan may not paint**: Converting `checkSizeOfFiles` to async could still fail to paint if it doesn't yield to a real event-loop macrotask (a microtask-only yield wouldn't repaint). Mitigate with real async I/O (`await fsp.stat` / `await glob(...)`) so each item hits a macrotask boundary, and throttle progress updates (~50-100ms) to avoid render thrash.
>
> ## Estimated Complexity
>
> - Per phase: Phase 1 (Medium — new component + merged styles), Phase 2 (Low — state machine wiring)
> - Total: Medium — roughly a day including manual cross-platform picker checks and scan-progress verification
>
> ## Status
>
> - [x] **Phase 1**: Merged wizard dialog component. Done on `feat/import-wizard`, committed.
>   - Split into five files (one orchestrator + one component per step) instead of a single `switch`, per user request to reduce complexity.
>   - Merged the two stylesheets under `.import-wizard-dialog`.
> - [ ] **Phase 2**: Reorder orchestration in index.tsx
>
> ## Outcome
>
> - **Commit**: [`3f9c2e1`](https://github.com/inkdropapp/inkdrop-import-markdown/commit/3f9c2e1)
>
> Notable deviations, all driven by user requests along the way: the wizard split into five files instead of one `switch`-based component, and the scan never gained live per-file progress — the user judged it fast enough without one after seeing it in practice.
>
> ## Follow-up
>
> - Folder import on Windows/Linux (out of scope here): needs a separate "Import folder…" entry, since Electron can't combine `openFile` + `openDirectory` on those platforms.
> - Revisit live per-file scan progress if users report the scanning step feeling stuck on large vaults.
