<!-- zcode-ui-plan:ZWUI-E02 -->
# [ZWUI-E02] Workspace navigation and interaction

**Status:** Proposed. **Type:** Epic. **Scope:** Required core launch.

## Outcome

Deliver the reference-inspired shell, project/session navigation, drafts, composer, media and settings without altering the CLI operating model.

## Child tasks

- [ ] **ZWUI-009** — Build responsive resizable workspace shell
- [ ] **ZWUI-010** — Implement project picker and configured-root creation flow
- [ ] **ZWUI-011** — Build session navigation and honestly scoped search
- [ ] **ZWUI-012** — Implement isolated drafts and versioned local preferences
- [ ] **ZWUI-013** — Build composer with real model modes and submission states
- [ ] **ZWUI-014** — Implement upload states and authenticated media previews
- [ ] **ZWUI-021** — Add command palette and complete keyboard interactions
- [ ] **ZWUI-022** — Build settings readiness diagnostics and degraded states

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

Core desktop/mobile/keyboard flows operate on real authorized APIs; no reference-only task database, model list or attachment regression enters production.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
