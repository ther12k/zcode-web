# Product requirements: ZCode Web workspace redesign

**Version:** 1.0 proposal · **Date:** 12 September 2026 · **Baseline:** `f102cef`

## 1. Product decision

Build a focused, self-hosted coding-agent workspace with a desktop-quality interface. The user should always understand **which project and session they are viewing, what the agent is doing, what evidence exists, and what action is safe to take next**.

Use **Vite + React + TypeScript + TanStack Router + TanStack Query**, with Tailwind CSS and selected shadcn/ui primitives. Keep Node 24, the CLI execution boundary and the CLI-owned session database. This is a frontend modernization with bounded API improvements—not a new AI application builder or a backend rewrite. [Decision](03-STACK-DECISION.md); [baseline sources](12-SOURCES-AND-EVIDENCE.md#repository-sources).

The supplied reference establishes the intended visual direction: dark graphite surfaces, muted sage accents, compact project navigation, a central conversation, and a right-hand tools pane. Its implementation is not the source of truth for execution, persistence, permissions or Git behavior. [Reference audit](02-REFERENCE-AUDIT.md).

## 2. Problem and intended outcome

A coding-agent interface cannot be judged only by its chat bubble styling. Users switch projects while work runs, return to long histories, inspect tools and files, lose connections, and need to distinguish an agent's statement from a verified result.

The redesign should reduce navigation and inspection effort without obscuring the existing operating model. Host-share sessions must remain interoperable with the CLI. Desktop artifacts whose bytes cannot be resolved must still have honest metadata cards. Existing security fixes are regression requirements, not features to rebuild from scratch.

### Product principles

| Principle | Operational meaning |
|---|---|
| Context is explicit | Project, session, mode and active run are visible and have separate identities. |
| Evidence before decoration | No fabricated progress steps, test passes, Git hashes, files or save confirmations. |
| Navigation is not execution | Selecting another session neither retargets nor silently cancels a running job. |
| Progressive disclosure | Read the answer first; expand tool details, diagnostics and artifacts when needed. |
| Lightweight operations | One existing backend service serves built frontend assets; no production Vite server. |
| Safe degradation | Unsupported content and unavailable capabilities receive useful states, not fake functionality. |

## 3. Users and jobs to be done

**Primary user: individual developer operating a trusted self-hosted instance.** They select a server-side project, start or resume a CLI session, attach context, monitor work and inspect output. They may switch between the desktop and browser.

**Secondary user: instance maintainer.** They configure CLI location, model providers, allowed workspace roots and access. They need actionable failures and reproducible deployment rather than a second administrative database.

**Mobile user: developer checking a run or sending a follow-up.** Mobile must support core chat and inspection, but is not promised to be a full IDE.

The access model remains a trusted operator boundary. A shared bearer token does not create separate tenants or prove per-user ownership. Multi-user authorization is outside this release.

## 4. Release scope

### Required launch: M0–M2, tasks ZWUI-001–027

Deliver a responsive three-region workspace; project/session navigation; authenticated onboarding and readiness states; a capable composer; sanitized Markdown; attachment-only sending; accurate job state; reconnectable ticket-based streaming; logical-message history; tool and artifact details; scoped search; drafts; keyboard navigation; themes; and release regression gates.

The right pane initially provides **Activity** and **Artifacts**. Files, Changes and Preview appear only when the server advertises a tested capability. The layout can closely resemble the reference without pretending these additional backends already exist.

### Optional extension: M3, tasks ZWUI-028–036

Add browser-local pin/hide/display aliases; properly labeled server-wide session search; read-only file inspection; real Git status/diff; and a separately approved static preview for supported HTML/CSS/JavaScript snapshots.

### Explicit exclusions

Do not introduce Next.js, TanStack Start, PostgreSQL/Drizzle, a separate model-gateway call path or a second message store. Do not add an OS terminal, arbitrary package installation, write-capable file editor, Git commit/push, public share links, hosted deployment or collaboration. Do not infer a filesystem path from `zcode-artifact://`.

Do not promise that Vite makes the CLI browser-executable or eliminates backend compute. It moves frontend rendering/build concerns, not the existing CLI execution boundary.

## 5. Functional requirements

“Must” means required for the core launch. “Later” is separately gated optional scope.

| ID | Requirement | Priority and acceptance boundary |
|---|---|---|
| FR-01 | Responsive workspace shell | Must: sidebar, conversation, inspector; independent scrolling; keyboard-operable resizing; mobile single-pane mode. |
| FR-02 | Project selection and creation | Must: only configured roots; clear path/context; server validation errors; no arbitrary browse outside allowed roots. |
| FR-03 | Session navigation and identity | Must: deep links, back/forward, reload, immutable active-run binding; stale responses cannot change another session. |
| FR-04 | Composer | Must: multiline input, IME-safe sending, visible send/stop states, recoverable failures and no duplicate job from one submission. |
| FR-05 | Attachments | Must: select/paste/drop, up to the supported count, visible upload states, attachment-only send and authenticated image previews. |
| FR-06 | Safe content rendering | Must: sanitize all untrusted Markdown HTML; plain-text fallback when sanitizer unavailable; safe links and code blocks. |
| FR-07 | Truthful job lifecycle | Must: distinguish running, stopping, succeeded, failed, cancelled, timed out and unknown outcome; process exit is not proof tests passed. |
| FR-08 | Reconnection | Must: scoped tickets; lossless ordered replay or explicit reset; no duplicate deltas; no automatic resubmission. |
| FR-09 | Logical-message history | Must: stable message IDs; whole-message pages; latest content; stable older-page anchor; no silent partial-history cap. |
| FR-10 | Activity/artifact inspection | Must: group actual tool events with their turn; support running/failed/unknown; preserve metadata-only desktop artifacts. |
| FR-11 | Scoped search | Must: filter loaded sessions with a visible search-scope label; no unsupported claim to search all history. |
| FR-12 | Drafts and preferences | Must: separate draft per project/session; optional device persistence; no secrets in URLs; clear local-data controls. |
| FR-13 | Model/mode controls | Must: use server-advertised values; keep safe configured default; explain risk without inventing permission guarantees. |
| FR-14 | Access/settings/readiness | Must: auth challenge, token handling, CLI/provider availability, theme and density; never expose provider keys. |
| FR-15 | Accessibility | Must: target WCAG 2.2 AA; keyboard, focus, contrast, touch targets, reduced motion and manual assistive-technology checks. |
| FR-16 | Responsiveness under load | Must: meet the proposed benchmark protocol and budgets in the test plan, or record an approved adjustment before launch. |
| FR-17 | Honest status and privacy | Must: no invented completion/test/save claims; diagnostics redact credentials/content by default; no default analytics export. |
| FR-18 | Deployability/rollback | Must: same-origin production assets/API; deep-link routing; authenticated health probe; reproducible build and tested rollback. |
| FR-19 | Local organization | Later: pin/hide/display aliases only, explicitly browser-local; no CLI database mutation. |
| FR-20 | Global search | Later: bounded read-only server search with cursors, authorized roots and honest scope/completeness. |
| FR-21 | Read-only files/code | Later: capability-gated safe file listing/read; binary/large/blocked states; no save button. |
| FR-22 | Real changes | Later: true Git status/diff with base/scope metadata; no invented “agent changed” attribution. |
| FR-23 | Isolated preview | Later: supported static snapshots only, security decision first; no main-origin arbitrary execution or generic URL proxy. |
| FR-24 | Capability and degraded-state handling | Must: absent/unknown capabilities fail closed; context-specific loading, empty, denied, disconnected and unsupported states. |

## 6. Primary journeys

### A. First successful interaction

Open the application. When the API returns an authentication challenge, show an inline access screen rather than a browser prompt loop. After access succeeds, display readiness and allow project selection. A missing provider or CLI prevents sending but not navigation to setup information. Create or select a project, choose from supported models/modes, type or attach context, and submit once.

**Success:** the accepted run appears with the correct project/session context. A new session URL replaces the draft route only if that conversation is still active. A response arriving from an older route never changes the current view.

### B. Resume host-share history

Choose an existing session. Load the latest logical-message page, render text and associated tool/file cards together, and restore the reading position when revisiting. Load older messages without jumping to the bottom. Resume using the correct session directory, checked server-side.

**Success:** no desktop database rewrite; no tool card detached from its message; no false “all history loaded” if the source cannot provide it.

### C. Navigate while work runs

Start a run in project A, then inspect project B. A's run stays visible in a global activity indicator, while B's composer and history retain B's identity. Returning to A reattaches the view to the same run. Cancelling A uses A's job ID even when B is selected.

**Success:** no cross-project event contamination and no navigation-triggered cancellation. Concurrent jobs are bounded by server limits; a second run in the same session is blocked until the first is terminal.

### D. Lose and restore the stream

After connection loss, keep received text and show “Reconnecting — the run may still be active.” Refresh the ticket, resume after the last applied sequence, and deduplicate replay. When replay is unavailable, reconcile from an authoritative snapshot and disclose any retained-output limit.

**Success:** no duplicate text, no duplicate CLI invocation, no fake completion, and no cross-run replay. After a server restart, report an unknown outcome unless durable evidence resolves it.

### E. Inspect an output

Select a tool or artifact. The right pane shows available evidence, timestamps, status and bounded detail. Browser-uploaded images can render from authenticated bytes. Desktop-only artifact URIs remain metadata cards with an explicit unavailability explanation.

**Success:** the interface never mistakes an artifact identifier for a path or claims missing bytes have been downloaded.

## 7. UX targets

The default visual system uses graphite surfaces and muted sage accents, with larger readable text and hit areas than the smallest reference styles. Chat body text should normally be 15–16 CSS pixels. Use 44-pixel mobile interaction targets as the product target; compact desktop controls still require accessible hit areas and focus treatment.

Desktop ≥1280 CSS pixels uses all three regions. At 900–1279, collapse the navigation and make the inspector toggleable. Below 900, show one primary content pane with a navigation drawer and inspector switch. Test narrow widths down to 360, 200% zoom and the equivalent reflow scenario at 320 CSS pixels. Exact thresholds are implementation targets, not claims about the supplied reference.

Avoid binding Ctrl/Cmd+N to new chat by default because it competes with a browser action. Preserve Shift+Tab for reverse focus navigation; do not copy the reference's mode-cycling shortcut. See [UX specification](04-UX-SPEC.md).

## 8. Success measures and launch acceptance

These are **proposed targets**, not existing measurements:

| Measure | Target and measurement |
|---|---|
| Correct context | All automated project/session/race cases pass; zero accepted cross-context runs. |
| Baseline safety | All f102cef regression cases plus missing-sanitizer and auth-enabled media cases pass. |
| Streaming recovery | All deterministic disconnect/replay/expiry fixtures finish without missing or duplicated application events. |
| Initial route assets | Initial JavaScript ≤250 KiB gzip; CSS ≤60 KiB gzip; editor/preview chunks excluded only if genuinely lazy-loaded. |
| Interactive shell | Ready within 2.5 seconds under the documented local fixture profile; no model-latency contribution. |
| Input and stream responsiveness | Input response p95 <100 ms; event-arrival-to-visible-update p95 <150 ms at the documented replay load. |
| History | 1,000-message / >2,000-part fixture remains navigable and preserves whole messages and reading position. |
| Accessibility | No unwaived critical/serious automated findings; manual keyboard, zoom and assistive-technology scenarios signed off. |
| Operations | Both token-protected and explicit trusted-local modes pass container smoke tests; rollback preserves CLI data. |

Before a general rollout, run a small task-based usability check with at least three intended users: find a session, send an attachment-only message, navigate during a run, recover a disconnect, and inspect an unavailable artifact. Record confusion and fix blocking misunderstandings. This is formative evidence, not a statistically significant study.

## 9. Constraints and risks

The CLI database/event schema may vary by CLI version. Preserve fixtures and report unsupported schemas distinctly. Model/CLI latency is external to frontend performance budgets. A self-hosted bearer token is powerful; convenience features cannot substitute for network isolation or a tenant model.

Browser-local drafts may contain code or secrets and may be lost when storage is cleared. Make persistence opt-in, scope it to the instance/project/session and expose deletion. Optional file and preview features increase the attack surface and require their own gates.

Source inspection also found three narrower caveats in the planning baseline: a missing-sanitizer raw-HTML fallback, time-based rather than completion-bound ticket expiry, and a pre-pagination part-row cap. These are captured under ZWUI-015, ZWUI-008 and ZWUI-018 respectively; their tests must not be marked complete based only on this document. [Evidence notes](12-SOURCES-AND-EVIDENCE.md#source-level-caveats-to-carry-forward).

## 10. Definition of done

Required tasks ZWUI-001–027 meet their acceptance criteria and attach actual evidence. Product and engineering approve the route/state model and capability labels. Security regression, backend contract, browser, responsive and packaging suites pass against the same identified candidate. The reference remains an input, not a runtime dependency. A tested previous safe build is available for rollback. Optional capabilities remain disabled until their own tasks are accepted.
