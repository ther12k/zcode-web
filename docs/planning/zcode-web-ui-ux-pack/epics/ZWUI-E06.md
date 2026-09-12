<!-- zcode-ui-plan:ZWUI-E06 -->
# [ZWUI-E06] Optional isolated static preview

**Status:** Proposed. **Type:** Epic. **Scope:** Optional post-launch.

## Outcome

Add a bounded preview experience only after its untrusted-content boundary is approved.

## Child tasks

- [ ] **ZWUI-034** — Approve static preview threat model and capability contract
- [ ] **ZWUI-035** — Implement isolated static snapshot preview service
- [ ] **ZWUI-036** — Build capability-gated Preview UX and lifecycle states

## Sequencing

Follow each child task's explicit dependencies in `10-ISSUE-REGISTER.md`. Numeric order and epic membership do not override the dependency graph. Cross-epic work may proceed in parallel after its prerequisites are accepted. A decision gate must be approved before dependent implementation starts.

## Acceptance gate

Static format, isolated delivery, credential absence, lifecycle controls and residual risks are approved and tested; unsupported projects receive no fake preview.

## Evidence and closure

Replace each planning ID with its filed issue number/URL after registration. Close only when the selected required child tasks have accepted evidence. For optional scope, record the deliberately selected subset and keep unimplemented capabilities disabled; do not close an epic in a way that implies deferred features shipped.

No actual issue, assignment, milestone, implementation or release was created by preparing this document. This body is ready for maintainer registration and ownership assignment.
