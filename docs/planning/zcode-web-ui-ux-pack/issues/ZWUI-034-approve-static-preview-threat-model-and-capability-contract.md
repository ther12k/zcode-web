<!-- zcode-ui-plan:ZWUI-034 -->
# [ZWUI-034] Approve static preview threat model and capability contract

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M3 |
| Epic | ZWUI-E06 |
| Suggested owner | Security + Backend + Product |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-23, FR-24 |
| Depends on | ZWUI-027, ZWUI-030 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:optional |

## Goal and context

Decide the trust boundary before any untrusted generated application content is embedded in the coding workspace.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define the initial supported static snapshot format and explicit exclusions: no package install, backend server, arbitrary URL proxy or generic runtime.
- [ ] Design separate untrusted-content origin, sandbox permissions, snapshot selection, credential absence and CSP/resource rules.
- [ ] Define any necessary cross-frame messages with source/origin/schema/session validation; opaque origin strings alone must not grant trust.
- [ ] Analyze private-file inclusion, external resource requests, child navigation, downloads/popups, infinite loops and browser resource exhaustion.
- [ ] Record residual network/CPU/memory risks without claiming an iframe alone gives hermetic containment.
- [ ] Produce an approved API/lifecycle/retention design, rejection cases and test matrix; keep the capability false until accepted.

## Acceptance criteria

- [ ] Product, backend and security reviewers explicitly approve the limited supported format and residual risks.
- [ ] No preview receives bearer/provider secrets, trusted application storage or privileged filesystem/command access.
- [ ] The design includes unsupported-project and expired-snapshot behavior plus a usable disable/kill/dispose path.
- [ ] Implementation cannot begin by inserting arbitrary HTML into the main-origin DOM or weakening chat sanitization.

## Required verification

- [ ] **T31 — Filesystem boundaries:** Traversal/encoding, symlink policy, sensitive files, binary/large input, concurrent path changes and no mutation.
- [ ] **T34 — Preview security boundary:** Separate origin, sandbox, missing credentials, rejected bridge messages, blocked private files, navigation/resource abuse and residual risk record.
- [ ] **T35 — Preview product behavior:** Unsupported project, snapshot load/error/expiry, viewport buttons, refresh/dispose, correct identity and no invented hostname or deployment.

## Out of scope

This is a decision gate, not permission to launch a generic browser IDE runtime, public preview hosting or dev-server proxy.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
