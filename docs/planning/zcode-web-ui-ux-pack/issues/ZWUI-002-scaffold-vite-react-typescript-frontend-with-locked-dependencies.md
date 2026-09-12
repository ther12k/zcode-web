<!-- zcode-ui-plan:ZWUI-002 -->
# [ZWUI-002] Scaffold Vite React TypeScript frontend with locked dependencies

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-01, FR-18 |
| Depends on | ZWUI-001 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Introduce the modern client as a separate buildable frontend without changing CLI execution or importing the reference Next.js application.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Create web/ with the React TypeScript Vite template, explicit source aliases, lint/typecheck/test/build scripts and a committed lockfile.
- [ ] Resolve supported compatible versions on Node 24; record direct dependencies, notices and current advisory checks. Do not reuse archive pins as an approved dependency graph.
- [ ] Install Router/Query, Tailwind Vite integration, selected consistent primitives, icons and bundled Markdown/sanitizer dependencies only as needed.
- [ ] Create root error/loading boundaries and a provider composition that does not start jobs in effects.
- [ ] Configure a development /api proxy preserving SSE and auth behavior; do not loosen production CORS or expose backend secrets through client variables.
- [ ] Add a production-build inspection that rejects unexpected Next/Drizzle/provider-client imports, external CDN references or leaked secret placeholders.

## Acceptance criteria

- [ ] A clean locked install, independent typecheck, lint, unit smoke and build succeed on the chosen Node 24 environment.
- [ ] Built files are static frontend assets; no Next.js, PostgreSQL or SSR runtime is needed to launch them.
- [ ] API development proxy supports authenticated requests and a test SSE stream without a second execution backend.
- [ ] No CLI/provider secret is present in the client bundle, source map or committed environment file.

## Required verification

- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T27 — Packaging and rollback:** Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No production cutover, full dependency refresh of the backend, monorepo orchestration platform or full-stack Start adoption.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
