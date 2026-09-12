<!-- zcode-ui-plan:ZWUI-014 -->
# [ZWUI-014] Implement upload states and authenticated media previews

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P0 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend + Backend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-05, FR-06, FR-17 |
| Depends on | ZWUI-004, ZWUI-013 |
| Suggested labels | ui-ux, type:task, priority:P0, scope:core |

## Goal and context

Keep file context useful and secure in the new composer without regressing the existing upload fixes.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Add file picker, paste and drag/drop with preflight count/size checks before large memory reads and per-file pending/success/error/removal states.
- [ ] Use the existing upload contract through a validated adapter; test encoded-size overhead and version-2 excess-count rejection.
- [ ] Keep server-side payload/reference checks authoritative and ensure names can round-trip to the authenticated media endpoint.
- [ ] Fetch approved raster media through the same-origin authorized client and own/revoke object URLs by consumer lifetime.
- [ ] Render active/unknown formats as safe metadata, text or download states instead of unrestricted trusted-origin documents.
- [ ] Handle failed uploads, request overflow, auth expiry and late blob results without losing the draft or leaking credential context.

## Acceptance criteria

- [ ] Protected-mode image preview works without a bearer query parameter; wrong-origin requests never receive the bearer.
- [ ] Invalid base64, oversized body and excess file count produce visible errors; a delivered 413 is verified over HTTP.
- [ ] All object URLs and aborted operations are cleaned up on removal, navigation ownership release and credential reset.
- [ ] Attachment-only send retains its established default-prompt behavior through the integrated composer.

## Required verification

- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T06 — Upload validation and limits:** Invalid base64, over-size request, delivered 413, count limit, unsafe filename round-trip, failed upload retained for retry.
- [ ] **T07 — Protected media lifecycle:** Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer.
- [ ] **T08 — Unresolved artifact behavior:** Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely.

## Out of scope

No generic remote-image proxy, HTML/SVG execution surface, background upload queue or undocumented server-byte deletion.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
