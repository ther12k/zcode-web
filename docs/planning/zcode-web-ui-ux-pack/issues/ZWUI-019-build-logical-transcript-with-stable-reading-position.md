<!-- zcode-ui-plan:ZWUI-019 -->
# [ZWUI-019] Build logical transcript with stable reading position

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E03 |
| Suggested owner | Frontend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-06, FR-09, FR-15, FR-16 |
| Depends on | ZWUI-011, ZWUI-015, ZWUI-016, ZWUI-018 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Render live and historical conversation as complete logical messages while preserving the user’s reading position during updates.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement typed message/part components keyed by durable identity, keeping text and all tool/file cards within their logical message.
- [ ] Load the newest history page and prepend older pages using the v2 cursor; preserve the first visible message and pixel offset.
- [ ] Reconcile live output with persisted messages by identity so a completed answer is not displayed twice; show persistence-lag state when needed.
- [ ] Implement near-bottom follow behavior, paused follow when reading older output, and a New output control; avoid smooth scrolling per token.
- [ ] Handle dynamic image/card heights, pane resizing, tables, code blocks, selection and unsupported parts without destabilizing scroll.
- [ ] Profile the large fixture before adding virtualization; provide a usable paged/nonvirtualized accessibility path when needed.

## Acceptance criteria

- [ ] Whole-message history remains correct beyond the old part cap, with no detached or missing tool/file cards.
- [ ] Prepending, expanding a tool, loading an image or receiving a delta while scrolled up preserves reading position.
- [ ] Persisted and live versions of the same message reconcile once rather than duplicate.
- [ ] Keyboard, screen-reader and text-selection flows remain usable under the documented large-history profile.

## Required verification

- [ ] **T04 — Safe Markdown failure paths:** Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback.
- [ ] **T18 — Complete logical-message history:** At least 1,000 messages and over 2,000 parts, multi-tool/file turns, final message beyond old cap, no split/lost parts.
- [ ] **T19 — Cursor stability under writes:** Desktop app appends during older-page loads; stable IDs, consistent upper bound, no duplicate/omitted page due to shifting offset.
- [ ] **T21 — Transcript reading position:** Prepend, expand tool, late image, resize pane and live delta while scrolled up; preserve anchor; New output resumes follow.
- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T26 — Performance and resources:** Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment.

## Out of scope

No default eager load of the entire database, unstable array-index message keys or unconditional per-delta scroll-to-bottom.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
