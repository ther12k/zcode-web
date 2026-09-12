<!-- zcode-ui-plan:ZWUI-036 -->
# [ZWUI-036] Build capability-gated Preview UX and lifecycle states

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P2 |
| Milestone | M3 |
| Epic | ZWUI-E06 |
| Suggested owner | Frontend + QA |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-23, FR-01, FR-24 |
| Depends on | ZWUI-031, ZWUI-035, ZWUI-025 |
| Suggested labels | ui-ux, type:task, priority:P2, scope:optional |

## Goal and context

Add the reference-inspired preview controls only after a real isolated preview capability exists.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build a lazy Preview tab showing actual snapshot identity, supported format and explicit loading/ready/error/expired/unsupported states.
- [ ] Implement desktop/mobile viewport sizing, refresh, expand/collapse and return-to-conversation controls without implying real device testing.
- [ ] Use only the approved iframe/origin/bridge contract; no direct untrusted srcdoc insertion in the trusted application context.
- [ ] Guard snapshot responses by project/session/generation and dispose frames/object resources on close, credential change or new snapshot.
- [ ] Show truthful address/status copy; omit fake .local hostnames, publish/share actions and generic “preview is running” when unavailable.
- [ ] Run narrow-screen/keyboard tests and verify the heavy preview path is not eagerly loaded by ordinary chat.

## Acceptance criteria

- [ ] A supported static snapshot opens in the approved boundary and clearly identifies what is being viewed.
- [ ] Unsupported projects remain unsupported with useful guidance rather than a substituted demo application.
- [ ] Refresh/navigation/expiry cannot show a stale project preview or leak privileged context.
- [ ] Viewport controls are labeled as sizing, not real-device validation or public deployment.

## Required verification

- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.
- [ ] **T26 — Performance and resources:** Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment.
- [ ] **T34 — Preview security boundary:** Separate origin, sandbox, missing credentials, rejected bridge messages, blocked private files, navigation/resource abuse and residual risk record.
- [ ] **T35 — Preview product behavior:** Unsupported project, snapshot load/error/expiry, viewport buttons, refresh/dispose, correct identity and no invented hostname or deployment.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No OS terminal, deployment pricing, public sharing, generic app build system or claim that all CLI projects run without a server.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
