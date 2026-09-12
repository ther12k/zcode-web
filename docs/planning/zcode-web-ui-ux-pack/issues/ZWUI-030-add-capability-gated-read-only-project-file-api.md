<!-- zcode-ui-plan:ZWUI-030 -->
# [ZWUI-030] Add capability-gated read-only project file API

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Backend + Security |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-21, FR-24 |
| Depends on | ZWUI-004, ZWUI-027 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:optional |

## Goal and context

Expose bounded file inspection safely enough for a read-only tools pane, with server-enforced project boundaries.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define file tree/read response contracts with stable relative identity, MIME/type, byte size, content hash and truncation/blocked reason.
- [ ] Implement canonical project and relative-path validation, encoded-path handling and a default-deny symlink policy or reviewed equivalent.
- [ ] Implement safe opening under the supported filesystem platform, addressing path changes between checking and reading; document residual assumptions.
- [ ] Apply sensitive-path, file-count, depth, text/binary, byte/time limits and avoid reading unnecessary content.
- [ ] Keep APIs authenticated and advertised only after boundary tests pass; add no write/delete/execute operations.
- [ ] Test traversal, alternate encodings, symlinks, case/path edge cases, large/binary files and concurrent path changes with synthetic fixtures.

## Acceptance criteria

- [ ] No request can read outside its accepted canonical project or silently bypass the configured blocked-file policy.
- [ ] Binary/oversized/denied inputs have explicit bounded responses rather than arbitrary HTML or unbounded buffering.
- [ ] File inspection performs no project/database mutation and never sends credentials to remote URLs.
- [ ] The capability remains false until tests and security review accept the supported-platform path-opening policy.

## Required verification

- [ ] **T31 — Filesystem boundaries:** Traversal/encoding, symlink policy, sensitive files, binary/large input, concurrent path changes and no mutation.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.

## Out of scope

No arbitrary host-file reader, file editor, recursive workspace upload, remote URL fetch or claim that filename deny rules catch every possible secret.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
