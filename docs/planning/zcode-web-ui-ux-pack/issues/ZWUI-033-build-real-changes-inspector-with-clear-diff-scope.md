<!-- zcode-ui-plan:ZWUI-033 -->
# [ZWUI-033] Build real Changes inspector with clear diff scope

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P2 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-22, FR-17 |
| Depends on | ZWUI-020, ZWUI-032 |
| Suggested labels | ui-ux, type:task, priority:P2, scope:optional |

## Goal and context

Let users review actual repository changes while keeping inspection and mutation clearly separate.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add a capability-gated Changes tab with real branch/repository state and explicit base/scope labels.
- [ ] Build changed-file summaries and bounded diff expansion for text, rename, untracked and binary states.
- [ ] Display truncation, stale data and unavailable repository/tool states; refresh after relevant completed runs without claiming attribution.
- [ ] Use safe code/text rendering and link into the read-only Code view only when that capability exists.
- [ ] Preserve selected diff identity/scroll during refresh and guard late results after a project switch.
- [ ] Add keyboard/narrow-screen behavior and visual checks for additions/deletions that do not rely on color alone.

## Acceptance criteria

- [ ] Every displayed file count/branch/diff is backed by the real API rather than a reference fixture.
- [ ] Users can tell which versions are compared and whether output is truncated or stale.
- [ ] No commit button, fabricated hash or “all agent changes” statement appears without a separate supported contract.
- [ ] Capability absent/non-repository states do not break chat or other inspector tabs.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T33 — Real Git evidence:** Fixture repository edits/renames/binary/untracked/large output, correct base, no mutation or external diff execution.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No mutation controls, patch application, snapshot restore, Git hosting integration or automatic change ownership inference.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
