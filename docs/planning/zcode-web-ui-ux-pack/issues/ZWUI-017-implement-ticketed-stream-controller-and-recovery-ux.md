<!-- zcode-ui-plan:ZWUI-017 -->
# [ZWUI-017] Implement ticketed stream controller and recovery UX

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M1 |
| Epic | ZWUI-E03 |
| Suggested owner | Frontend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-07, FR-08, FR-24 |
| Depends on | ZWUI-008, ZWUI-016 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Manage stream lifetime independently of view lifetime and recover interrupted runs without duplicate text or repeated execution.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement one per-job transport owner per tab with explicit ticket/connecting/live/reconnecting/auth-required/closed states.
- [ ] Close failed EventSource instances, acquire fresh tickets with bounded backoff and resume after the last applied wrapper sequence.
- [ ] Guard late ticket callbacks by generation/job/epoch; handle React development effect replay and disposed views deterministically.
- [ ] Implement reset-required snapshot reconciliation at a high-water mark and visible truncation/unavailable-output states.
- [ ] Keep job outcome intact during transport loss; reconcile accepted submissions and missing records without auto-resending prompts.
- [ ] Connect cancellation and terminal cleanup, clear timers/controllers/listeners and expose contextual reconnect/unknown-outcome copy.

## Acceptance criteria

- [ ] Network loss retains text and reports reconnecting, not done; successful recovery has no missing/duplicate applied deltas.
- [ ] Expired/wrong-job/mint-failed tickets cannot cause tokenless fallback or bearer URLs.
- [ ] Navigation away and back does not create another CLI job or attach A output to B.
- [ ] Restart/eviction produces a truthful unresolved outcome and requires deliberate user intent for a new run.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T13 — Replay consistency:** Drop at every boundary, reconnect before/after terminal, duplicate event, replay/live handoff; ordered exactly-once application per sequence.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T15 — Retention reset:** Cursor older than replay window causes explicit reset and snapshot reconciliation; truncation visible; never append a duplicate replay.
- [ ] **T16 — Server restart reconciliation:** Epoch changes, missing job, expired idempotency entry; UI reports uncertainty and does not infer success or re-execute.

## Out of scope

No cross-tab leader election requirement, unbounded automatic retries or transport state masquerading as execution state.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
