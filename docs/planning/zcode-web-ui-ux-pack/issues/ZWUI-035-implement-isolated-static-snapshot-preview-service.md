<!-- zcode-ui-plan:ZWUI-035 -->
# [ZWUI-035] Implement isolated static snapshot preview service

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M3 |
| Epic | ZWUI-E06 |
| Suggested owner | Backend + Security + QA |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-23, FR-17 |
| Depends on | ZWUI-034 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:optional |

## Goal and context

Implement only the approved static preview contract, with isolation and resource/lifecycle behavior demonstrated by tests.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build immutable snapshot creation from explicitly approved public project files with file/count/size/type limits and identity/digest.
- [ ] Deliver snapshots through the approved untrusted-content origin and sandbox/CSP arrangement, never through privileged app-origin HTML.
- [ ] Keep credentials and private files out; implement any bridge using the reviewed source/nonce/schema validation.
- [ ] Add expiry/retention/disposal controls, bounded diagnostics and a feature disable path; do not introduce a generic server-side URL fetch.
- [ ] Test private-file rejection, storage/parent access, external resources/navigation, message spoofing and runaway-content behavior according to the accepted risk model.
- [ ] Advertise the capability only for approved formats and environments, retaining explicit unsupported states elsewhere.

## Acceptance criteria

- [ ] An approved simple static fixture renders without receiving the app bearer or trusted storage access.
- [ ] Host/private path and bridge-abuse fixtures are rejected; untrusted content cannot invoke privileged project actions.
- [ ] Expiry, removal and disable behavior release resources and do not claim deployment or indefinite availability.
- [ ] Security evidence records residual risks and supported environments rather than claiming universal network/CPU containment.

## Required verification

- [ ] **T34 — Preview security boundary:** Separate origin, sandbox, missing credentials, rejected bridge messages, blocked private files, navigation/resource abuse and residual risk record.
- [ ] **T35 — Preview product behavior:** Unsupported project, snapshot load/error/expiry, viewport buttons, refresh/dispose, correct identity and no invented hostname or deployment.

## Out of scope

No arbitrary Node/npm/dev-server execution, server-side preview URL proxy, multi-tenant public hosting or artifact-resolver guessing.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
