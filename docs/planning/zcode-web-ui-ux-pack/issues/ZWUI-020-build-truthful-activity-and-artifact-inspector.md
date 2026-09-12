<!-- zcode-ui-plan:ZWUI-020 -->
# [ZWUI-020] Build truthful activity and artifact inspector

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M1 |
| Epic | ZWUI-E03 |
| Suggested owner | Frontend |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-10, FR-17, FR-24 |
| Depends on | ZWUI-015, ZWUI-019 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Use the reference’s inspection layout to reveal real CLI evidence, not predefined progress or nonexistent files.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Build Activity and Artifacts tabs with a selected-card detail view, responsive expansion and contextual empty/error states.
- [ ] Display actual normalized tool name/status/timestamps/output where available, with bounded text and explicit unknown/unsupported states.
- [ ] Keep cards attached to their turn and allow navigation between a message and its inspector detail without losing scroll context.
- [ ] Implement metadata-only desktop artifact copy with available MIME/size/kind; show preview/download only for verified resolvable bytes.
- [ ] Distinguish run finished, agent failed, tests reported and unavailable evidence; never infer verified tests from a generic success event.
- [ ] Gate later Code/Changes/Preview tabs on tested capabilities and omit simulated terminal, fake branch/hash and automatic share controls.

## Acceptance criteria

- [ ] A metadata-only artifact has no broken image, guessed path or misleading download control.
- [ ] All status labels derive from identified event/snapshot fields; unknown events cannot create fake successes.
- [ ] Selecting an artifact during navigation affects only its owning conversation and opens the correct inspector detail.
- [ ] Unavailable capabilities receive useful states or stay hidden without taking away supported chat functionality.

## Required verification

- [ ] **T08 — Unresolved artifact behavior:** Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely.
- [ ] **T11 — Navigation and late callbacks:** Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation.
- [ ] **T21 — Transcript reading position:** Prepend, expand tool, late image, resize pane and live delta while scrolled up; preserve anchor; New output resumes follow.
- [ ] **T28 — Capabilities and truthful status:** Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence.
- [ ] **T36 — Production/reference separation:** No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter.

## Out of scope

No desktop-byte reverse engineering, generated activity narrative, operating-system terminal or Git/preview backend implementation.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
