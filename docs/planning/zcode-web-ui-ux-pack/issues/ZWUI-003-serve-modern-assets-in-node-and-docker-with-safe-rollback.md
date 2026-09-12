<!-- zcode-ui-plan:ZWUI-003 -->
# [ZWUI-003] Serve modern assets in Node and Docker with safe rollback

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Backend + DevOps |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-18, FR-24 |
| Depends on | ZWUI-002, ZWUI-004 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Make the built SPA a deployable part of the existing service while retaining an explicit previous safe frontend for rollout and rollback.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add the documented legacy/modern asset selection and package both trees during transition; require the safe legacy sanitizer patch before rollback qualification.
- [ ] Implement UI history fallback only for authorized route classes and appropriate HTML navigation requests; never mask API or missing asset errors.
- [ ] Set hashed-asset cache policy, HTML revalidation, MIME and safe static-path handling; verify JS/CSS/font assets from the actual build output.
- [ ] Add a multi-stage Node 24 Docker build with locked frontend installation and copy only needed runtime assets; retain CLI paths and volumes.
- [ ] Ensure the health probe works when API authentication is enabled, without exposing sensitive diagnostic fields publicly.
- [ ] Record build/image digests and document UI selection, nested-route reload and rollback steps.

## Acceptance criteria

- [ ] The production image serves a nested session URL on refresh and returns real 404s for absent JS assets and unknown API endpoints.
- [ ] The runtime starts the existing Node service, not Vite dev/preview or React SSR.
- [ ] Token-protected container health succeeds without embedding a token in a URL or public artifact.
- [ ] Switching back to the previous safe frontend leaves CLI session and project data untouched.

## Required verification

- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T27 — Packaging and rollback:** Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback.

## Out of scope

No CDN hosting migration, service worker/offline cache, CLI bundle redistribution or database rollback.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
