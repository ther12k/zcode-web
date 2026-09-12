<!-- zcode-ui-plan:ZWUI-006 -->
# [ZWUI-006] Implement route identity and strict state ownership

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-03, FR-12, FR-24 |
| Depends on | ZWUI-004 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Separate the selected view from persisted sessions, drafts and running jobs so navigation never retargets execution.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement typed root, project/new, project/session and settings routes with validated non-sensitive search state.
- [ ] Define instance/project/session/draft/job identity types and query/storage key factories; do not use a global mutable cwd/session pair for all work.
- [ ] Handle project/session mismatches and unknown deep links explicitly instead of selecting the first available project.
- [ ] Introduce generation guards for route reads and first-session binding after a run starts; update the URL only if the originating draft is still selected.
- [ ] Keep route loaders integrated with the same Query cache and establish the independent run-store subscription boundary.
- [ ] Document transition behavior for back/forward, route unmount, project rename and server-instance/epoch change.

## Acceptance criteria

- [ ] Deep links and browser history restore the same context without putting raw credentials or attachment paths in the URL.
- [ ] A late history/config/session-binding response cannot change the newly selected project or conversation.
- [ ] Navigating away removes only view subscriptions; it neither cancels nor changes an active CLI job.
- [ ] New drafts remain distinct before the CLI assigns a persisted session ID.

## Required verification

- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T10 — Server resume boundary:** Session from project A with project B request rejects before CLI start; malformed or unknown context is not silently normalized.
- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T23 — Draft correctness:** Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change.

## Out of scope

No global workspace object duplicated between Router, Query and another store; no job network side effects in route render.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
