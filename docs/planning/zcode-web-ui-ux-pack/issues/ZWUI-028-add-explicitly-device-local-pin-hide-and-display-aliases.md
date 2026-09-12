<!-- zcode-ui-plan:ZWUI-028 -->
# [ZWUI-028] Add explicitly device-local pin hide and display aliases

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P2 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-19, FR-12 |
| Depends on | ZWUI-011, ZWUI-012, ZWUI-027 |
| Suggested labels | ui-ux, type:task, priority:P2, scope:optional |

## Goal and context

Offer useful organization inspired by the reference without mutating the CLI/desktop session database or pretending changes synchronize.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add project/session pinning, local hide/unhide and display aliases using versioned instance/project/session keys.
- [ ] Label operations as local to this device; distinguish hidden sessions from archived/deleted CLI sessions.
- [ ] Provide a hidden-items view, reset controls and clear behavior for sessions removed/renamed by the desktop.
- [ ] Merge local display preferences over authoritative session metadata without replacing actual session IDs or directories.
- [ ] Document persistence/eviction and avoid storing message content in organization metadata.
- [ ] Add tests that compare the synthetic CLI database before/after all organization actions.

## Acceptance criteria

- [ ] Pin/hide/alias changes survive the configured local persistence policy and can be reset without affecting actual session history.
- [ ] The UI does not call a nonexistent archive/rename API or claim desktop synchronization.
- [ ] Running sessions stay discoverable and a hidden active run is still represented in the global activity indicator.
- [ ] No CLI database or project file changes occur from these controls.

## Required verification

- [ ] **T23 — Draft correctness:** Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change.
- [ ] **T29 — Browser-local organization:** Pin/hide/alias survives opt-in device persistence, clear/reset works and desktop database remains unchanged.

## Out of scope

No server-side archive/delete/title writes, shared team preferences or cross-device synchronization.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
