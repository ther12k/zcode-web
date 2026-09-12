<!-- zcode-ui-plan:ZWUI-022 -->
# [ZWUI-022] Build settings readiness diagnostics and degraded states

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-12, FR-14, FR-17, FR-24 |
| Depends on | ZWUI-004, ZWUI-009, ZWUI-012 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Give maintainers and users clear control over local preferences and access, with failures that explain what is actually unavailable.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement Appearance, Interaction, Connection/Access and About/Diagnostics sections using real server capability/readiness data.
- [ ] Add system/dark/light themes, layout reset, send-shortcut preference, draft persistence choice and clear-local-data controls.
- [ ] Handle token entry/forget and the optional remember-device policy; close streams and clear sensitive client state on auth changes.
- [ ] Distinguish CLI absent, provider configured/unverified, workspace unavailable, capacity reached, disconnected and unsupported-server states.
- [ ] Provide safe build/API/CLI diagnostics and actionable setup links; redact keys, prompts, contents, full paths and SSE URLs from default export.
- [ ] Ensure invalid configuration, API timeout and unknown capability version do not become endless spinners or false Connected badges.

## Acceptance criteria

- [ ] Users can recover from wrong/expired credentials without reloading a stale transcript from another auth context.
- [ ] Theme/preferences work when persistent storage is unavailable, and local data controls match their description.
- [ ] Provider configuration is not labeled as successful model verification without a relevant probe.
- [ ] Diagnostics and UI routes contain no credentials or private message content by default.

## Required verification

- [ ] **T01 — Access and credential lifecycle:** Protected API challenge, invalid/valid bearer, forget, late response after logout; no previous cache or object URL survives.
- [ ] **T22 — Real model/mode controls:** Configuration-driven values, empty/changed model list, rejected selection and high-risk-mode labels; no fabricated Ask permission.
- [ ] **T23 — Draft correctness:** Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.

## Out of scope

No provider-key editor, account management, tenant roles, automatic telemetry export or public diagnostic endpoint.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
