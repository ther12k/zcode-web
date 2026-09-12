<!-- zcode-ui-plan:ZWUI-008 -->
# [ZWUI-008] Implement bounded resumable SSE v2 and explicit ticket expiry

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Backend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-07, FR-08, FR-17 |
| Depends on | ZWUI-007 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Make stream recovery deterministic while preserving the bearer-to-ticket security fix and defining what ticket expiration actually means.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add a negotiated v2 envelope with per-job server-generated sequence and SSE event ID for all retained CLI and server lifecycle events.
- [ ] Implement atomic replay/live handoff, after/Last-Event-ID validation, heartbeat behavior and terminal connection closure; keep the legacy envelope separate.
- [ ] Add replay byte budgets, explicit old-cursor reset control and a consistent bounded snapshot/high-water recovery path.
- [ ] Give tickets explicit job/epoch/opening expiry; return expiresAt, redact URLs and reject legacy bearer query authentication in protected mode.
- [ ] Permit documented short-lived access to retained terminal jobs for reconciliation without claiming tickets expire exactly at completion.
- [ ] Use incremental UTF-8 decoding, EOF flush and bounded partial-record/stderr buffers; define oversized-record behavior and terminal race handling.

## Acceptance criteria

- [ ] Every applied v2 event has one job/epoch/sequence identity; reconnect loses or duplicates no application event within retention.
- [ ] Old cursors trigger explicit reset rather than silent replay truncation; final/timeout states survive reconnect.
- [ ] Wrong-job, wrong-epoch, expired and legacy bearer-query cases reject with auth enabled; ticket mint failures do not bypass auth.
- [ ] Unicode/EOF/oversized-output fixtures pass and measured buffers remain within configured bounds.

## Required verification

- [ ] **T13 — Replay consistency:** Drop at every boundary, reconnect before/after terminal, duplicate event, replay/live handoff; ordered exactly-once application per sequence.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T15 — Retention reset:** Cursor older than replay window causes explicit reset and snapshot reconciliation; truncation visible; never append a duplicate replay.
- [ ] **T17 — CLI decoder and memory bounds:** Unicode split across chunks, final line without newline, malformed record, huge record/stderr, bounded buffers with explicit diagnostic.

## Out of scope

No switch to WebSockets, raw bearer URLs, unbounded replay store, or reuse of upstream CLI sequence as the complete transport cursor.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
