<!-- zcode-ui-plan:ZWUI-001 -->
# [ZWUI-001] Capture baseline contracts, source identity and regression fixtures

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Backend + QA |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-17, FR-18, FR-24 |
| Depends on | None |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Freeze what the current implementation actually does before changing its presentation. Separate maintainer-reported verification from newly reproduced evidence and preserve the desktop/CLI data boundary.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Record the full SHA resolving f102cef, actual implementation branch head, CLI version, Node version and deployment mode. Record divergence without silently treating the old baseline as latest.
- [ ] Inventory API request/response/status shapes, SSE envelopes and logical-message/artifact behavior; create synthetic or redacted fixtures with version notes.
- [ ] Capture the existing safe Markdown, attachment-only send, ticket authorization, upload validation/MIME/413 and logical-message grouping behaviors as regression cases.
- [ ] Identify the source-level missing-sanitizer fallback, ticket-expiry wording and pre-pagination part cap as open migration gates, linking ZWUI-015/008/018.
- [ ] Confirm which reference screens can be rendered in an authorized development environment and record whether visual approval is source-derived or screenshot-backed.
- [ ] Publish a compatibility matrix distinguishing implemented, documented limitation, proposed and unverified capabilities; record legacy rollback constraints.

## Acceptance criteria

- [ ] Baseline records contain exact source and fixture identities, not only a branch name or a verbal “verified.”
- [ ] Synthetic fixtures contain no bearer/provider credentials, personal transcripts or proprietary CLI bundle.
- [ ] Every previously reported fix has a named regression case; the custom artifact URI remains metadata-only.
- [ ] No CLI database write, backend replacement or product capability is introduced by this evidence task.

## Required verification

- [ ] **T04 — Safe Markdown failure paths:** Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback.
- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T06 — Upload validation and limits:** Invalid base64, over-size request, delivered 413, count limit, unsafe filename round-trip, failed upload retained for retry.
- [ ] **T08 — Unresolved artifact behavior:** Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T18 — Complete logical-message history:** At least 1,000 messages and over 2,000 parts, multi-tool/file turns, final message beyond old cap, no split/lost parts.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No broad new security audit, provider migration or feature implementation. Do not mark unexecuted live tests as passed.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
