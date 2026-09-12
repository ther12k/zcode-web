<!-- zcode-ui-plan:ZWUI-018 -->
# [ZWUI-018] Add stable logical-message history pagination and DB errors

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E03 |
| Suggested owner | Backend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-09, FR-17, FR-24 |
| Depends on | ZWUI-001, ZWUI-004 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Extend the logical-message fix to large and concurrently changing histories without relying on a pre-grouping part-row cap.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add a negotiated history-v2 response with durable message/part IDs, ordered parts, session-bound cursor and stable upper-bound snapshot.
- [ ] Select the message page before loading its parts; remove silent completeness assumptions created by a global part-row limit.
- [ ] Provide recent-first page selection with chronological display order and older-page cursors stable under newly appended desktop messages.
- [ ] Compute trustworthy hasMore/count metadata or explicitly label truncation/unknown completeness; do not split one message from its tool/file parts.
- [ ] Differentiate missing database, unsupported schema, read-only failure and query failure; remove writable fallback from the read adapter.
- [ ] Keep legacy pagination during migration and add large synthetic schema/version fixtures without modifying a real desktop database.

## Acceptance criteria

- [ ] A fixture beyond 2,000 parts returns the newest complete message and all relevant parts rather than a silently old truncated history.
- [ ] Concurrent append does not duplicate/omit older messages through moving offsets; stable IDs allow current-message reconciliation.
- [ ] Query/schema failures produce explicit errors and no writes, not a successful empty transcript.
- [ ] Legacy clients retain their supported response shape until the documented cleanup boundary.

## Required verification

- [ ] **T18 — Complete logical-message history:** At least 1,000 messages and over 2,000 parts, multi-tool/file turns, final message beyond old cap, no split/lost parts.
- [ ] **T19 — Cursor stability under writes:** Desktop app appends during older-page loads; stable IDs, consistent upper bound, no duplicate/omitted page due to shifting offset.
- [ ] **T20 — Database failure states:** Missing DB, unsupported schema, read-only open failure and SQL failure are distinguishable; no writable fallback or fake empty success.

## Out of scope

No second conversation database, direct edit/rename/archive of desktop sessions or unbounded full-history download.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
