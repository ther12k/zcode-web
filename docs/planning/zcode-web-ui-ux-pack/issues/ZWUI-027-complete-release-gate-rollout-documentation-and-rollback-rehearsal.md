<!-- zcode-ui-plan:ZWUI-027 -->
# [ZWUI-027] Complete release gate rollout documentation and rollback rehearsal

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M2 |
| Epic | ZWUI-E04 |
| Suggested owner | Maintainer + QA + DevOps |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-17, FR-18, FR-24 |
| Depends on | ZWUI-023, ZWUI-024, ZWUI-025, ZWUI-026 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Promote the modern workspace only when one identified candidate has the required functional, security, accessibility and operational evidence.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Collect accepted task status and the required T01–T28/T36 results, including explicit environmental skips and remaining support limits.
- [ ] Build a clean locked production image, record source/frontend/image digests and run authenticated container health/deep-link/media smoke tests.
- [ ] Perform a maintainer-authorized non-sensitive CLI/provider smoke when access exists, recording actual CLI version rather than assuming fixture success equals live success.
- [ ] Rehearse modern-to-previous-safe-UI/image rollback without changing CLI session data or project files.
- [ ] Update README/dev/build/config/capability/support documentation and distinguish dependency-free Node runtime from frontend tooling dependencies.
- [ ] Write release notes covering artifact-byte limitation, local-only preferences, private access model and disabled optional capabilities.

## Acceptance criteria

- [ ] Every required task is accepted and tied to the same candidate or explicitly compatible evidence; no known stop condition remains unresolved.
- [ ] Production serves built static assets through Node and token-protected health/stream/media work together.
- [ ] Rollback restores a known safe interface without downgrading/overwriting the live CLI database.
- [ ] No Code/Changes/Preview/terminal/share claim appears unless its actual capability and evidence are accepted.

## Required verification

- [ ] **T01 — Access and credential lifecycle:** Protected API challenge, invalid/valid bearer, forget, late response after logout; no previous cache or object URL survives.
- [ ] **T03 — Routing and static assets:** Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries.
- [ ] **T04 — Safe Markdown failure paths:** Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback.
- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T07 — Protected media lifecycle:** Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer.
- [ ] **T14 — Ticket security and lifecycle:** Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode.
- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.
- [ ] **T26 — Performance and resources:** Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment.
- [ ] **T27 — Packaging and rollback:** Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No automatic production deployment by this issue body and no publishing of private test artifacts. Optional M3 work is not a core launch blocker.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
