<!-- zcode-ui-plan:ZWUI-005 -->
# [ZWUI-005] Build graphite-sage design tokens and accessible UI primitives

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M0 |
| Epic | ZWUI-E01 |
| Suggested owner | Design + Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-01, FR-15 |
| Depends on | ZWUI-001, ZWUI-002 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Preserve the reference visual direction while replacing its dense overrides and small controls with a coherent, accessible component system.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define dark/light/system theme tokens for surfaces, text, accent, borders, focus, spacing, radii and status colors; start from the audited reference palette.
- [ ] Specify readable conversation/UI/metadata type scales and touch hit areas rather than copying the smallest reference text.
- [ ] Implement owned Button, IconButton, Badge, Tooltip, Dialog, Menu, Tabs, EmptyState, ErrorState, Skeleton and Spinner primitives using a consistent accessible base.
- [ ] Provide focus-visible, keyboard, disabled, destructive, loading and reduced-motion states; do not rely on color alone.
- [ ] Create a development-only component gallery or equivalent review page covering every state in both themes.
- [ ] Capture an approved reference render when available and record visual decisions without claiming source inspection is pixel-perfect evidence.

## Acceptance criteria

- [ ] Tokens are the single source of truth; component styles do not require copying the reference stylesheet wholesale.
- [ ] All necessary text and controls remain readable/reachable at narrow widths and zoom; contrast is measured for real state combinations.
- [ ] Dialog/menu/tab primitives pass keyboard and focus tests, not only static ARIA checks.
- [ ] No font/CDN network dependency is silently required for the shell to render.

## Required verification

- [ ] **T24 — Keyboard and assistive technology:** Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion.
- [ ] **T25 — Visual and responsive matrix:** Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No custom visual editor, animation framework, full icon catalog or global typography copied without contrast/size review.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
