<!-- zcode-ui-plan:ZWUI-016 -->
# [ZWUI-016] Implement normalized run reducer and immutable event store

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M1 |
| Epic | ZWUI-E03 |
| Suggested owner | Frontend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-03, FR-07, FR-08, FR-10 |
| Depends on | ZWUI-006, ZWUI-007, ZWUI-008 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Convert upstream and server events into one deterministic run model that is independent of whichever conversation is visible.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define normalized text/tool/artifact/activity/error/terminal domain events and versioned adapters for known CLI fixture shapes.
- [ ] Create a subscribed store keyed by epoch/job with immutable project/session bindings and stable message/part identity.
- [ ] Apply events idempotently by server sequence, distinguish deltas from snapshots and preserve agent outcome versus process state.
- [ ] Handle first-session binding, unknown events, cancellation races and metadata-only artifacts without fabricated progress or success.
- [ ] Batch high-frequency UI notifications while preserving event order; keep raw diagnostic retention bounded and redacted.
- [ ] Add reducer/property-style tests that permute duplicates, late callbacks and terminal races with deterministic expected outcomes.

## Acceptance criteria

- [ ] Applying the same sequence twice changes state once; changing routes does not change which run an event updates.
- [ ] Unknown event types produce a safe bounded diagnostic rather than a guessed completion/tool result.
- [ ] Terminal transitions are idempotent and explicit agent failure is not overwritten by generic exit-zero success.
- [ ] UI subscriptions can attach/detach without losing the active run or starting network/process side effects.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T12 — Terminal semantics and cleanup:** Exit zero/nonzero, agent failure with exit zero, signals, cancel/timeout/close races; one terminal result; supported child-process cleanup tested.
- [ ] **T13 — Replay consistency:** Drop at every boundary, reconnect before/after terminal, duplicate event, replay/live handoff; ordered exactly-once application per sequence.
- [ ] **T15 — Retention reset:** Cursor older than replay window causes explicit reset and snapshot reconciliation; truncation visible; never append a duplicate replay.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No full workspace duplication in a second cache and no synthetic reasoning/activity narrative from the reference.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
