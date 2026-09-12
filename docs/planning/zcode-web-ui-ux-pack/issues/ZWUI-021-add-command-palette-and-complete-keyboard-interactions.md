<!-- zcode-ui-plan:ZWUI-021 -->
# [ZWUI-021] Add command palette and complete keyboard interactions

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend + Accessibility |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-11, FR-15 |
| Depends on | ZWUI-009, ZWUI-011 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Make the workspace efficient from the keyboard without copying shortcuts that conflict with basic navigation.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build a command palette for supported navigation, new conversation, search, pane visibility, theme and help actions.
- [ ] Define and display tested platform-aware shortcuts; avoid browser new-window hijacking and preserve Shift+Tab inside the composer.
- [ ] Implement appropriate menu/tab/dialog keyboard behavior, focus trap/restore, Escape ordering and editable-target exclusions.
- [ ] Ensure splitter controls and inspector toggles are keyboard reachable and status announcements do not read every streamed token.
- [ ] Add accessible result labels and no-match/loading/error states with honest search scope.
- [ ] Create a keyboard walkthrough and assistive-technology test notes for all primary journeys.

## Acceptance criteria

- [ ] A user can select a project/session, compose, attach, send, inspect, stop and close overlays without a pointer.
- [ ] IME, reverse Tab and browser-standard actions remain usable; advertised shortcuts match actual behavior.
- [ ] Closing the topmost overlay restores focus predictably and does not activate hidden background controls.
- [ ] Screen-reader announcements describe meaningful status transitions without flooding the user with deltas.

## Required verification

- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.

## Out of scope

No arbitrary command execution palette, terminal input or unimplemented shortcut labels copied from the reference.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
