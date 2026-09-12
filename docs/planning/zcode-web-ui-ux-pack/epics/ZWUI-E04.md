<!-- zcode-ui-plan:ZWUI-E04 -->
# [ZWUI-E04] Quality release and rollback

**Status:** Proposed. **Type:** Epic. **Scope:** Required core launch.

## Outcome

Prove the core release against deterministic fixtures, real browser behavior and the actual production packaging boundary.

## Child tasks

- [ ] **ZWUI-023** — Add backend and security regression CI against fake CLI
- [ ] **ZWUI-024** — Add browser integration tests for navigation streaming and recovery
- [ ] **ZWUI-025** — Validate responsive visuals and accessibility across workspace states
- [ ] **ZWUI-026** — Measure frontend performance and bound client resource retention
- [ ] **ZWUI-027** — Complete release gate rollout documentation and rollback rehearsal

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

The required candidate passes contract/security/browser/visual/accessibility/performance gates, with explicit support limits and a rehearsed safe rollback.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
