# GitHub-ready issue register

**36 task bodies + 6 epic bodies.** The 27 core tasks are launch requirements; the nine optional tasks describe a separate extension scope. Every identifier below is a planning ID, not a current GitHub issue number. No issues have been created.

## Milestones

| Suggested title | Intent | Completion gate |
|---|---|---|
| M0 | Baseline, frontend foundation, auth/contracts and early renderer hardening | Accepted identity/API/run/stream contracts, safe content path and production asset skeleton |
| M1 | Complete core workspace experience | Navigation, composer, history, live runs, inspector and settings integrated with real backend contracts |
| M2 | Prove and release core | Security, browser, accessibility, performance, packaging and rollback evidence accepted |
| M3 | Optional capability extensions | Only deliberately selected capabilities appear; each has its own completed acceptance gate |

ZWUI-015 is deliberately brought into M0 despite its conversation epic and higher numeric ID. Some M1 contract work can begin before all M0 work finishes where dependencies permit. Milestones are delivery groupings, not a replacement for task prerequisites.

## Priority and sizing

**P0** means a delivery-blocking correctness/security/operational prerequisite. It is not a CVSS severity assertion and does not mean every listed issue is an exploitable production vulnerability. **P1** means required planned functionality or a gate for an optional capability. **P2** means a post-launch enhancement. Optional P1 work is required only when that optional feature is selected; it does not secretly expand the core release.

Relative review scope **M** usually fits a cohesive boundary; **L** crosses multiple boundaries or needs substantial race/security/integration verification. These are not time or staffing estimates. Split an L issue into smaller PRs when useful, preserving the parent acceptance gate.

## Epics

| Planning ID | Epic | Scope | Child tasks |
|---|---|---|---|
| [ZWUI-E01](epics/ZWUI-E01.md) | Foundation and execution contracts | Core | ZWUI-001, ZWUI-002, ZWUI-003, ZWUI-004, ZWUI-005, ZWUI-006, ZWUI-007, ZWUI-008 |
| [ZWUI-E02](epics/ZWUI-E02.md) | Workspace navigation and interaction | Core | ZWUI-009, ZWUI-010, ZWUI-011, ZWUI-012, ZWUI-013, ZWUI-014, ZWUI-021, ZWUI-022 |
| [ZWUI-E03](epics/ZWUI-E03.md) | Conversation streaming and evidence | Core | ZWUI-015, ZWUI-016, ZWUI-017, ZWUI-018, ZWUI-019, ZWUI-020 |
| [ZWUI-E04](epics/ZWUI-E04.md) | Quality release and rollback | Core | ZWUI-023, ZWUI-024, ZWUI-025, ZWUI-026, ZWUI-027 |
| [ZWUI-E05](epics/ZWUI-E05.md) | Optional read-only workspace tools | Optional | ZWUI-028, ZWUI-029, ZWUI-030, ZWUI-031, ZWUI-032, ZWUI-033 |
| [ZWUI-E06](epics/ZWUI-E06.md) | Optional isolated static preview | Optional | ZWUI-034, ZWUI-035, ZWUI-036 |

## Tasks

| Planning ID / body | Title | Priority | Milestone | Scope | Depends on |
|---|---|---|---|---|---|
| [ZWUI-001](issues/ZWUI-001-capture-baseline-contracts-source-identity-and-regression-fixtures.md) | Capture baseline contracts, source identity and regression fixtures | P0 | M0 | Core | — |
| [ZWUI-002](issues/ZWUI-002-scaffold-vite-react-typescript-frontend-with-locked-dependencies.md) | Scaffold Vite React TypeScript frontend with locked dependencies | P1 | M0 | Core | ZWUI-001 |
| [ZWUI-003](issues/ZWUI-003-serve-modern-assets-in-node-and-docker-with-safe-rollback.md) | Serve modern assets in Node and Docker with safe rollback | P1 | M0 | Core | ZWUI-002, ZWUI-004 |
| [ZWUI-004](issues/ZWUI-004-define-typed-api-client-auth-bootstrap-and-capability-contract.md) | Define typed API client, auth bootstrap and capability contract | P0 | M0 | Core | ZWUI-001, ZWUI-002 |
| [ZWUI-005](issues/ZWUI-005-build-graphite-sage-design-tokens-and-accessible-ui-primitives.md) | Build graphite-sage design tokens and accessible UI primitives | P1 | M0 | Core | ZWUI-001, ZWUI-002 |
| [ZWUI-006](issues/ZWUI-006-implement-route-identity-and-strict-state-ownership.md) | Implement route identity and strict state ownership | P0 | M0 | Core | ZWUI-004 |
| [ZWUI-007](issues/ZWUI-007-add-immutable-job-status-and-idempotent-submission-contracts.md) | Add immutable job status and idempotent submission contracts | P0 | M0 | Core | ZWUI-001, ZWUI-004 |
| [ZWUI-008](issues/ZWUI-008-implement-bounded-resumable-sse-v2-and-explicit-ticket-expiry.md) | Implement bounded resumable SSE v2 and explicit ticket expiry | P0 | M0 | Core | ZWUI-007 |
| [ZWUI-009](issues/ZWUI-009-build-responsive-resizable-workspace-shell.md) | Build responsive resizable workspace shell | P1 | M1 | Core | ZWUI-005, ZWUI-006 |
| [ZWUI-010](issues/ZWUI-010-implement-project-picker-and-configured-root-creation-flow.md) | Implement project picker and configured-root creation flow | P1 | M1 | Core | ZWUI-004, ZWUI-009 |
| [ZWUI-011](issues/ZWUI-011-build-session-navigation-and-honestly-scoped-search.md) | Build session navigation and honestly scoped search | P1 | M1 | Core | ZWUI-006, ZWUI-010 |
| [ZWUI-012](issues/ZWUI-012-implement-isolated-drafts-and-versioned-local-preferences.md) | Implement isolated drafts and versioned local preferences | P1 | M1 | Core | ZWUI-006 |
| [ZWUI-013](issues/ZWUI-013-build-composer-with-real-model-modes-and-submission-states.md) | Build composer with real model modes and submission states | P1 | M1 | Core | ZWUI-007, ZWUI-009, ZWUI-012 |
| [ZWUI-014](issues/ZWUI-014-implement-upload-states-and-authenticated-media-previews.md) | Implement upload states and authenticated media previews | P0 | M1 | Core | ZWUI-004, ZWUI-013 |
| [ZWUI-015](issues/ZWUI-015-centralize-fail-closed-markdown-rendering-and-regression-tests.md) | Centralize fail-closed Markdown rendering and regression tests | P0 | M0 | Core | ZWUI-001, ZWUI-002, ZWUI-005 |
| [ZWUI-016](issues/ZWUI-016-implement-normalized-run-reducer-and-immutable-event-store.md) | Implement normalized run reducer and immutable event store | P0 | M1 | Core | ZWUI-006, ZWUI-007, ZWUI-008 |
| [ZWUI-017](issues/ZWUI-017-implement-ticketed-stream-controller-and-recovery-ux.md) | Implement ticketed stream controller and recovery UX | P0 | M1 | Core | ZWUI-008, ZWUI-016 |
| [ZWUI-018](issues/ZWUI-018-add-stable-logical-message-history-pagination-and-db-errors.md) | Add stable logical-message history pagination and DB errors | P1 | M1 | Core | ZWUI-001, ZWUI-004 |
| [ZWUI-019](issues/ZWUI-019-build-logical-transcript-with-stable-reading-position.md) | Build logical transcript with stable reading position | P1 | M1 | Core | ZWUI-011, ZWUI-015, ZWUI-016, ZWUI-018 |
| [ZWUI-020](issues/ZWUI-020-build-truthful-activity-and-artifact-inspector.md) | Build truthful activity and artifact inspector | P1 | M1 | Core | ZWUI-015, ZWUI-019 |
| [ZWUI-021](issues/ZWUI-021-add-command-palette-and-complete-keyboard-interactions.md) | Add command palette and complete keyboard interactions | P1 | M1 | Core | ZWUI-009, ZWUI-011 |
| [ZWUI-022](issues/ZWUI-022-build-settings-readiness-diagnostics-and-degraded-states.md) | Build settings readiness diagnostics and degraded states | P1 | M1 | Core | ZWUI-004, ZWUI-009, ZWUI-012 |
| [ZWUI-023](issues/ZWUI-023-add-backend-and-security-regression-ci-against-fake-cli.md) | Add backend and security regression CI against fake CLI | P0 | M2 | Core | ZWUI-003, ZWUI-007, ZWUI-008, ZWUI-014, ZWUI-015, ZWUI-018 |
| [ZWUI-024](issues/ZWUI-024-add-browser-integration-tests-for-navigation-streaming-and-recovery.md) | Add browser integration tests for navigation streaming and recovery | P0 | M2 | Core | ZWUI-010, ZWUI-013, ZWUI-017, ZWUI-019, ZWUI-020, ZWUI-022, ZWUI-023 |
| [ZWUI-025](issues/ZWUI-025-validate-responsive-visuals-and-accessibility-across-workspace-states.md) | Validate responsive visuals and accessibility across workspace states | P1 | M2 | Core | ZWUI-009, ZWUI-019, ZWUI-020, ZWUI-021, ZWUI-022 |
| [ZWUI-026](issues/ZWUI-026-measure-frontend-performance-and-bound-client-resource-retention.md) | Measure frontend performance and bound client resource retention | P1 | M2 | Core | ZWUI-017, ZWUI-019, ZWUI-020, ZWUI-024 |
| [ZWUI-027](issues/ZWUI-027-complete-release-gate-rollout-documentation-and-rollback-rehearsal.md) | Complete release gate rollout documentation and rollback rehearsal | P0 | M2 | Core | ZWUI-023, ZWUI-024, ZWUI-025, ZWUI-026 |
| [ZWUI-028](issues/ZWUI-028-add-explicitly-device-local-pin-hide-and-display-aliases.md) | Add explicitly device-local pin hide and display aliases | P2 | M3 | Optional | ZWUI-011, ZWUI-012, ZWUI-027 |
| [ZWUI-029](issues/ZWUI-029-add-bounded-authorized-server-wide-session-search.md) | Add bounded authorized server-wide session search | P2 | M3 | Optional | ZWUI-018, ZWUI-021, ZWUI-027 |
| [ZWUI-030](issues/ZWUI-030-add-capability-gated-read-only-project-file-api.md) | Add capability-gated read-only project file API | P1 | M3 | Optional | ZWUI-004, ZWUI-027 |
| [ZWUI-031](issues/ZWUI-031-build-lazy-read-only-code-inspector.md) | Build lazy read-only Code inspector | P2 | M3 | Optional | ZWUI-020, ZWUI-030 |
| [ZWUI-032](issues/ZWUI-032-add-real-read-only-git-status-and-diff-contracts.md) | Add real read-only Git status and diff contracts | P1 | M3 | Optional | ZWUI-030 |
| [ZWUI-033](issues/ZWUI-033-build-real-changes-inspector-with-clear-diff-scope.md) | Build real Changes inspector with clear diff scope | P2 | M3 | Optional | ZWUI-020, ZWUI-032 |
| [ZWUI-034](issues/ZWUI-034-approve-static-preview-threat-model-and-capability-contract.md) | Approve static preview threat model and capability contract | P1 | M3 | Optional | ZWUI-027, ZWUI-030 |
| [ZWUI-035](issues/ZWUI-035-implement-isolated-static-snapshot-preview-service.md) | Implement isolated static snapshot preview service | P1 | M3 | Optional | ZWUI-034 |
| [ZWUI-036](issues/ZWUI-036-build-capability-gated-preview-ux-and-lifecycle-states.md) | Build capability-gated Preview UX and lifecycle states | P2 | M3 | Optional | ZWUI-031, ZWUI-035, ZWUI-025 |

## Valid implementation order

The following is one valid topological order, not a demand to serialize independent work:

`001 → 002 → 005 → 015 → 004 → 006 → 007 → 008 → 018 → 003 → 009 → 010 → 011 → 012 → 013 → 014 → 016 → 017 → 019 → 020 → 021 → 022 → 023 → 024 → 025 → 026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 035 → 036`

Prefix each number with `ZWUI-`. For filing, epic issues can be created first and task issues can be registered in this order so actual dependency numbers are available. Registration is not authorization to implement optional scope.

### Parallel work after the early foundations

After baseline ZWUI-001 and scaffold ZWUI-002, tokens ZWUI-005 and API/auth contract ZWUI-004 can proceed independently. Bring renderer ZWUI-015 forward after tokens. Route/context ZWUI-006, job contracts ZWUI-007 and history ZWUI-018 have separate review surfaces after their dependencies are met. UI work can use explicit fixtures before integration, but fixture success cannot satisfy live-adapter acceptance.

Core release ZWUI-027 depends on all four final verification tracks. Its dependency closure includes every core task; no core body is left outside the release gate. Optional work begins only after core acceptance. Preview needs the safe file foundation and its own design approval; it does not depend on shipping local pinning, global search or the Changes pane.

## Registration and maintenance

Use [the filing guide](11-GITHUB-FILING-GUIDE.md). Preserve the hidden `zcode-ui-plan` marker in each body for deduplication. Record real issue URLs after filing, update dependency references, and attach real tested candidate identities when closing issues.

Track implementation evidence separately from this proposal. If an upstream CLI version invalidates an assumption, amend the relevant contract and tests instead of marking the issue complete against a stale fixture.
