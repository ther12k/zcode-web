<!-- zcode-ui-plan:ZWUI-031 -->
# [ZWUI-031] Build lazy read-only Code inspector

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P2 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-21, FR-16 |
| Depends on | ZWUI-020, ZWUI-030 |
| Suggested labels | ui-ux, type:task, priority:P2, scope:optional |

## Goal and context

Add the reference’s useful code-inspection surface without turning the first tool release into a full browser IDE.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add a capability-gated Code tab with lazy file tree and selected-file fetches scoped to the current project.
- [ ] Render text safely with a lazy syntax renderer, copy/select and wrapping controls; never execute code/HTML.
- [ ] Display filename, size, content hash and stale/refreshed state where available; preserve view state without mixing projects.
- [ ] Provide binary/large/truncated/denied/missing file states and a manual refresh action.
- [ ] Link verified file references from tool details to the inspector while treating unverified paths as text.
- [ ] Profile initial route splitting and test keyboard, selection, long lines and narrow viewport behavior.

## Acceptance criteria

- [ ] Opening Code loads no content before the capability and project boundary are known.
- [ ] The first app route does not eagerly fetch heavy syntax/editor assets; content stays read-only and selectable.
- [ ] Unsupported file content is handled explicitly with no unsafe markup insertion or fake save action.
- [ ] Changing project during a slow file request cannot paint the old file into the new project.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T26 — Performance and resources:** Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment.
- [ ] **T31 — Filesystem boundaries:** Traversal/encoding, symlink policy, sensitive files, binary/large input, concurrent path changes and no mutation.
- [ ] **T32 — Read-only code inspector:** Lazy load, line wrapping, selection, binary/denied/truncated states, no save action and no executable content insertion.

## Out of scope

No CodeMirror/Monaco requirement, save/rename/delete UI, formatter execution or hidden mutation shortcut.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
