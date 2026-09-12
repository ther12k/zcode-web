<!-- zcode-ui-plan:ZWUI-E05 -->
# [ZWUI-E05] Optional read-only workspace tools

**Status:** Proposed. **Type:** Epic. **Scope:** Optional post-launch.

## Outcome

Add useful organization/search/files/Git inspection after core release, without pretending the reference’s snapshot/terminal behaviors are real.

## Child tasks

- [ ] **ZWUI-028** — Add explicitly device-local pin hide and display aliases
- [ ] **ZWUI-029** — Add bounded authorized server-wide session search
- [ ] **ZWUI-030** — Add capability-gated read-only project file API
- [ ] **ZWUI-031** — Build lazy read-only Code inspector
- [ ] **ZWUI-032** — Add real read-only Git status and diff contracts
- [ ] **ZWUI-033** — Build real Changes inspector with clear diff scope

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

Each selected capability has its own evidence and remains disabled until accepted; file/Git boundaries stay read-only and local preferences are labeled honestly.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
