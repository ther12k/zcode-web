<!-- zcode-ui-plan:ZWUI-E03 -->
# [ZWUI-E03] Conversation streaming and evidence

**Status:** Proposed. **Type:** Epic. **Scope:** Required core launch.

## Outcome

Keep live and stored content safe, correctly scoped and readable through navigation, connection loss and long histories.

## Child tasks

- [ ] **ZWUI-015** — Centralize fail-closed Markdown rendering and regression tests
- [ ] **ZWUI-016** — Implement normalized run reducer and immutable event store
- [ ] **ZWUI-017** — Implement ticketed stream controller and recovery UX
- [ ] **ZWUI-018** — Add stable logical-message history pagination and DB errors
- [ ] **ZWUI-019** — Build logical transcript with stable reading position
- [ ] **ZWUI-020** — Build truthful activity and artifact inspector

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

Missing-sanitizer failure is safe; event application/recovery is deterministic; logical messages remain whole; activity/artifact status reflects real evidence.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
