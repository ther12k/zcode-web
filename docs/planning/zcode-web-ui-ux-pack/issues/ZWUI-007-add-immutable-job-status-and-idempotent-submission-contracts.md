<!-- zcode-ui-plan:ZWUI-007 -->
# [ZWUI-007] Add immutable job status and idempotent submission contracts

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Backend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-03, FR-04, FR-07 |
| Depends on | ZWUI-001, ZWUI-004 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Provide authoritative job reconciliation and prevent ambiguous network retries from starting a second CLI invocation.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add explicit run state, agent outcome, exit code, termination signal, request ID, project binding and server epoch to the job model.
- [ ] Validate resumed session directory against the canonical requested project before spawning; reject mismatched version-2 model/mode choices explicitly.
- [ ] Implement bounded same-epoch idempotency for clientRequestId: identical normalized request returns the original job, conflicting payload returns 409.
- [ ] Add authenticated bounded job list/detail and request-ID lookup with output snapshot/high-water metadata; list results must not include all raw outputs.
- [ ] Define restart/eviction behavior, retention and error codes; do not claim exactly-once across process crashes.
- [ ] Make cancel/timeout/close terminal transitions idempotent and preserve intent versus outcome; characterize supported process-tree cleanup.

## Acceptance criteria

- [ ] Double activation and a lost acceptance response produce one CLI start within the retained epoch/request window.
- [ ] Cross-project resume fails before process creation; a changed server epoch never silently starts an uncertain retry.
- [ ] Process exit zero with an explicit agent failure does not display unqualified success; cancellation is not terminal before evidence.
- [ ] Job snapshots and their sequence watermark describe one consistent state and reveal output truncation.

## Required verification

- [ ] **T09 — Submission idempotency:** Double activation and lost response create one job; differing payload same key conflicts; restart does not auto-resubmit.
- [ ] **T10 — Server resume boundary:** Session from project A with project B request rejects before CLI start; malformed or unknown context is not silently normalized.
- [ ] **T12 — Terminal semantics and cleanup:** Exit zero/nonzero, agent failure with exit zero, signals, cancel/timeout/close races; one terminal result; supported child-process cleanup tested.
- [ ] **T16 — Server restart reconciliation:** Epoch changes, missing job, expired idempotency entry; UI reports uncertainty and does not infer success or re-execute.

## Out of scope

No distributed durable queue or exactly-once crash guarantee. Any remaining descendant cleanup limit must be explicit, not hidden by the UI.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
