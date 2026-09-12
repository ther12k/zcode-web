<!-- zcode-ui-plan:ZWUI-029 -->
# [ZWUI-029] Add bounded authorized server-wide session search

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P2 |
| Milestone | M3 |
| Epic | ZWUI-E05 |
| Suggested owner | Backend + Frontend |
| Relative review scope | L — not a calendar estimate |
| Requirements | FR-20, FR-11 |
| Depends on | ZWUI-018, ZWUI-021, ZWUI-027 |
| Suggested labels | ui-ux, type:task, priority:P2, scope:optional |

## Goal and context

Extend beyond loaded-session filtering with a real search capability and explicit scope/completeness.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Define the optional search contract with query/limit/cursor validation and capability advertisement.
- [ ] Search eligible session metadata across configured authorized roots using the existing read-only data adapter; do not create a second conversation database.
- [ ] Bound query length, result size, execution time and pagination; distinguish index/search unavailability from no matches.
- [ ] Return project/session identity and actual scope/completeness metadata without unnecessary content or sensitive paths.
- [ ] Integrate a clearly labeled global-search mode into the palette/navigation, retaining loaded-local search when unsupported.
- [ ] Add fixtures with more sessions than a loaded page, duplicate titles, root removal and query/schema failures.

## Acceptance criteria

- [ ] Global search can return an eligible session beyond the loaded client list without leaking a blocked-root session.
- [ ] Pagination has stable identity and explicit hasMore/completeness; unavailable results are not called empty success.
- [ ] Selecting a result uses validated project/session routing and does not alter an active run.
- [ ] Capability absent leaves the launch search behavior usable and honestly labeled.

## Required verification

- [ ] **T20 — Database failure states:** Missing DB, unsupported schema, read-only open failure and SQL failure are distinguishable; no writable fallback or fake empty success.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T30 — Authorized global search:** Pagination beyond loaded sessions, blocked roots, limits, schema failure and results labeled with scope/completeness.

## Out of scope

No full-text message indexing, external search service, new database or public search endpoint without a separately accepted scope.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
