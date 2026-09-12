<!-- zcode-ui-plan:ZWUI-026 -->
# [ZWUI-026] Measure frontend performance and bound client resource retention

| Field | Value |
|---|---|
| Status | Proposed; not implemented or filed by this pack |
| Priority | P1 |
| Milestone | M2 |
| Epic | ZWUI-E04 |
| Suggested owner | Frontend + QA |
| Relative review scope | M — not a calendar estimate |
| Requirements | FR-16, FR-17 |
| Depends on | ZWUI-017, ZWUI-019, ZWUI-020, ZWUI-024 |
| Suggested labels | ui-ux, type:task, priority:P1, scope:core |

## Goal and context

Measure the actual cost of the richer client and prevent long conversations and repeated navigation from degrading responsiveness.

Baseline: `f102cef`; uploaded reference identity and verification limits are recorded in `12-SOURCES-AND-EVIDENCE.md`. This issue describes work to implement, not a claim that its APIs or tests already exist.

## Implementation work

- [ ] Implement asset-size and production-lab measurements using the documented host/browser/network/CPU profile.
- [ ] Measure input responsiveness and stream-arrival-to-paint latency under the deterministic replay load, separating model latency.
- [ ] Profile the large logical-message fixture, dynamic card expansion and 50 navigation/20 media-open cycles.
- [ ] Count transports/listeners/timers/object URLs and inspect retained heap after warm-up; eliminate unbounded growth.
- [ ] Lazy-load optional heavy tools and add virtualization only with preserved identity/scroll/accessibility evidence.
- [ ] Publish before/after reports with explicit budget decisions and no raw prompt/file/token telemetry.

## Acceptance criteria

- [ ] Initial route JS/CSS and input/stream timing meet approved budgets or have an explicit evidence-backed adjustment before release.
- [ ] Optional code/preview assets are excluded from initial size only if they are genuinely not fetched until opened.
- [ ] No abandoned transport/object URL persists after its last consumer, and repeated navigation does not produce unbounded memory growth.
- [ ] Performance reports state environment, measurement method and sample count rather than claiming universal server-cost savings.

## Required verification

- [ ] **T21 — Transcript reading position:** Prepend, expand tool, late image, resize pane and live delta while scrolled up; preserve anchor; New output resumes follow.
- [ ] **T26 — Performance and resources:** Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment.
- [ ] **T27 — Packaging and rollback:** Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback.

## Out of scope

No premature editor/virtualization stack, universal zero-resource promise or field-performance claim from a lab run.

## Handoff and evidence

Attach the implementation PR, exact tested source/build identity, test commands and results, and relevant redacted screenshots/traces. Mark skipped/unavailable checks explicitly. Update requirements/capability documentation if behavior changes. Replace planning dependencies with actual GitHub issue references after filing; do not close based only on a narrative confirmation.

Pack references: `01-PRD.md`, `04-UX-SPEC.md`, `05-ARCHITECTURE.md`, `06-API-AND-EVENT-CONTRACTS.md`, `07-SECURITY-AND-PRIVACY.md`, `08-TEST-AND-ACCEPTANCE-PLAN.md`.
