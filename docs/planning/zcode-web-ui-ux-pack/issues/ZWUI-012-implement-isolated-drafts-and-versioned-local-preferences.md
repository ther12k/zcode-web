<!-- zcode-ui-plan:ZWUI-012 -->
# [ZWUI-012] Implement isolated drafts and versioned local preferences

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-12, FR-17 |
| Depends on | ZWUI-006 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Protect unsent work during navigation and failure while making local persistence a clear user choice.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define draft keys from instance/project/session-or-draft identity and keep selection independent from active runs.
- [ ] Preserve input on failed submission and clear only the accepted draft revision, not text typed while a request was pending.
- [ ] Keep drafts in memory by default; implement explicit text-only device persistence, expiry/quota handling and clear/reset controls.
- [ ] Persist theme/pane preferences separately with schema validation and fallback; do not store attachment bytes or stream tickets in preferences.
- [ ] Handle the atomic move from a new-draft identity to the authoritative session identity without moving another draft.
- [ ] Define credential/instance change behavior and surface storage-denied/full conditions without preventing ordinary chat.

## Acceptance criteria

- [ ] Drafts in A and B remain distinct through rapid navigation, failed sends and late session binding.
- [ ] An accepted old revision never erases newly typed text; removed attachment chips do not claim server-byte deletion.
- [ ] Device persistence is opt-in, scoped and labeled local; reset/expiry actually removes the relevant stored text.
- [ ] Quota/private-mode storage failure degrades to an in-memory draft with a clear message.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T23 — Draft correctness:** Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change.

## Out of scope

No cross-device sync, transcript caching, attachment-byte persistence or browser-local credential encryption claim.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
