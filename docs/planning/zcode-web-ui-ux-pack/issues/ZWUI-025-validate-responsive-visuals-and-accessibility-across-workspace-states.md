<!-- zcode-ui-plan:ZWUI-025 -->
# [ZWUI-025] Validate responsive visuals and accessibility across workspace states

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M2 |
| Epic | ZWUI-E04 |
| Suggested owner | Design + QA + Accessibility |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-01, FR-15 |
| Depends on | ZWUI-009, ZWUI-019, ZWUI-020, ZWUI-021, ZWUI-022 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Ensure the redesign actually improves readability and navigation rather than simply resembling a dense desktop screenshot.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Capture the required dark/light screen-state matrix at desktop, tablet and narrow mobile widths from the built candidate.
- [ ] Compare hierarchy, pane behavior, typography and accent use to an approved reference render; record source-derived decisions when no render exists.
- [ ] Run automated contrast/ARIA checks and manual keyboard, focus, dialog/menu/tab/splitter, zoom/reflow and reduced-motion scenarios.
- [ ] Test touch hit areas, long titles/paths, code/tables, mobile keyboard and safe-area behavior; distinguish emulation from real device checks.
- [ ] Run a small formative usability walkthrough with at least three intended users and record blocking misunderstandings.
- [ ] Fix defects or document explicit owner/rationale/expiry for allowable exceptions; never hide manual blockers behind a green automated scan.

## Acceptance criteria

- [ ] Core actions remain reachable at 360 px and in the 320-CSS-pixel reflow scenario, with no unintended page-wide horizontal overflow.
- [ ] Text/focus contrast and hit areas meet the agreed design/accessibility targets across states, not just the default theme.
- [ ] Keyboard and assistive-technology flows can complete primary journeys without losing focus or receiving per-token announcements.
- [ ] Visual approvals and actual device/engine coverage are recorded without an unsupported pixel-perfect claim.

## Required verification

- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.

## Out of scope

No decorative image-generation task, automated-only accessibility certificate or blanket screenshot approval without review.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
