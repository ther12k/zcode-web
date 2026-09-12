<!-- zcode-ui-plan:ZWUI-E01 -->
# [ZWUI-E01] Foundation and execution contracts

**Status:** Proposed. **Type:** Epic. **Scope:** Required core launch.

## Outcome

Create a buildable frontend, stable context/auth contracts and the backend evidence required for trustworthy live execution.

## Child tasks

- [ ] **ZWUI-001** — Capture baseline contracts, source identity and regression fixtures
- [ ] **ZWUI-002** — Scaffold Vite React TypeScript frontend with locked dependencies
- [ ] **ZWUI-003** — Serve modern assets in Node and Docker with safe rollback
- [ ] **ZWUI-004** — Define typed API client, auth bootstrap and capability contract
- [ ] **ZWUI-005** — Build graphite-sage design tokens and accessible UI primitives
- [ ] **ZWUI-006** — Implement route identity and strict state ownership
- [ ] **ZWUI-007** — Add immutable job status and idempotent submission contracts
- [ ] **ZWUI-008** — Implement bounded resumable SSE v2 and explicit ticket expiry

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

Baseline identities and fixtures exist; the Vite build, static deployment, capability model, immutable jobs and resumable stream contracts pass their task gates.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
