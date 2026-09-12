<!-- zcode-ui-plan:ZWUI-024 -->
# [ZWUI-024] Add browser integration tests for navigation streaming and recovery

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M2 |
| Epic | ZWUI-E04 |
| Suggested owner | QA + Frontend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-03, FR-04, FR-07, FR-08, FR-09, FR-24 |
| Depends on | ZWUI-010, ZWUI-013, ZWUI-017, ZWUI-019, ZWUI-020, ZWUI-022, ZWUI-023 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Verify the interactions most likely to break during a rich-client migration against the built UI and actual Node transport.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement Playwright integration using the Node server plus deterministic fake CLI, not only mocked fetch responses.
- [ ] Exercise project/session switching during a run, late history/ticket/blob responses and delayed first-session binding.
- [ ] Inject stream drops before/after text/tool/terminal events, expired tickets, duplicate replay and old-cursor resets.
- [ ] Exercise lost submit response, duplicate activation, restart/epoch mismatch and user-driven retry after an unresolved outcome.
- [ ] Test attachment-only sending, protected image loads, transcript reconciliation, unavailable artifacts and capability false states.
- [ ] Run core flows in pinned Chromium/Firefox/WebKit builds and retain redacted traces/screenshots with environment notes.

## Acceptance criteria

- [ ] All required cross-context, replay and ambiguous-submission cases pass without a second CLI invocation.
- [ ] Transport failures never become fake completion and no event is appended to another session.
- [ ] Live/persisted output merges without duplicate final messages and preserves attachment/tool grouping.
- [ ] Browser evidence is tied to the exact built candidate; unsupported/live-provider lanes are explicitly reported.

## Required verification

- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T07 — Protected media lifecycle:** Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer.
- [ ] **T08 — Unresolved artifact behavior:** Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely.
- [ ] **T09 — Submission idempotency:** Double activation and lost response create one job; differing payload same key conflicts; restart does not auto-resubmit.
- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T13 — Replay consistency:** Drop at every boundary, reconnect before/after terminal, duplicate event, replay/live handoff; ordered exactly-once application per sequence.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T15 — Retention reset:** Cursor older than replay window causes explicit reset and snapshot reconciliation; truncation visible; never append a duplicate replay.
- [ ] **T16 — Server restart reconciliation:** Epoch changes, missing job, expired idempotency entry; UI reports uncertainty and does not infer success or re-execute.
- [ ] **T19 — Cursor stability under writes:** Desktop app appends during older-page loads; stable IDs, consistent upper bound, no duplicate/omitted page due to shifting offset.
- [ ] **T21 — Transcript reading position:** Prepend, expand tool, late image, resize pane and live delta while scrolled up; preserve anchor; New output resumes follow.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No claim of physical-device verification from engine emulation and no test harness that silently replaces the production adapter with demo logic.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
