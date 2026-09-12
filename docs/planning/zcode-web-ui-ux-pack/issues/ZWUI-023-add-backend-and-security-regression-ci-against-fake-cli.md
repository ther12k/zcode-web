<!-- zcode-ui-plan:ZWUI-023 -->
# [ZWUI-023] Add backend and security regression CI against fake CLI

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M2 |
| Epic | ZWUI-E04 |
| Suggested owner | QA + Backend + Security |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-05, FR-06, FR-07, FR-08, FR-09, FR-18 |
| Depends on | ZWUI-003, ZWUI-007, ZWUI-008, ZWUI-014, ZWUI-015, ZWUI-018 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Turn the baseline fixes and new backend contracts into repeatable gates that do not depend on paid model calls.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement the fake CLI harness and versioned synthetic database fixtures from the acceptance plan, including child process and Unicode/EOF cases.
- [ ] Add HTTP tests for auth/bootstrap, ticket scope/expiry, legacy token rejection, upload/base64/count limits and delivered 413 responses.
- [ ] Add job idempotency, context mismatch, terminal race, restart/retention and bounded-output tests.
- [ ] Add whole-message pagination beyond 2,000 parts, concurrent append and distinct read-only/schema/query error tests.
- [ ] Run browser sanitizer/media cases against protected mode, including missing sanitizer dependency and active-format handling.
- [ ] Wire scripts and CI with candidate/fixture identities, safe trace collection, deterministic clocks where appropriate and explicit skips.

## Acceptance criteria

- [ ] The suite fails when each protected regression is deliberately reintroduced in a local test branch.
- [ ] Core contract/security tests require no model key, proprietary bundle or personal transcript.
- [ ] Auth-enabled tests verify the same production asset/API integration used by the candidate image.
- [ ] Results identify source/build/runtime versions and contain no leaked credentials.

## Required verification

- [ ] **T01 — Access and credential lifecycle:** Protected API challenge, invalid/valid bearer, forget, late response after logout; no previous cache or object URL survives.
- [ ] **T04 — Safe Markdown failure paths:** Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback.
- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T06 — Upload validation and limits:** Invalid base64, over-size request, delivered 413, count limit, unsafe filename round-trip, failed upload retained for retry.
- [ ] **T07 — Protected media lifecycle:** Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer.
- [ ] **T09 — Submission idempotency:** Double activation and lost response create one job; differing payload same key conflicts; restart does not auto-resubmit.
- [ ] **T10 — Server resume boundary:** Session from project A with project B request rejects before CLI start; malformed or unknown context is not silently normalized.
- [ ] **T12 — Terminal semantics and cleanup:** Exit zero/nonzero, agent failure with exit zero, signals, cancel/timeout/close races; one terminal result; supported child-process cleanup tested.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T17 — CLI decoder and memory bounds:** Unicode split across chunks, final line without newline, malformed record, huge record/stderr, bounded buffers with explicit diagnostic.
- [ ] **T18 — Complete logical-message history:** At least 1,000 messages and over 2,000 parts, multi-tool/file turns, final message beyond old cap, no split/lost parts.
- [ ] **T19 — Cursor stability under writes:** Desktop app appends during older-page loads; stable IDs, consistent upper bound, no duplicate/omitted page due to shifting offset.
- [ ] **T20 — Database failure states:** Missing DB, unsupported schema, read-only open failure and SQL failure are distinguishable; no writable fallback or fake empty success.
- [ ] **T27 — Packaging and rollback:** Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback.

## Out of scope

No blanket “secure” certification from a green CI badge and no automatic provider-spend or production mutation in CI.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
