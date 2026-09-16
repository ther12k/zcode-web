# ZCode Web: review findings and implementation plan

- **Review date:** 2026-09-15
- **Reviewed revision:** `b173ccc` on `main`
- **Repository:** `/home/ther12k/Workspace/ZCode/zcode-web`
- **Goal:** move toward ZCode Desktop behavioral and visual parity without weakening authentication, transcript correctness, or workspace isolation.
- **Scope of this deliverable:** review and planning only. No application fixes, deployment, commit, or push are included.
- **Status:** all tasks below are proposed and unchecked. Passing existing tests does not mean these uncovered cases are covered.

## 0. Implementation status (updated 2026-09-16)

Most of this plan has since been implemented in the working tree (uncommitted). Gate results at the implementation revision: TypeScript build clean, frontend unit tests 100/100, backend/security tests 63/63 (12 new), production build OK (537.11 KB raw / 166.62 KB gzip after the ZWUI-069 split), lint exit 0 with 25 warnings, full Playwright browser suite green including 5 new capability/auth/search/overlay tests. Per-task state:

| Task | State |
| --- | --- |
| ZWUI-059 | Done — bind spread, sidecar ATTACH join (`src.session`), graceful missing-DB, per-route index-failure isolation; new test suites green |
| ZWUI-060 | Done — realpath-based containment helpers applied to sessions, artifacts, rename, chat, files, uploads, cwd; symlink tests green |
| ZWUI-061 | Done — readBody settles once; tickets single-use with rotation marker; `onopen`-based attach; tests green |
| ZWUI-062 | Done — message-paged transcript with SQL-visible/content predicates, honest total, id-keyed `loadOlder` dedup; >6,300-part store test green |
| ZWUI-063 | Done (code) — live/persisted fold, neutral `Run finished`, failure footer without checkmark; browser-level acceptance still to exercise |
| ZWUI-064 | Done (code) — callID-keyed live tool cards sharing the terminal drawer's identity rule |
| ZWUI-065 | Done — `capsError` retry screen, explicit `authState`, prefs via provider + `zcode-prefs` event, token helpers unified |
| ZWUI-066 | Done — overlays stack with exclusive Escape/Tab ownership in the topmost layer (`useDialogA11y` dialog stack; the shell's global Escape defers while an overlay is open); stacked-dialog e2e proves one Escape closes only the top layer |
| ZWUI-067 | Done — git status words (server + UI), true run counts, truthful status copy, pinned reachable beyond latest-50, and hidden-session restore (list + restore/restore-all) in Settings |
| ZWUI-068 | Done — serve:test enables FILES/GIT; capabilities spec covers real file listing, git-status decoding, the UI token flow, content-search through the real sidecar index, and stacked-overlay Escape ownership |
| ZWUI-069 | Done (measured, modest) — Analytics/InfoDialogs/Telemetry load on demand: main chunk 552.19→537.11 KB raw (170.34→166.62 KB gzip), three on-demand chunks ≈19.2 KB raw. Further micro-splitting was judged not worth the complexity; the initial-load budget test still measures observed response bodies |
| ZWUI-070 | Partial — Dockerfile.lugas installs deps in-image; labeled experimental; shared contract suite not run |
| ZWUI-071 | Done — README route table + auth exceptions, api-contracts rewrite, web/README replaced |
| ZWUI-072 | 072a–c done (alias lifecycle, StringDecoder, process-group kill, upload names, attachment cap); 072d done — snapshot ids are content hashes (same-size edits no longer serve stale previews, identical rebuilds reuse the snapshot), active-content stripping extended (unclosed script tags, unquoted handlers, srcdoc, `javascript:` URLs) with `sandbox` CSP asserted; preview remains disabled by default |
| ZWUI-073 | Done — smoke sends once (asserts exactly one committed user turn); JS budget measures gzipped response bodies and fails on zero observations |

Sections 1–9 below are the original review, kept for the reasoning and the still-open acceptance criteria.

## 1. Executive assessment

The application has made substantial progress since the September 14 roadmap. Run lifecycle handling, canonical session-context rejection, sanitized Markdown, responsive layout, and several transcript behaviors already have implementations and regression coverage. Reopening every old roadmap item would waste effort and risk regressions.

The most urgent remaining functional defect is the content-search index: its SQLite query passes a parameter array as a single bound value and fails at runtime. The highest-priority security work is consistent realpath-based containment across workspace and file access. History truncation, live/persisted duplication, inaccurate completion labels, and preference updates then threaten day-to-day usability even though the existing test suite is green.

The recommended sequence is **search and security correctness, transcript and run fidelity, interaction polish, then performance and release documentation**. A 90–95% Desktop parity claim is not established by this review: there is no measured, side-by-side acceptance matrix sufficient to justify that percentage.

### Evidence classifications

- **Reproduced:** observed by a runtime probe or an executed test.
- **Source-confirmed:** inspection of the cited handler, query, or component establishes the described code behavior. This evidence does not establish runtime reproduction; each task specifies the additional regression coverage needed.
- **Hardening / verification:** a design weakness or missing assurance, not a claim of a demonstrated exploit.
- Source references below use repository-relative `path:line`; line numbers are anchored to the reviewed revision and will move during implementation.

## 2. Verification baseline

The following results were recorded during this review against `b173ccc`. They describe the existing suite, not the future acceptance tests specified below.

| Gate | Recorded result |
| --- | --- |
| TypeScript project build | Passed |
| Frontend unit tests | 100 passed |
| Node backend/security tests | 51 passed |
| Chromium browser suite | 49 passed |
| Production frontend build | Passed; main JavaScript approximately 169.62 KB gzip / 549.59 KB raw |
| Lint | Exit 0; warnings remain |
| Working tree before writing this report | Clean |

Audit notes contain conflicting aggregate lint counts (12 versus 27), so this document deliberately does not treat either count as a reliable baseline. Re-run lint and record the exact warning categories when taking ZWUI-072. There is a build chunk-size warning despite the successful build.

### Important coverage limitations

1. The browser JavaScript-size test sums `Content-Length`, but the Node static handler does not supply that header. It can therefore pass without measuring transferred JavaScript.
2. The standard browser-test server does not enable Files and Git capabilities. A passing browser suite does not establish the full inspector flows.
3. The real-chat smoke script submits the first prompt twice; it cannot currently prove a clean two-turn conversation.
4. A green backend suite did not catch the reproduced content-index binding failure.
5. This is primarily a source and automated-test review. It does not establish pixel-level equivalence to a currently running Desktop reference.

## 3. Reconcile the previous roadmap first

Reference: `docs/planning/zcode-desktop-parity-roadmap-2026-09-14.md`, which reviewed revision `683d683`. There are 23 subsequent commits through this review baseline.

Do not reopen these broad themes as wholly missing:

- **Session context mismatch protection:** `/api/chat` rejects a conflicting canonical directory with `409 SESSION_CONTEXT_MISMATCH` (`server/index.js:686`).
- **Markdown sanitization:** `RichMarkdown` uses the fail-closed `safeMarkdown` pipeline (`web/src/lib/richmarkdown.tsx`, `web/src/lib/markdown.ts`). Preserve DOMPurify.
- **Run lifecycle correctness:** queued/running/stopping/terminal state transitions, failure tracking, and authoritative completion events exist (`server/zcode.js:250`, `server/zcode.js:288`).
- **Replay bounds:** the backend replay ring is bounded (`server/zcode.js:225`), and the client caps event retention.
- **Job-keyed client state:** the run manager exists; the remaining concern is ownership cleanup and alias retention, not absence of run isolation.
- **Responsive inspector constraints:** `effectivePanelWidth` is wired into rendering (`web/src/App.tsx:115`). Preserve the ZWUI-057 regression coverage.
- **Internal transcript filtering:** synthetic, hidden, model-only, and summary-user messages are filtered (`server/sessions.js:266`). The remaining problem is how filtering interacts with the earlier query cap and pagination.

The previous ZPAR-001–008 and ZPAR-012 themes have substantial verified fixes. ZPAR-013 and ZPAR-017 have partial fixes and should be split into remaining concrete cases, not marked wholly complete. Existing ZPAR-016 work should also be preserved. This report's task acceptance criteria, rather than broad historical labels, define the remaining work.

## 4. Prioritized findings register

Priority means execution urgency: **P0** before expanding exposure or declaring release readiness; **P1** for the next parity milestone; **P2** for maintainability, performance, and release quality. P0 is not a CVSS severity claim.

| Task | Priority | Finding | Evidence level |
| --- | --- | --- | --- |
| ZWUI-059 | P0 | Content indexing fails on SQLite parameter binding; watermark progression also needs correction | Reproduced + source-confirmed |
| ZWUI-060 | P0 | Lexical path checks do not establish filesystem containment across all routes | Source-confirmed |
| ZWUI-061 | P1 | Request-body settling and SSE ticket/reconnect contracts need hardening | Source-confirmed |
| ZWUI-062 | P1 | Transcript cap, totals, and offset pagination can lose or duplicate history | Source-confirmed |
| ZWUI-063 | P1 | Live answers and persisted turns lack a reliable fold; completion labels overclaim | Source-confirmed |
| ZWUI-064 | P1 | Live tool cards are event-keyed rather than call-keyed; details state is too broad | Source-confirmed |
| ZWUI-065 | P1 | Bootstrap failure can leave a loader; preference writes bypass reactive state | Source-confirmed |
| ZWUI-066 | P1 | Multiple document-level dialog handlers need coordinated ownership | Hardening / verification |
| ZWUI-067 | P1 | Pinned/hidden navigation and status copy do not reliably describe actual state | Source-confirmed |
| ZWUI-068 | P1 | Browser fixtures omit important capability, auth, and search paths | Source-confirmed |
| ZWUI-069 | P2 | Large initial bundle and eager feature loading need measured optimization | Measured + verification |
| ZWUI-070 | P2 | Lugas backend and Docker build lack a demonstrated equivalent contract | Source-confirmed + verification |
| ZWUI-071 | P2 | README/API/release documentation drift from implementation | Source-confirmed |
| ZWUI-072 | P2 | Cleanup remains in run retention, parsing, cancellation, uploads, and preview policy | Source-confirmed + hardening |
| ZWUI-073 | P1 | Smoke script double-sends; browser bundle-size assertion can pass vacuously | Source-confirmed |

## 5. Detailed execution tasks

### ZWUI-059 — Restore reliable content search

**Priority:** P0. **Owner:** backend + test engineer. **Dependencies:** none. **Size:** small/medium.

**Evidence and impact**

`server/sessions.js:540` calls `.all(through, through + chunk, scope.params, chunk)`. `node:sqlite` does not accept the parameter array as one scalar binding. A direct index probe failed with `ERR_INVALID_ARG_TYPE`: `Provided value cannot be bound to SQLite parameter 3.` Content search cannot reliably build its index. The index watermark also advances using `Math.min(through + chunk, total)`, conflating scan position with row count.

**Implementation**

- [ ] Spread scope parameters in the prepared statement, preserving placeholder order.
- [ ] Define the watermark in terms of the actual source key scanned, not a count of rows. Handle sparse keys and scope-filtered gaps explicitly.
- [ ] Keep progress and FTS writes consistent; use an atomic chunk update where appropriate and make retry/restart idempotent.
- [ ] Report index failure as a recoverable error, not an empty result set or permanently loading search.
- [ ] Preserve source-database read-only access; only write to the sidecar index.

**Acceptance and tests**

- [ ] Index and find known message text in a scoped workspace using a temporary SQLite fixture.
- [ ] Cover empty scopes, several chunks, sparse/deleted keys, restart/resume, and newly appended messages.
- [ ] Verify no results from another workspace and no duplicate FTS entries after retry.
- [ ] Add a browser search scenario after ZWUI-068 fixture support.

### ZWUI-060 — Centralize realpath containment and session authorization

**Priority:** P0. **Owner:** backend + security reviewer. **Dependencies:** none. **Size:** medium/large.

**Evidence and impact**

`safeCwd` is lexical (`server/index.js:110`). Session detail (`:495`), artifacts (`:602`), rename (`:641`), and file serving (`:911`) do not all enforce the same resolved-filesystem policy. The artifact handler's `if (sess)` check deserves an explicit missing-session case. A lexically in-root path can resolve through a symlink outside the allowed root. The canonical-directory check in chat is a useful existing control but not a substitute for a common policy across routes.

**Implementation**

- [ ] Introduce one canonical root/cwd resolver and one session-access helper, reused by all relevant routes.
- [ ] Resolve existing paths and enforce containment using path components, not a raw prefix comparison. Define treatment of the root itself.
- [ ] For new files, validate the resolved existing parent; reject symlink escapes. Document residual time-of-check/time-of-use assumptions.
- [ ] Inventory file reads, attachments, artifacts, previews, session lookup/rename, and Git cwd selection against the same policy.
- [ ] Return stable 400/403/404 errors without leaking unauthorized filesystem paths or session metadata.

**Acceptance and tests**

- [ ] Reject sibling-prefix paths, `..` traversal, symlinks to external directories/files, and out-of-scope sessions.
- [ ] Test missing sessions, root equality, valid in-root symlinks according to the chosen policy, and legitimate nested workspaces.
- [ ] Preserve `SESSION_CONTEXT_MISMATCH` behavior and test it alongside the new policy.
- [ ] Complete an evidence-based security review before enabling broader file access.

### ZWUI-061 — Make request and SSE lifecycle contracts explicit

**Priority:** P1; do before multi-user exposure. **Owner:** backend + frontend. **Dependencies:** none. **Size:** medium.

**Evidence and impact**

`readBody` lacks a settled guard (`server/index.js:78`). SSE tickets remain reusable until expiry (`:52`), while the server's ticket-expired marker is unreachable after the invalid-ticket 401 branch (`:1063`). The client marks attachment at EventSource construction, before an open event (`web/src/state/stream.ts:62`), and an EventSource cannot attach an arbitrary bearer header (`:56`).

**Implementation**

- [ ] Make body parsing settle once on success, oversize, malformed input, abort, and stream error; clean up listeners.
- [ ] Define tickets as short-lived, narrowly scoped connection credentials and consume them atomically on successful attachment.
- [ ] On reconnect, obtain a new ticket and carry the last observed event ID through a supported mechanism. Do not rely on a marker that cannot arrive.
- [ ] Remove the impossible bearer-header fallback; never place the long-lived bearer token in an SSE URL.
- [ ] Set connected state from the actual open event; bound retries/backoff and terminate retries for terminal jobs or disposed views.

**Acceptance and tests**

- [ ] Body abort/oversize/error cases produce one response and no unhandled rejection.
- [ ] Test expired, reused, wrong-job, and concurrent use of a ticket.
- [ ] Reconnect recovers missed events exactly once; terminal jobs do not reconnect forever.
- [ ] UI distinguishes connecting, connected, reconnecting, and failed states without logging credential-bearing URLs.

### ZWUI-062 — Make history complete, stable, and honestly paginated

**Priority:** P1. **Owner:** backend + frontend. **Dependencies:** preserve ZWUI-058 filters. **Size:** large.

**Evidence and impact**

`server/sessions.js:239` fetches at most 6,000 parts before grouping and internal-message filtering. Visible history can be cut mid-message or crowded out by filtered parts. Totals at `:334` describe the retained window, not necessarily full visible history. The UI uses shifting offsets (`web/src/components/ChatPanel.tsx:549`) and prepends without ID-based deduplication (`:550`). Concurrent inserts can shift pages.

**Implementation**

- [ ] Page by stable visible-turn/message identity, with deterministic timestamp-plus-ID ordering and a cursor.
- [ ] Ensure the page boundary does not split multipart messages. Apply visibility rules before computing visible pagination metadata, or scan enough chunks to satisfy it.
- [ ] Return explicit `hasMore`, cursor, and truncation/count semantics. Do not present a capped-window count as a complete total.
- [ ] Merge older and refreshed history by stable ID, preserving chronological order and scroll position.
- [ ] Cancel or ignore stale requests when switching sessions; maintain bounded query work.

**Acceptance and tests**

- [ ] Fixtures exceed 6,000 parts and include multipart, synthetic, hidden, model-only, and summary-user messages.
- [ ] Loading older history while new turns arrive never duplicates or skips visible IDs.
- [ ] Equal timestamps, empty visible pages, session switches, and failed page fetches are deterministic.
- [ ] Existing internal-message filtering and user-echo retirement tests remain green.

### ZWUI-063 — Reconcile live and persisted answers; stop overclaiming completion

**Priority:** P1. **Owner:** frontend. **Dependencies:** coordinate with ZWUI-062 identity contract. **Size:** medium.

**Evidence and impact**

The live answer block remains separately rendered (`web/src/components/ChatPanel.tsx:1035`) without a robust persisted-message fold. Any succeeded phase can produce `Plan ready` or `Task completed` (`:1111`), while error turns still use a checkmark (`:983`). Process success does not prove a plan artifact exists or the user's task is complete.

**Implementation**

- [ ] Correlate the live run with authoritative persisted assistant message IDs. Fold only after matching persisted content is available.
- [ ] Preserve live output through delayed persistence, failure, cancellation, and transient refresh errors.
- [ ] Derive status from actual terminal outcome; use neutral `Run finished` language unless a specific result is known.
- [ ] Render separate failure/cancel/success indicators with accessible labels.

**Acceptance and tests**

- [ ] Delayed persistence produces no blank interval and no lasting duplicate answer.
- [ ] Reopening a session, reconnecting, switching views mid-run, and retrying a failed run preserve the correct transcript.
- [ ] Successful process exit with no plan artifact does not claim `Plan ready`.
- [ ] Error and canceled turns never display a success checkmark.

### ZWUI-064 — Render tool lifecycles by call identity

**Priority:** P1. **Owner:** frontend. **Dependencies:** coordinate with ZWUI-063. **Size:** medium.

**Evidence and impact**

Live tool cards are derived per event (`web/src/components/ChatPanel.tsx:744`), while the terminal drawer already groups by call ID (`:719`). The two views can disagree about counts and state. A global `detailsHidden` state also couples unrelated turn details.

**Implementation**

- [ ] Share a pure call-ID reducer between live tool cards and the terminal/tool drawer.
- [ ] Merge start, progress, output, and terminal events into one card per call; handle replay idempotently.
- [ ] Key expansion by session/turn/call identity rather than one global switch.
- [ ] Retain ordering, failure state, partial output, and bounded rendering for large output.

**Acceptance and tests**

- [ ] Repeated/progress/out-of-order events do not create extra cards or revert a terminal state.
- [ ] Concurrent calls retain separate names, arguments, output, and status.
- [ ] Expanding one turn does not change another; keyboard controls have correct expanded-state semantics.

### ZWUI-065 — Recover from bootstrap failures and make preferences reactive

**Priority:** P1. **Owner:** frontend. **Dependencies:** none. **Size:** medium.

**Evidence and impact**

`if (!caps)` shows an indefinite loader (`web/src/App.tsx:434`). Authentication recovery relies on `!caps.workspaceRoot` (`:777`) rather than an explicit auth state. App reads preferences each render (`:36`) and pin/hide callbacks call bare `savePrefs` (`:491`), bypassing `WorkspaceProvider.updatePrefs`. Token helpers are also duplicated in App and auth modules.

**Implementation**

- [ ] Model bootstrap as loading, ready, unauthorized, unavailable, and retrying; retain safe error context and a retry action.
- [ ] Determine authentication failure from response status rather than missing capability fields.
- [ ] Route pin/hide and other preference changes through the provider's reactive update method.
- [ ] Use one token storage abstraction; handle storage denial and malformed stored preferences safely.

**Acceptance and tests**

- [ ] Unreachable server, 401, malformed response, and later recovery all have usable UI states.
- [ ] Pin/hide changes appear immediately without a reload and persist correctly after reload.
- [ ] Token clearing affects all consumers consistently; no production token enters fixtures or logs.

### ZWUI-066 — Coordinate overlays, focus, and keyboard ownership

**Priority:** P1. **Owner:** frontend + browser tester. **Dependencies:** none. **Size:** medium.

**Evidence and impact**

Dialogs use shared `useDialogA11y` (`web/src/components/ui.tsx`), but multiple document-level Escape handlers can conflict. This is a coordination risk requiring a focused interactive test, not proof that every dialog is inaccessible.

**Implementation**

- [ ] Give the topmost modal exclusive Escape/focus ownership; restore focus to its valid triggering control.
- [ ] Define layering and background inertness for settings, search, analytics, inspector overlays, and menus.
- [ ] Coordinate global shortcuts with editable fields and active dialogs.
- [ ] Preserve full-screen/narrow viewport behavior and visible close controls.

**Acceptance and tests**

- [ ] Escape closes only the topmost layer and focus returns to the expected control.
- [ ] Tab/Shift+Tab stay within a modal; closed overlays leave no keyboard handlers or scroll locks behind.
- [ ] Cover 360px, 390px, 850px, and desktop widths, including keyboard-only navigation.

### ZWUI-067 — Make navigation and status copy reflect actual state

**Priority:** P1. **Owner:** frontend. **Dependencies:** ZWUI-065. **Size:** medium.

**Evidence and impact**

Pinned rows disappear when absent from the latest 50 sessions (`web/src/App.tsx:554`). Several labels claim `All changes saved`, `Workspace synced`, or `1 running` without corresponding reliable state (`:478`, `:713`, `:718`). Changes displays raw two-character Git status codes (`web/src/components/RightPanel.tsx:452`). Settings retains a `Demo mode` label (`web/src/components/SettingsDialog.tsx:94`).

**Implementation**

- [ ] Resolve pinned session IDs independently of the recent-page window, including unavailable/deleted states.
- [ ] Add discoverable hidden-session management and restoration; distinguish local hiding from deletion.
- [ ] Derive running counts from unique active runs. Remove save/sync claims unless backed by a real state machine.
- [ ] Decode staged/unstaged Git states with readable text and accessible indicators.
- [ ] Align settings labels with actual behavior and disabled capability explanations.

**Acceptance and tests**

- [ ] A pinned session older than the latest page remains reachable after reload.
- [ ] Hidden sessions can be restored; hiding never deletes session data.
- [ ] Zero, one, and several concurrent runs show correct counts with no alias double-counting.
- [ ] Modified, added, deleted, renamed, untracked, and conflict states are understandable without Git code knowledge.

### ZWUI-068 — Expand browser coverage to real supported flows

**Priority:** P1. **Owner:** test engineer. **Dependencies:** ZWUI-059/060/065; coordinate ZWUI-073. **Size:** medium.

**Evidence and impact**

The root `package.json` `serve:test` command does not enable `ZCODE_ENABLE_FILES` or `ZCODE_ENABLE_GIT`. The browser suite (`web/tests-browser/workspace.spec.ts`) therefore cannot establish normal Files/Changes behavior with its current server. Auth bootstrapping needs tests that do not simply inject localStorage.

**Implementation**

- [ ] Add isolated capability-enabled fixtures with temporary workspace files and a temporary Git repository.
- [ ] Test capability-disabled UI separately; do not enable access to developer home directories.
- [ ] Cover first-load bootstrap, wrong-token recovery, reload, and credential removal through visible UI.
- [ ] Exercise search indexing, file navigation, Git changes/diff, session context mismatch, and run switching.
- [ ] Keep fake credentials and deterministic CLI fixtures; rebuild before testing the served bundle.

**Acceptance and tests**

- [ ] Enabled and disabled capability suites assert actual content, not just panel headings.
- [ ] Fixtures clean up their own files and do not mutate production sessions or repositories.
- [ ] Browser tests remain deterministic without a live paid model/provider dependency.

### ZWUI-069 — Reduce initial load cost with measured boundaries

**Priority:** P2. **Owner:** frontend. **Dependencies:** ZWUI-073 measurement fix. **Size:** medium.

**Evidence and impact**

The production main bundle is approximately 549.59 KB raw / 169.62 KB gzip and emits a chunk warning. Heavy secondary surfaces such as analytics and rich inspectors should not automatically inflate the initial conversation load.

**Implementation**

- [ ] Record initial and post-interaction JavaScript sizes using real files or response bodies.
- [ ] Lazy-load appropriate dialogs, analytics, and heavy inspector features; provide loading/error boundaries.
- [ ] Profile transcript rendering and large tool output before choosing memoization or virtualization.
- [ ] Establish explicit raw/compressed initial-load budgets from the measured baseline and preserve responsive interaction.

**Acceptance and tests**

- [ ] Record before/after sizes and scenario timings on the same fixture/environment.
- [ ] Secondary feature chunks load on demand without broken focus, lost state, or blank dialogs.
- [ ] A production build plus browser suite verifies the split output, not the dev server alone.

### ZWUI-070 — Decide and document the supported backend contract

**Priority:** P2; promote to release blocker if shipping Lugas. **Owner:** backend + release owner. **Dependencies:** contract from ZWUI-071. **Size:** medium/large.

**Evidence and impact**

`server-lugas/` is behind the Node backend contract. `Dockerfile.lugas:32` copies host `node_modules`, making the image dependent on local artifacts and potentially incompatible dependencies. Supporting two server implementations without shared contract tests creates misleading deployment expectations.

**Implementation**

- [ ] Recommended default: identify Node as the supported production backend and Lugas as experimental until contract tests pass.
- [ ] Record an explicit maintain/bring-to-parity/archive decision; do not silently remove the alternative implementation.
- [ ] If maintained, install dependencies reproducibly inside the image from lockfiles rather than copying host `node_modules`.
- [ ] Run a shared route/auth/SSE/session/files/error contract suite against every backend advertised as supported.

**Acceptance and tests**

- [ ] A clean-checkout container build works without host dependencies. (The Dockerfile now installs `server-lugas` dependencies in-image from the lockfile instead of copying host `node_modules`; an actual clean-checkout build has not been run yet.)
- [ ] Support labels match demonstrated behavior; unsupported features fail explicitly rather than pretending success. (The Dockerfile header comment now calls Lugas experimental — a documentation change only; no behavior test exists yet.)
- [ ] No claim of Lugas parity until the common contract suite passes.

### ZWUI-071 — Bring documentation and release gates into alignment

**Priority:** P2. **Owner:** documentation + backend reviewer. **Dependencies:** merge alongside changed contracts. **Size:** medium.

**Evidence and impact**

README duplicates `Zero npm dependencies` (`README.md:34`) and omits newer API routes. `web/README.md` remains the Vite template. `api-contracts.md:3` says all routes except static/ticketed SSE require bearer auth, but `/api/bootstrap` is intentionally public (`server/index.js:1137`). `renameSession` writes the CLI database (`server/sessions.js:580`), conflicting with blanket read-only descriptions.

**Implementation**

- [ ] Inventory every actual API route, capability gate, auth exception, request/response shape, and error code.
- [ ] Explain public bootstrap's intended trust boundary and deployment constraints without publishing credentials.
- [ ] Document the session-rename write exception, locking/failure behavior, and scope controls; do not imply the entire source database is read-only.
- [ ] Replace frontend template instructions with actual development, build, test, and troubleshooting commands.
- [ ] Refresh release gates, backend support status, and links to this plan; retain the earlier roadmap as historical context.

**Acceptance and tests**

- [ ] Route inventory is checked against handlers, including tickets, search, artifacts, uploads, preview, and rename.
- [ ] Commands work from a clean checkout using the documented cwd.
- [ ] No `.env`, production tokens, private payloads, or server-side GitHub credentials are included.

### ZWUI-072 — Targeted reliability and security hygiene

**Priority:** P2; escalate individual subitems when the relevant capability is enabled. **Owner:** backend + frontend + security reviewer. **Dependencies:** ZWUI-060/061/065. **Size:** large; split into focused PRs.

**Evidence and impact**

- `web/src/state/runManager.ts:255`: rekeying retains aliases; `releaseView` exists but App does not use it. Cleanup needs an ownership contract.
- `web/src/workspace.tsx:75`: memoized context mutation (`__refresh`); an unused `runs: RunRegistry` declaration adds confusion.
- `server/zcode.js:232`: JSONL parsing concatenates decoded chunks without a `StringDecoder`, risking split multibyte characters.
- `server/zcode.js:329`: cancellation kills the direct child, not necessarily its descendants.
- `server/index.js:574`: timestamp-only upload names can collide; `:711` silently truncates attachments to five.
- `server/index.js:383`: preview snapshot IDs hash cwd/size/count rather than content; `:391` uses regex-based script removal; `:944` serves preview same-origin despite the separate-origin direction in the threat model.

**Implementation — separate work packages**

- [ ] **072a, client lifecycle:** remove aliases once no owner needs them; dispose subscriptions with a documented retention policy, without killing background runs on view switch. Remove context mutation and unused state declarations; resolve lint categories rather than suppressing them.
- [ ] **072b, process reliability:** use streaming UTF-8 decoding; test malformed/partial JSONL. Define supported-platform child-process-tree cancellation and escalation, ensuring unrelated processes cannot be signaled.
- [ ] **072c, uploads:** use collision-resistant names, explicit count/size/type errors, ownership-aware retention, and safe cleanup. Do not silently drop excess attachments.
- [ ] **072d, preview/security:** keep preview disabled by default. Before enabling active/untrusted previews, implement separate-origin isolation and restrictive sandbox/CSP rules; regex stripping is not a security boundary. Hash actual content for snapshot identity and review response headers per content type.

**Acceptance and tests**

- [ ] Repeated session/run switching stabilizes retained entries/listeners and preserves legitimate background runs.
- [ ] A multibyte character split across stdout chunks survives parsing intact.
- [ ] A fixture that spawns a descendant process is fully stopped on supported platforms without signaling unrelated processes.
- [ ] Concurrent same-timestamp uploads do not overwrite each other; too many attachments return an explicit error.
- [ ] Equal-size preview edits change snapshot identity. Preview isolation tests prove no authenticated parent-origin access before the capability is enabled.

### ZWUI-073 — Repair the release proof itself

**Priority:** P1; run early so later work has trustworthy gates. **Owner:** test engineer. **Dependencies:** none. **Size:** small/medium.

**Evidence and impact**

`scripts/real-chat-smoke.mjs:98` fills and submits turn one; `:113` then calls `sendAndWait(page, T1)`, which fills and submits again (`:59`). `web/tests-browser/a11y-perf.spec.ts:34` sums optional Content-Length headers, so absent headers can turn the JavaScript budget assertion into a zero-byte pass.

**Implementation**

- [ ] Submit each smoke prompt from exactly one helper; assert the expected number and identity of user turns.
- [ ] Preserve explicit provider-failure reporting; distinguish environmental unavailability from a product regression and from success.
- [ ] Measure JavaScript using response bodies or built artifact sizes, with clear raw versus compressed units.
- [ ] Fail the size test if no JavaScript was measured; add a regression fixture with absent Content-Length.
- [ ] Consider convenience `typecheck`/`test:e2e` scripts so documented gates cannot silently target the wrong directory.

**Acceptance and tests**

- [ ] A deterministic smoke fixture observes exactly two submissions for a two-turn scenario.
- [ ] The budget assertion fails on an oversized script even without Content-Length and never passes with zero observed scripts.
- [ ] A live-provider smoke run is optional, explicitly authorized, and reads credentials only at runtime; it never logs them.

## 6. Recommended execution order and PR boundaries

Keep changes independently reviewable. Each implementation PR should include its focused regression tests and update task checkboxes only when acceptance evidence exists.

| Sequence | Tasks | Exit condition |
| --- | --- | --- |
| 1 | ZWUI-059 and ZWUI-073, separate parallel PRs | Search works on real SQLite fixtures; smoke and size gates measure what they claim |
| 2 | ZWUI-060 | Unified scope policy passes traversal/symlink/session tests and security review |
| 3 | ZWUI-061 | Reconnect, body abort, ticket replay, and terminal cleanup are deterministic |
| 4 | ZWUI-062 then ZWUI-063 | Stable complete history and exactly one visible authoritative answer |
| 5 | ZWUI-064 and ZWUI-065 | Call-ID tool lifecycle and immediate preference/auth recovery behavior |
| 6 | ZWUI-066, ZWUI-067, ZWUI-068 | Keyboard, navigation, capabilities, and visible auth flows covered end to end |
| 7 | ZWUI-069 and ZWUI-072 work packages | Measured load improvements and bounded resource/security behavior |
| 8 | ZWUI-070 and ZWUI-071 | Supported deployment contract and documentation agree with release evidence |

Documentation should accompany contract changes rather than waiting entirely for sequence 8. Independent UI work can run in parallel, but avoid concurrent edits to ChatPanel without an agreed identity/state contract. ZWUI-072 preview work becomes a blocker immediately if preview is proposed for enablement.

## 7. Verification commands and required evidence

Run from the repository root. These commands are the established baseline; any convenience scripts added later must preserve their coverage.

```bash
cd /home/ther12k/Workspace/ZCode/zcode-web
web/node_modules/.bin/tsc -b web/tsconfig.json --force
web/node_modules/.bin/vitest run --root web
node --test tests/server.test.mjs
npm --prefix web run lint
npm --prefix web run build
npx --prefix web playwright test --config web/playwright.config.ts
git diff --check
```

Build before Playwright: the browser-test server serves built output. SSE can keep connections open, so browser readiness should use visible state or `domcontentloaded`, not a global `networkidle` assumption.

For each PR, attach:

1. Reviewed commit and exact commands/results, including failures and skipped checks.
2. A regression test that fails before the fix and passes after, where the defect is deterministic.
3. Contract/schema changes and compatibility impact, if any.
4. Responsive screenshots for affected UI at phone, rail, and desktop widths; compare against an explicitly identified Desktop reference when claiming visual parity.
5. Security-review evidence for path/auth/ticket/preview/upload/process changes.
6. A clean secret scan and confirmation that `.env` remains ignored and uncommitted.

## 8. Non-negotiable constraints

- Never commit `.env` or deployment tokens; use only fake tokens in fixtures.
- Keep GitHub credentials server-side. Do not move privileged credentials into browser state, built bundles, logs, or URLs.
- Preserve DOMPurify sanitization, ticketed SSE authentication, canonical session-context protection, and existing responsive/transcript regressions.
- Keep the CLI source database read-only except for the explicitly reviewed/documented rename path; use a sidecar for search indexes.
- Do not enable preview, broaden file access, replace the deployment backend, or deploy as a side effect of these tasks.
- Do not claim run success means the user's task is complete, or test-suite success means Desktop parity.

## 9. Definition of done for the next parity milestone

- [ ] P0 tasks pass focused regressions and security review.
- [ ] Content search indexes and returns scoped results without binding errors.
- [ ] History remains ordered, complete within its declared contract, and duplicate-free while new messages arrive.
- [ ] Live-to-persisted handoff, tool lifecycle, cancel/fail/success states, and reconnect behavior are truthful.
- [ ] Preference updates, older pinned sessions, hidden-session restoration, and auth recovery work through visible UI.
- [ ] Dialog keyboard ownership and phone/rail/desktop layouts pass scenario-based acceptance checks.
- [ ] Browser fixtures cover both enabled and disabled capabilities, and release measurements cannot pass vacuously.
- [ ] Documentation identifies the supported backend and all auth/write exceptions accurately.
- [ ] All baseline gates pass; any remaining lint warnings and deliberate limitations are explicitly recorded.
- [ ] Visual/behavioral parity is reported by tested scenario, not an unsupported percentage.

**Review conclusion:** the next iteration should repair search and enforce consistent filesystem boundaries first, then improve transcript/run fidelity and state-driven UI. The task list above is the implementation handoff; this review does not mark those fixes as completed.
