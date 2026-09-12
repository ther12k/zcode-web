# Test and acceptance plan

## 1. Evidence rule

Every result attached to a task must identify source SHA, frontend build digest, Node/browser versions, relevant CLI version/schema fixture, test command and pass/fail/skip outcome. The maintainer's existing runtime report is useful baseline evidence but is not a substitute for running the new candidate. No tests described in this pack have been executed against a new implementation.

## 2. Test layers

**Contract/unit:** use a fake CLI executable and synthetic SQLite fixtures. Test parsers, reducers, idempotency, cancellation, ticket validation, path boundaries, pagination and safe renderer behavior without paid model calls.

**Component:** test the composer, route-bound views, menus/dialogs, message parts, draft persistence, capability states and late async responses. Use role-based queries and fake clocks where deterministic.

**Integration/browser:** Playwright drives the built client against the real Node HTTP/SSE server with the fake CLI. A network harness creates drops, delays, duplicate replay and terminal races. Test auth enabled and intentionally trusted tokenless mode separately.

**Live smoke:** when authorized CLI/provider access exists, run a small non-sensitive project interaction against the exact candidate. Record CLI version and source/build identities. Skipping this lane must remain visible; fixture success alone is not live-provider verification.

**Human UX/accessibility:** keyboard, focus, screen-reader announcements, mobile keyboard, zoom/reflow and visual comparison. Automated accessibility checks do not cover every issue. [S13](12-SOURCES-AND-EVIDENCE.md#primary-ui-and-testing-sources).

## 3. Test inventory

| ID | Scenario | Required result |
|---|---|---|
| T01 | Access and credential lifecycle | Protected API challenge, invalid/valid bearer, forget, late response after logout; no previous cache or object URL survives. |
| T02 | Projects and directory identity | Configured roots, duplicate names, invalid creation, missing root, canonical project/session mismatch rejected. |
| T03 | Routing and static assets | Deep-link reload, back/forward, unknown UI route, missing hashed asset, API 404, HTML fallback boundaries. |
| T04 | Safe Markdown failure paths | Live and stored payloads, event handlers, executable links, code fences, missing/unsupported sanitizer; no execution and plain-text fallback. |
| T05 | Attachment-only submission | No text plus valid uploaded file accepted once; inspect exact protected default prompt at fake CLI; text plus no files still works. |
| T06 | Upload validation and limits | Invalid base64, over-size request, delivered 413, count limit, unsafe filename round-trip, failed upload retained for retry. |
| T07 | Protected media lifecycle | Token-protected raster loads through fetch/blob; no token URL, no cross-origin credential, object URLs revoked after final consumer. |
| T08 | Unresolved artifact behavior | Desktop custom URI renders metadata, no path inference, no broken-image/download control; unknown MIME handled safely. |
| T09 | Submission idempotency | Double activation and lost response create one job; differing payload same key conflicts; restart does not auto-resubmit. |
| T10 | Server resume boundary | Session from project A with project B request rejects before CLI start; malformed or unknown context is not silently normalized. |
| T11 | Navigation and late callbacks | Switch A/B during run, slow history, late ticket, first session binding, StrictMode effect replay; no cross-view mutation. |
| T12 | Terminal semantics and cleanup | Exit zero/nonzero, agent failure with exit zero, signals, cancel/timeout/close races; one terminal result; supported child-process cleanup tested. |
| T13 | Replay consistency | Drop at every boundary, reconnect before/after terminal, duplicate event, replay/live handoff; ordered exactly-once application per sequence. |
| T14 | Ticket security and lifecycle | Wrong job, wrong epoch, expired ticket, legacy bearer query, mint failure, retained terminal stream and auth-enabled mode. |
| T15 | Retention reset | Cursor older than replay window causes explicit reset and snapshot reconciliation; truncation visible; never append a duplicate replay. |
| T16 | Server restart reconciliation | Epoch changes, missing job, expired idempotency entry; UI reports uncertainty and does not infer success or re-execute. |
| T17 | CLI decoder and memory bounds | Unicode split across chunks, final line without newline, malformed record, huge record/stderr, bounded buffers with explicit diagnostic. |
| T18 | Complete logical-message history | At least 1,000 messages and over 2,000 parts, multi-tool/file turns, final message beyond old cap, no split/lost parts. |
| T19 | Cursor stability under writes | Desktop app appends during older-page loads; stable IDs, consistent upper bound, no duplicate/omitted page due to shifting offset. |
| T20 | Database failure states | Missing DB, unsupported schema, read-only open failure and SQL failure are distinguishable; no writable fallback or fake empty success. |
| T21 | Transcript reading position | Prepend, expand tool, late image, resize pane and live delta while scrolled up; preserve anchor; New output resumes follow. |
| T22 | Real model/mode controls | Configuration-driven values, empty/changed model list, rejected selection and high-risk-mode labels; no fabricated Ask permission. |
| T23 | Draft correctness | Separate drafts, edits while submission in flight, failed submission, optional persistence, expiry/quota denial, credential/instance change. |
| T24 | Keyboard and assistive technology | Dialogs, menu, tabs, splitter, reverse Tab, IME, command palette, focus restore, status announcements and reduced motion. |
| T25 | Visual and responsive matrix | Approved dark/light states at 1440,1280,1024,768,390,360 widths, 200% zoom and 320 CSS px reflow; no action lost. |
| T26 | Performance and resources | Defined asset, input, streaming, history and repeated-navigation heap/profile budgets; measure actual candidate and record environment. |
| T27 | Packaging and rollback | Clean locked build, static production runtime, authenticated container health, deep links, no external CDN calls and safe rollback. |
| T28 | Capabilities and truthful status | Missing flags, unsupported events, unconfigured provider, unavailable CLI, ambiguous completion; no fake tools/tests/save/Git evidence. |
| T29 | Browser-local organization | Pin/hide/alias survives opt-in device persistence, clear/reset works and desktop database remains unchanged. |
| T30 | Authorized global search | Pagination beyond loaded sessions, blocked roots, limits, schema failure and results labeled with scope/completeness. |
| T31 | Filesystem boundaries | Traversal/encoding, symlink policy, sensitive files, binary/large input, concurrent path changes and no mutation. |
| T32 | Read-only code inspector | Lazy load, line wrapping, selection, binary/denied/truncated states, no save action and no executable content insertion. |
| T33 | Real Git evidence | Fixture repository edits/renames/binary/untracked/large output, correct base, no mutation or external diff execution. |
| T34 | Preview security boundary | Separate origin, sandbox, missing credentials, rejected bridge messages, blocked private files, navigation/resource abuse and residual risk record. |
| T35 | Preview product behavior | Unsupported project, snapshot load/error/expiry, viewport buttons, refresh/dispose, correct identity and no invented hostname or deployment. |
| T36 | Production/reference separation | No demo agent/database/snapshot Git/simulated terminal dependency or synthetic activity/test result ships in live adapter. |

## 4. Fixture design

Create fake-CLI scenarios for accepted new session, resumed session, text deltas, tool state changes, artifacts, unknown event, agent failure, exit failure, delayed first session ID, termination and a spawned child. Feed Unicode and newline boundaries deterministically. No arbitrary user-provided executable is needed by the fixture harness.

Create database fixtures with at least 1,000 logical messages and more than 2,000 total parts; include a final message after that boundary and a message with many tool/file parts. Add concurrent append, duplicate sequence tie-breaker if allowed by the real schema, malformed part, unsupported schema and read-only failure fixtures. Synthetic fixtures do not authorize altering a real desktop database.

Redact or synthesize paths, prompts, provider data and file contents. Do not commit proprietary CLI bundles, real credentials or personal desktop transcripts. All fixtures carry a schema/version note explaining what they establish and what they cannot establish.

## 5. Performance protocol and proposed budgets

Budgets are proposed release requirements, not measured baseline performance. If evidence suggests an unrealistic budget, record the measurement and approve an ADR adjustment before changing the gate; do not quietly inflate it after a failure.

| Metric | Protocol | Initial target |
|---|---|---|
| Initial JS | Gzip all eagerly fetched route JS chunks; exclude a chunk only if not fetched before the relevant feature opens | ≤250 KiB |
| Initial CSS | Gzip eagerly loaded CSS | ≤60 KiB |
| Shell ready | Built production bundle, synthetic API, Chromium, 4× CPU slowdown, 10 Mb/s download and 100 ms RTT; 10 cold runs; record host/browser | p75 ≤2.5 s |
| Composer response | Instrument input event to painted state under fixture stream; at least 200 observations | p95 <100 ms |
| Visible stream latency | Browser event receipt to painted update, 50 events/s for 60 s with 200-character text deltas plus periodic tools | p95 <150 ms |
| Repeated navigation | 50 A/B navigation cycles and 20 blob opens/closes; compare retained listeners, URLs and post-GC heap after warm-up | Zero leaked transports/URLs; no unbounded growth |
| History | 1,000-message fixture, latest-page open then page older; inspect long tasks, responsiveness and anchor | No missing/split messages; input target maintained |
| Server overhead | Idle and replay workload, same backend before/after; record CPU/RSS and output limits, separate CLI process cost | No unbounded buffers; explain material regressions |

Heap numbers vary by browser/host; record a stable fixture profile and trend instead of claiming universal memory limits from one reading. These lab budgets do not establish a field Core Web Vitals score.

Avoid virtualizing until pagination/identity works. If introduced, re-run text selection, find/navigation, screen-reader and dynamic-height anchor tests. A paged nonvirtualized fallback is preferable to a fast inaccessible transcript.

## 6. Browser and visual matrix

Pin tested browser versions in CI. Required automated core flows: Chromium, Firefox and WebKit. Add a real Chrome/Edge desktop smoke and real Safari/iOS/mobile-keyboard check where the project will claim those environments. Engine emulation alone is not evidence for a physical device.

Visual states: empty project, loaded session, long title, streaming, scrolled-up new output, disconnected, failed, unauthorized, attachment uploading/error, metadata-only artifact, open dialog, light theme, collapsed panes and optional capability absent. Approve screenshots by review; do not accept a blanket pixel-diff threshold without reading the changes.

Target WCAG 2.2 AA. Automated serious/critical findings must be fixed or explicitly waived with an owner, rationale and follow-up; manual keyboard/reflow/assistive-technology blockers cannot be dismissed because axe is green.

## 7. Proposed scripts to implement

These command names are **desired scripts**, not commands that already exist in `f102cef`:

```sh
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run test
npm --prefix web run build
npm run test:server
npm --prefix web run test:e2e
npm --prefix web run test:a11y
npm --prefix web run test:perf
```

ZWUI-002, ZWUI-023 and ZWUI-024 create the scripts/harnesses. The server test script may use Node's built-in test runner. CI stores redacted traces/screenshots and size reports from the same candidate.

## 8. Release acceptance checklist

- [ ] All required tasks ZWUI-001–027 are accepted; optional scope remains disabled unless separately accepted.
- [ ] All required T01–T28 and T36 cases pass against the release candidate; environmental skips are documented and compatible with support claims.
- [ ] Sanitizer/ticket/upload regressions are checked in a real browser with authentication enabled.
- [ ] Routing, job recovery and history reconciliation tests pass without a live model dependency.
- [ ] Performance and accessibility evidence is reviewed, not just generated.
- [ ] Clean Docker build, authenticated health probe and rollback preserve the CLI database and project files.
- [ ] Release notes identify remaining artifact limitation and any verified support limits.

Optional tools require their corresponding T29–T35 evidence and feature-specific reviews; they are not inferred to work from the core release.
