<!-- zcode-ui-plan:ZWUI-004 -->
# [ZWUI-004] Define typed API client, auth bootstrap and capability contract

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Frontend + Backend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-02, FR-13, FR-14, FR-24 |
| Depends on | ZWUI-001, ZWUI-002 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Give the new UI one validated integration boundary and a truthful way to discover supported features rather than assuming the reference backend exists.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define baseline adapters and version-2 capability/error contracts, retaining legacy fields and explicit protocol negotiation.
- [ ] Add stable non-secret instance/project identifiers and a server epoch; document directory-rename semantics and canonical mapping.
- [ ] Implement a same-origin API client with typed runtime validation, AbortSignal support, safe error codes and no credential attachment to arbitrary URLs.
- [ ] Handle config/health 401 as an access challenge; memory-only bearer by default with deliberate opt-in persistence and forget cleanup.
- [ ] Scope Query keys by instance/credential generation/project/session, configure retries/refetching deliberately, and clear sensitive data on credential changes.
- [ ] Expose supported models, modes and limits without provider keys; absent/unknown capability flags evaluate false.

## Acceptance criteria

- [ ] An unauthenticated user reaches a usable access screen without needing an unauthenticated config response.
- [ ] Wrong-shaped data yields a bounded compatibility error, not a crash or guessed default capability.
- [ ] Credential changes abort requests, close subscriptions through their owners and prevent late old-context results from repainting the UI.
- [ ] No model key, bearer, prompt or full authenticated media URL is serialized into route/search state or diagnostics.

## Required verification

- [ ] **T01 — Access and credential lifecycle:** Protected API challenge, invalid/valid bearer, forget, late response after logout; no previous cache or object URL survives.
- [ ] **T02 — Projects and directory identity:** Configured roots, duplicate names, invalid creation, missing root, canonical project/session mismatch rejected.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T22 — Real model/mode controls:** Configuration-driven values, empty/changed model list, rejected selection and high-risk-mode labels; no fabricated Ask permission.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.

## Out of scope

No new account/tenant model, OAuth flow, cookie-auth migration or frontend calls directly to a model provider.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
