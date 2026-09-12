<!-- zcode-ui-plan:ZWUI-013 -->
# [ZWUI-013] Build composer with real model modes and submission states

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-04, FR-05, FR-13 |
| Depends on | ZWUI-007, ZWUI-009, ZWUI-012 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Provide a predictable send/stop interaction that preserves attachment-only behavior and never silently changes execution choices.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement controlled multiline input with Enter/Shift+Enter, composition-event protection and optional Ctrl/Cmd+Enter preference.
- [ ] Populate model/mode menus and limits from validated server configuration, maintaining configured safe defaults and visible risk labels.
- [ ] Model draft/uploading/ready/submitting/running/stopping/error states; enable attachment-only send and block unresolved uploads.
- [ ] Create one request ID per intended send, reconcile an ambiguous acceptance response and do not auto-retry a run mutation.
- [ ] Keep accepted run context immutable and protect new draft edits while acceptance is pending; present context-specific failures.
- [ ] Expose a stop request through the owning run controller and show stopping until authoritative terminal evidence arrives.

## Acceptance criteria

- [ ] Attachment-only and ordinary text messages can submit once; empty input with no attachments cannot.
- [ ] IME input never sends accidentally and Shift+Tab remains reverse focus navigation.
- [ ] Modes/models use real configured values; unsupported changes produce a visible error rather than silent fallback.
- [ ] Cancel acknowledgement does not falsely claim the process has already stopped.

## Required verification

- [ ] **T05 — Attachment-only submission:** No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works.
- [ ] **T09 — Submission idempotency:** Double activation and lost response create one job; differing payload same key conflicts; restart does not auto-resubmit.
- [ ] **T12 — Terminal semantics and cleanup:** Exit zero/nonzero, agent failure with exit zero, signals, cancel/timeout/close races; one terminal result; supported child-process cleanup tested.
- [ ] **T22 — Real model/mode controls:** Configuration-driven values, empty/changed model list, rejected selection and high-risk-mode labels; no fabricated Ask permission.
- [ ] **T23 — Draft correctness:** Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change.
- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.

## Out of scope

No hardcoded reference model list, invented Ask permission, prompt queue auto-execution or direct provider calls.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
