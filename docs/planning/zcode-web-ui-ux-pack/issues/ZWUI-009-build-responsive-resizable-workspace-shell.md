<!-- zcode-ui-plan:ZWUI-009 -->
# [ZWUI-009] Build responsive resizable workspace shell

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E02 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-01, FR-15 |
| Depends on | ZWUI-005, ZWUI-006 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Implement the reference-inspired navigation/conversation/inspector hierarchy without sacrificing the conversation on smaller screens.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Compose header, navigation, conversation, optional inspector and compact status regions using minmax layouts and independent scroll containers.
- [ ] Implement collapse/expand and keyboard/pointer resize controls with clamped versioned preferences and Reset layout.
- [ ] Apply the desktop/medium/mobile behaviors from the UX spec; use drawers and single-pane mode when minimum widths cannot fit.
- [ ] Add route-aware titles, long-path/title truncation with accessible full context and a global active-run affordance.
- [ ] Handle safe areas, dynamic viewport height, reduced motion and mobile keyboard pressure without hiding the send/stop control.
- [ ] Provide shell loading/empty/denied/error states and avoid allocating half the screen to an empty unsupported pane.

## Acceptance criteria

- [ ] At all required viewport/zoom profiles, navigation, composition and inspector-return actions are reachable with no page-wide horizontal overflow.
- [ ] Pane resizing is operable by keyboard and pointer with a named separator and current/min/max values.
- [ ] Bad/outdated stored dimensions reset or clamp safely rather than breaking the layout.
- [ ] The global run indicator remains visible even when another session is selected.

## Required verification

- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.

## Out of scope

No Code/Changes/Preview backend implementation or pixel-perfect claim without an approved render.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
