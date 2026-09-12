<!-- zcode-ui-plan:ZWUI-015 -->
# [ZWUI-015] Centralize fail-closed Markdown rendering and regression tests

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M0 |
| Epic | ZWUI-E03 |
| Suggested owner | Frontend + Security |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-06, FR-17 |
| Depends on | ZWUI-001, ZWUI-002, ZWUI-005 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Preserve the sanitizer fix while removing the source-observed missing-dependency raw-HTML fallback in both the new UI and any retained rollback client.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Create one owned Markdown rendering boundary with local imports of Marked/DOMPurify and an explicit HTML-only application policy.
- [ ] On missing/unsupported sanitizer, parse failure or module load failure, show safe plain text or a safe renderer error—not unsanitized HTML.
- [ ] Apply the same component to live messages, stored history, tool text and future read-only Markdown views.
- [ ] Restrict executable/custom links and embedded active content; handle code fences as text and remote images according to the privacy policy.
- [ ] Keep sanitized HTML out of later uncontrolled transforms; add an auditable rule or test for unapproved raw HTML insertion points.
- [ ] Patch the retained legacy renderer to fail closed too, and add browser regression fixtures for normal and missing-sanitizer paths.

## Acceptance criteria

- [ ] Harmless formatting still renders while event handlers/executable URLs do not execute in live or historical content.
- [ ] Deliberately blocked sanitizer loading cannot produce raw HTML execution; fallback content is visible and safe.
- [ ] The modern bundle needs no remote CDN script; the rollback UI does not retain the unsafe fallback.
- [ ] Security tests run in a real browser and record the actual candidate/build identity.

## Required verification

- [ ] **T04 — Safe Markdown failure paths:** Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback.
- [ ] **T07 — Protected media lifecycle:** Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer.
- [ ] **T08 — Unresolved artifact behavior:** Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No claim that React alone sanitizes raw HTML, no sanitizer bypass convenience flag and no general rich-HTML editor.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
