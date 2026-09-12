<!-- zcode-ui-plan:ZWUI-010 -->
# [ZWUI-010] Implement project picker and configured-root creation flow

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend + Backend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-02, FR-24 |
| Depends on | ZWUI-004, ZWUI-009 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Let users clearly select or create server-side projects without confusing them with local browser folders.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build configured-root/project navigation with duplicate-name qualifiers, readable path detail and contextual load/error states.
- [ ] Implement project creation dialog using server validation, explicit target root and actionable invalid/conflict/denied messages.
- [ ] Use server-issued project identity for routing/cache keys; keep canonical-directory authorization on the backend.
- [ ] Prevent a stale project request from retargeting the selected session or an active job; refresh only relevant query keys after creation.
- [ ] Explain that projects reside on the server and that root configuration is a maintainer setting.
- [ ] Cover empty root, unavailable root, long name/path and root removal during a session.

## Acceptance criteria

- [ ] Creating a valid project selects that exact returned project; duplicate/invalid requests preserve form input and show the server error.
- [ ] Two projects with the same name in different roots remain distinguishable and cannot share session cache keys.
- [ ] No client input causes browsing outside the configured server boundary.
- [ ] Root failures are not knowingly presented as an empty successful listing in the new contract.

## Required verification

- [ ] **T02 — Projects and directory identity:** Configured roots, duplicate names, invalid creation, missing root, canonical project/session mismatch rejected.
- [ ] **T10 — Server resume boundary:** Session from project A with project B request rejects before CLI start; malformed or unknown context is not silently normalized.
- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.

## Out of scope

No unrestricted host file picker, root configuration editor or direct browser filesystem synchronization.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
