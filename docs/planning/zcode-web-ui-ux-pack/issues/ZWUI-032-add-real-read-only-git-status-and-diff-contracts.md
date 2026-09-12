<!-- zcode-ui-plan:ZWUI-032 -->
# [ZWUI-032] Add real read-only Git status and diff contracts

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Backend + Security |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-22, FR-17 |
| Depends on | ZWUI-030 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:optional |

## Goal and context

Provide actual repository change evidence rather than the reference’s database snapshots and generated commit identifiers.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define capability/status/diff shapes including repository presence, actual branch/detached state, comparison base, paths and truncation.
- [ ] Use bounded fixed Git argument arrays without shell interpolation; disable external diff/text-conversion behavior and avoid hooks/mutations.
- [ ] Validate project/path inputs with the shared filesystem boundary and safely handle names beginning with special characters.
- [ ] Distinguish working-tree-versus-index from index-versus-HEAD results and represent untracked, renamed, binary and large files explicitly.
- [ ] Limit execution time/output and expose unavailable Git/non-repository states without inventing a branch or clean result.
- [ ] Use fixture repositories and compare their state before/after reads, including malicious external-diff configuration and unusual filenames.

## Acceptance criteria

- [ ] Status/diff match the fixture repository and identify their exact comparison scope.
- [ ] No shell command injection, external diff/textconv execution, workspace mutation or synthetic commit hash occurs.
- [ ] Non-repository/tool-missing/too-large states are explicit and bounded.
- [ ] Results do not claim that all working-tree changes were made by a particular agent run.

## Required verification

- [ ] **T31 — Filesystem boundaries:** Traversal/encoding, symlink policy, sensitive files, binary/large input, concurrent path changes and no mutation.
- [ ] **T33 — Real Git evidence:** Fixture repository edits/renames/binary/untracked/large output, correct base, no mutation or external diff execution.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No Git commit/stage/reset/checkout/push, credential handling or implementation of the reference snapshot-history model.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
