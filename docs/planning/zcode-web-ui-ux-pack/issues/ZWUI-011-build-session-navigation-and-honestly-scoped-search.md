<!-- zcode-ui-plan:ZWUI-011 -->
# [ZWUI-011] Build session navigation and honestly scoped search

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-03, FR-11 |
| Depends on | ZWUI-006, ZWUI-010 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Make existing CLI sessions discoverable without inventing global search or reference-only task metadata.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build per-project session rows with recent order, title, time, selected state and separately sourced running indicators.
- [ ] Add loaded-session filtering with a visible scope label and an explicit no-match state distinct from an empty project.
- [ ] Implement session selection, deep-link restore and invalid/deleted-session handling through Router and Query.
- [ ] Keep a running session discoverable when another project/session is selected; no unverified “complete” badge from a stale generic task field.
- [ ] Add overflow actions only when supported; omit archive/delete/rename mutations from the CLI database.
- [ ] Test large/empty lists, duplicate titles, title update events and requests completing in the wrong order.

## Acceptance criteria

- [ ] Search states its actual loaded/project scope and never claims to include unseen history.
- [ ] Back/forward, deep-link open and selection all bind to the same session identity.
- [ ] Stale session-list data cannot overwrite the selected route or live-run context.
- [ ] No reference task database, pinning field or archive endpoint is assumed by the launch client.

## Required verification

- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

Global server search and browser-local organization belong to ZWUI-029 and ZWUI-028, respectively.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
