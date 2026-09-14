# ZCode Web → ZCode Desktop Parity Roadmap

**Audit date:** 2026-09-14  
**Repository:** `ther12k/zcode-web`  
**Audited revision:** `683d683` (`main`, equal to `origin/main` before this document was created)  
**Current production runtime:** Node 24 server, modern Vite/React UI, host-shared ZCode state  
**Purpose:** Evidence-based review and implementation plan. This document does not claim that the work below is already implemented.

---

## 1. Executive conclusion

The current application has a strong parity foundation. It uses the CLI-owned session database, can resume sessions, renders recent ZCode transcript structures, follows Desktop-created updates without replacing the open transcript, exposes real models/modes/skills/commands, and now shows the latest 50 sessions across configured roots.

It is **not yet behaviorally equivalent to ZCode Desktop**. The largest remaining problems are not color, spacing, or icons. They are state and truthfulness problems:

1. A session selected from another project can open under the wrong `cwd` and later send a prompt to that wrong directory.
2. The server does not enforce the canonical relationship between a session and its stored directory before `--resume`.
3. A cancelled Node job can remain in memory with an open SSE stream and cannot be force-killed after `SIGTERM` is ignored.
4. A lost stream is converted into a terminal frontend failure even though the server job explicitly continues running.
5. The production chat bypasses the fail-closed Markdown helper covered by the unit suite and instead uses the separate renderer in `web/src/ui.tsx`.
6. A new browser with no token, or a browser with an invalid token, can remain on “Opening your workspace…” without reaching the access prompt.
7. The declared replay limit is not applied; server and browser event arrays can grow without bound.
8. History still uses shifting offsets and a silent 6,000-part window, so very long or concurrently updated sessions are not fully reliable.
9. Runs are owned by `ChatPanel`, not by the workspace. Navigating away hides the active job and prevents reliable reattachment.
10. Mobile navigation and the mobile inspector controls are styled in CSS but not wired in the React state.
11. The optional Lugas server is substantially behind the production Node contract and must not be treated as a drop-in current server.

### Recommendation

Do **not** start another large visual redesign. Keep the current graphite/sage interface and complete the work in this order:

1. **Correctness and security boundary** — authentication, canonical session/cwd, cancellation, job outcome, Markdown, protected media, path containment.
2. **One durable run/session model** — workspace-owned jobs, reattachment, stable history cursors, one canonical transcript.
3. **Chat interaction parity** — single working row, truthful footers, structured tools, capable attachments and commands.
4. **Navigation, responsive behavior, and accessibility** — working mobile drawers, real panel expansion, pinned-session durability, correct focus/keyboard semantics.
5. **Runtime convergence and release proof** — shared server core or a single supported runtime, full contract tests, real Desktop comparison, current documentation.

This order matters. Polishing the chat while session identity and run ownership are still wrong would make the product look trustworthy before it is trustworthy.

---

## 2. Audit scope and evidence

### 2.1 Source reviewed

- React shell, navigation, preferences, dialogs, inspector, chat and live stream handling under `web/src/`
- Node API, SQLite session adapter and CLI job manager under `server/`
- Lugas/Bun alternative server under `server-lugas/`
- Browser, unit and backend suites under `web/tests-browser/`, `web/src/**/__tests__/` and `tests/`
- Dockerfiles, Compose configurations, CI workflow, README and baseline/planning documents
- Git history from the original UI plan baseline through `683d683`
- All GitHub issues in `ther12k/zcode-web` (43/43 are currently closed)
- The deployed application at `http://127.0.0.1:3000`, using read-only navigation/DOM inspection

### 2.2 Verification run against `683d683`

| Gate | Result | Evidence |
|---|---:|---|
| Frontend production build | Pass | Vite built 2,019 modules; JS 492.87 KB raw / 153.66 KB gzip; CSS 91.43 KB raw / 19.57 KB gzip |
| Frontend unit tests | 16/16 pass | Markdown and run reducer suites |
| Browser tests | 23/23 pass | Chromium, built UI, real Node API, fake CLI |
| Backend/security tests | 25/25 pass | Node test runner, fake CLI and synthetic SQLite fixtures |
| Lint | 0 errors, 12 warnings | Hook dependencies, memo mutation, compiler compatibility and component-export warnings remain |
| Active deployment | Healthy | `docker-compose.host.yml`, modern UI, Node `server/index.js`, port 3000 |
| Repository state before audit document | Clean | `main` equal to `origin/main` at `683d683` |

Passing these suites proves the covered behaviors. It does not prove the uncovered parity requirements listed below.

### 2.3 Important source-of-truth correction

The current Sessions view **does implement the latest 50 sessions across all allowed roots**:

- Client request: `web/src/App.tsx:218-241`
- Per-row project chip: `web/src/App.tsx:644-660`
- Global server route: `server/index.js:692-711`
- Global store query: `server/sessions.js:162-171`
- Live DOM audit showed 50 cross-project rows with project labels.

Older project-scoped code shown in previous excerpts came from the pre-`683d683` revision. Project-scoped loading still exists intentionally in the separate Projects view.

---

## 3. What is already strong and should be preserved

These are assets to build on, not areas to rewrite casually.

### 3.1 Shared ZCode data and execution boundary

- The CLI remains the execution engine and owner of normal session/message/part persistence.
- Host-share mode points the browser and Desktop app at the same `~/.zcode` and workspace files.
- The web session reader opens the ZCode SQLite store read-only for transcript access.
- Model provider keys stay on the server; the browser receives only model metadata.
- CLI execution uses an explicit Node runtime when hosted by Bun.

### 3.2 Transcript fidelity already implemented

- Stable message IDs are returned to the frontend.
- Reasoning is separated from answer text.
- Tool and file parts remain associated with their logical message.
- Desktop timeline events render for model changes, compaction, forks and goal verification.
- Duplicate compaction records are deduplicated by operation ID.
- `turn_usage.duration_ms` drives Desktop-like “Worked for …” footers.
- Separator-only messages do not steal the previous answer’s footer.
- Provider/CLI errors remain structured data and are shown in collapsed details rather than being injected into the answer.
- User-message attachments are rendered.
- Missing/pruned artifacts degrade to an explanatory state.

Relevant implementation: `server/sessions.js:209-357`, `web/src/components/ChatPanel.tsx:629-717`.

### 3.3 Desktop ↔ web follow behavior

- The open transcript merges turns by message ID rather than flashing a full reload.
- Paged-in older turns are retained during ordinary latest-page refresh.
- Visibility refresh and polling discover Desktop-created changes.
- A fresh incomplete assistant tail locks the composer and shows elapsed activity.
- A jump-to-latest control appears after the reader scrolls away.
- Older-message prepending attempts to preserve the reading anchor while layout settles.

Relevant implementation: `web/src/components/ChatPanel.tsx:100-202`, `460-495`, `602-607`, `767-780`.

### 3.4 Composer foundation

- Multiline input, IME send guard, paste/drop/file selection and attachment-only sends exist.
- Model and mode values originate from server configuration.
- The slash palette includes local actions, mode changes, `/compact`, `/fork` and CLI-discovered project/user commands.
- Per-session/project drafts are stored separately.
- The send button locks for a locally attached run or an externally detected active turn.

### 3.5 Security work that must not regress

- Bearer-token API protection is implemented for the production Node server.
- SSE uses job-scoped tickets instead of placing the long-lived bearer token in the URL.
- Base64 uploads have strict validation and size limits.
- Attachment paths are restricted to the upload directory before CLI invocation.
- Workspace file APIs are capability-gated and text/size bounded.
- Git inspection is read-only.
- Real credentials, the proprietary CLI bundle, `.env`, build output and dependency directories are ignored by Git.

### 3.6 Useful current UI direction

The current shell already has a reasonable ZCode-like visual language: compact sidebar, explicit project/session context, graphite surfaces, muted sage accents, anchored composer, collapsible details, grouped models, timeline separators and an optional workspace inspector. The next parity pass should refine this system, not replace it with a new design framework.

---

## 4. Priority findings

Priority meanings in this document:

- **P0:** blocks a trustworthy parity claim or can cause wrong-context execution, false run state, or a security-boundary failure.
- **P1:** materially harms ordinary use, long-session fidelity, responsive operation, or maintainability.
- **P2:** refinement that should follow the state/lifecycle work.

## 4.1 P0 — Correctness, lifecycle and security blockers

### ZPAR-001 — Canonical session directory is not enforced

**Evidence**

- Global and project session rows call `selectSession(id)` without the row directory: `web/src/App.tsx:243-251`, `web/src/App.tsx:342-367`, `web/src/App.tsx:620-627`.
- `selectSession` navigates using the currently open `cwd`, unlike Search, which uses the selected result’s directory: `web/src/App.tsx:444-450`.
- `/api/chat` accepts a syntactically valid `sessionId` and the separately supplied `cwd`, but does not compare that `cwd` with the session’s stored directory: `server/index.js:613-668`.
- The CLI is then spawned with both `--cwd <client cwd>` and `--resume <sessionId>`: `server/zcode.js:142-150`.
- The historical acceptance plan explicitly required rejecting project A session + project B cwd, but no current test covers it.

**Impact**

A user can click a cross-project session, see that transcript, then send its next prompt from the wrong project directory. Commands, Git branch, file inspector and tool execution can all be associated with the wrong context. This is the opposite of Desktop parity, where the session owns its project identity.

**Required change**

- Make every session selection carry `{id, directory}`.
- For deep links, load session metadata and canonicalize the route to `session.directory` if needed.
- Before spawning a resumed job, look up the session and either:
  - use its stored directory as authoritative, or
  - reject a mismatch with `409 SESSION_CONTEXT_MISMATCH`.
- Reject sessions outside configured allowed roots for detail, transcript, rename, artifact and resume routes.
- Treat route workspace as display/navigation state, never as authority over an existing session.

**Acceptance**

1. From project A, select a latest-50 row belonging to project B.
2. URL, breadcrumb, branch, commands, file inspector and composer all switch to B.
3. A crafted POST with B session + A cwd is rejected before a CLI process starts.
4. A deep link with the wrong workspace resolves to the session’s canonical allowed directory.

---

### ZPAR-002 — Authentication bootstrap can deadlock

**Evidence**

- The Node server protects every `/api/*` route except ticket-authenticated SSE: `server/index.js:979-989`.
- Capability discovery requests both `/api/health` and `/api/config`: `web/src/auth/bootstrap.ts:44-56`.
- While capabilities are null, App returns only “Opening your workspace…”: `web/src/App.tsx:253-255`.
- The token prompt is rendered only after capabilities exist and report `authRequired`: `web/src/App.tsx:494-500`.

**Impact**

A first-time user with no stored token cannot learn that authentication is required, because the request that would tell the UI this is itself unauthorized. An expired/wrong token has the same ambiguous loading state.

**Required change**

Use an explicit bootstrap state machine:

`loading → needs-token | ready | invalid-token | unavailable`

Recommended contract:

- Permit unauthenticated `GET /api/bootstrap` to return only `{authRequired, serverVersion}`; or
- Convert a 401 from health/config into `needs-token` without needing a successful config response.
- After token submission, validate once, show an inline invalid-token error on 401, and allow retry.
- Separate “server unavailable,” “CLI unavailable,” “provider unavailable,” and “database unavailable.”

**Acceptance**

- Empty storage on a protected deployment shows the access form, not an infinite loader.
- Wrong token stays on the form with a clear error and does not leak protected configuration.
- Correct token transitions to the workspace without a full page race.
- Logout clears protected query data, object URLs, active transports and token state.

---

### ZPAR-003 — Production Markdown does not use the tested fail-closed renderer

**Evidence**

- `web/src/lib/markdown.ts:14-41` implements and tests `safeMarkdown`, including unsupported-sanitizer fallback and stricter forbidden tags/attributes.
- The visible chat imports `Markdown` from `web/src/ui.tsx`.
- `web/src/ui.tsx:37-46` contains the renderer used in chat; it calls DOMPurify directly rather than the `safeMarkdown` function exercised by `web/src/lib/__tests__/markdown.test.ts`.

**Impact**

Security tests and production behavior can drift. The normal-browser XSS test passes, but the exact fail-closed boundary described by the product plan is not the component shipped to users.

**Required change**

- Keep one Markdown conversion/sanitization module.
- Make the production React component call that module.
- Remove the duplicate renderer.
- Centralize link rewriting (`noopener noreferrer`, allowed protocols), code block behavior and fallback indication.

**Acceptance**

Component/browser tests must cover stored and streamed payloads, event handlers, `javascript:` links, iframes/forms/style attributes, malformed Markdown and a forced sanitizer-unavailable path. The rendered fallback must be escaped plain text.

---

### ZPAR-004 — Protected media cannot reliably render with bearer auth

**Evidence**

- Artifact images and PDFs are assigned direct `/api/artifacts/...` URLs to `<img>` and `<iframe>`: `web/src/components/ChatPanel.tsx:449-456`, `991-1004`, `1029-1033`.
- Static preview is assigned direct `/api/preview/...` URLs: `web/src/components/RightPanel.tsx:96-113`.
- These browser elements cannot attach the bearer Authorization header used by the API.
- The Node server globally protects the routes: `server/index.js:982-986`.

**Impact**

On the normal protected deployment, authenticated API fetches work while transcript thumbnails, PDF frames and preview frames can receive 401 and degrade as if artifacts were missing.

**Required change**

- Fetch protected media through `ApiClient` with Authorization and render a revocable object URL; or mint narrow, short-lived media tickets.
- Revoke object URLs after the last consumer and on logout/session change.
- Do not put the long-lived bearer token in a media URL.
- Test uploaded media, Desktop artifact media and PDF handling under auth-enabled conditions.

**Acceptance**

A protected deployment renders a real image and PDF, emits no token-bearing URL, revokes object URLs on close/navigation, and distinguishes 401, 404/pruned and unsupported MIME states.

---

### ZPAR-005 — Node cancellation has a terminal-state and cleanup defect

**Evidence**

- `cancel()` marks the job terminal before the process exits: `server/zcode.js:243-249`.
- The scheduled SIGKILL checks `!TERMINAL.has(job.status)`; after setting `cancelled`, that condition is already false.
- `finish()` returns immediately for any terminal status: `server/zcode.js:207-220`.

**Impact**

If the CLI ignores SIGTERM, it is not force-killed. Even when it exits, `finish()` does not publish a terminal `done`, clear the timer, or schedule removal. SSE subscribers can continue receiving heartbeats and the job can remain in memory indefinitely.

**Required change**

Separate **requested state** from **process-terminal state**:

`running → stopping → cancelled`

- `cancel()` sets `stopping`, sends SIGTERM and always schedules a process-alive SIGKILL check.
- The process close/error path is the one place that finalizes `cancelled`, writes exit metadata, publishes one terminal event, clears timers/subscribers and schedules retention cleanup.
- Kill the process group/tree where supported, not only the direct child.

**Acceptance**

Tests must cover a cooperative process, a SIGTERM-ignoring process, a child/grandchild process, cancel-vs-close race and repeated cancel. Every case produces exactly one terminal state/event and leaves no live process, timer, subscriber or retained non-expiring job.

---

### ZPAR-006 — Stream loss is incorrectly converted to terminal job failure

**Evidence**

- After reconnect exhaustion, `StreamController` reports that the stream is lost but “the job keeps running”: `web/src/state/stream.ts:88-101`.
- Chat maps that callback to `submit-failed`: `web/src/components/ChatPanel.tsx:525-530`.
- `submit-failed` changes the run to terminal `failed`: `web/src/state/run.ts:129-130`.
- Terminal frontend phases ignore later authoritative job status: `web/src/state/run.ts:142-148`.

**Impact**

The composer can unlock while the server is still modifying the same session. A second submission can overlap the first. Later success cannot repair the false failure state.

**Required change**

- Introduce transport phases independent of job phases:
  - transport: `idle | ticketing | connecting | live | reconnecting | detached | auth-required | closed`
  - job: `submitting | queued | running | stopping | succeeded | failed | cancelled | timeout | unknown`
- Reconnect exhaustion sets transport `detached`; it does not finalize the job.
- Continue authoritative `/api/jobs/:id` reconciliation.
- Keep the composer locked until terminal status or an explicit `unknown` decision that requires user acknowledgement.
- If the server no longer knows the job after restart, reconcile from session history/run state and report uncertainty; never automatically resubmit.

**Acceptance**

Disconnect the SSE stream through all retry attempts while the fake CLI continues. The UI must retain output, show “Connection lost — work may still be running,” keep sending disabled, and transition to the server’s eventual terminal status without a duplicate job.

---

### ZPAR-007 — Agent failure can be displayed as success

**Evidence**

- The server final status is derived from spawn error, timeout and exit code only: `server/zcode.js:207-213`.
- The frontend records a `turn.failed` error but a later zero-exit `done` sets phase to `succeeded`: `web/src/state/run.ts:76-103`.
- A succeeded live run displays “Plan ready” or “Task completed”: `web/src/components/ChatPanel.tsx:743-754`.

**Impact**

If the CLI emits `turn.failed` and exits zero, the UI can show both an error and a success claim. Process exit is not proof that the requested task or tests succeeded.

**Required change**

- Track terminal evidence from CLI events in the server JobManager.
- `turn.failed` must make the job outcome failed even if the child exits zero.
- Distinguish transport/process completion from agent outcome.
- Remove generic “Task completed,” “Plan ready,” and “All changes saved” claims unless an authoritative event specifically supports them.
- Prefer Desktop-like neutral output: final answer + “Worked for …” when duration exists, and explicit failure/cancel/timeout states.

**Acceptance**

A fixture that emits `turn.failed` and exits zero is failed in API status, SSE terminal event and UI. A clean exit without a turn-completed event is `unknown`, not succeeded. No success footer appears beside an error.

---

### ZPAR-008 — Same-session concurrency and idempotency conflicts are not guarded

**Evidence**

- JobManager enforces only a global active-count limit: `server/zcode.js:109-140`.
- It has no active-job index by session/draft identity.
- Reusing a request ID returns the old job without comparing payloads: `server/index.js:628-639`, `server/zcode.js:119-129`.
- The original acceptance plan required same-key/different-payload conflict behavior, but automated test suites cover only identical-payload replay cases.

**Impact**

Two browser tabs, a lost-stream UI defect, direct API clients, or Desktop/web overlap can start concurrent turns on one session. Reusing an idempotency key with a different request silently points the caller at unrelated work.

**Required change**

- Index active jobs by canonical `sessionId`; for a new chat, use a server-issued draft/conversation key until the session ID arrives.
- Reject a second active run for the same session with `409 SESSION_BUSY` and the existing job summary when appropriate.
- Store a normalized request fingerprint beside every idempotency key.
- Same key + same fingerprint replays; same key + different fingerprint returns `409 IDEMPOTENCY_CONFLICT`.
- Coordinate with external run detection; where the DB shows another writer active and no owned job exists, reject or require an explicit safe recovery path.

**Acceptance**

Tests cover two tabs, Desktop/web overlap, same key/same body, same key/different body and a retry after terminal retention. Only one CLI process can own a session turn at a time.

---

### ZPAR-009 — Allowed-root checks are lexical and database prefix scopes overmatch

**Evidence**

- `safeCwd` validates `resolve()` paths but does not canonicalize symlinks: `server/index.js:106-118`.
- File reads similarly validate the lexical path before following it: `server/index.js:751-781`.
- Recent/search SQL uses `directory LIKE root || '%'`: `server/sessions.js:136-171`.

**Impact**

A symlink under an allowed root can point outside it. SQL scope `/workspace/app` also matches `/workspace/application`. This conflicts with UI claims that nothing outside allowed roots is exposed.

**Required change**

- Define one canonical path-policy module used by project, chat, command, files, Git, preview and session routes.
- Resolve existing targets with `realpath`; for creation, realpath the parent and validate the new basename.
- Define an explicit symlink policy and test it.
- Use `directory = ? OR directory LIKE ?` with a separator-appended descendant prefix.
- Apply the same policy to session metadata before transcript, rename and artifact access.

**Acceptance**

Sibling-prefix paths and symlinks escaping a root are rejected across every capability. Legitimate nested projects and the explicitly approved paste-attachment root continue working.

---

### ZPAR-010 — Preview does not meet its approved isolation contract

**Evidence**

- The threat model says preview must be served from a separate origin: `docs/baseline/preview-threat-model.md:8-15`.
- `ZCODE_PREVIEW_ORIGIN` is checked only as an enablement flag: `server/index.js:319-321`.
- The UI uses same-origin `/api/preview/...`: `web/src/components/RightPanel.tsx:96-113`.
- The server serves preview assets from the app API origin: `server/index.js:784-835`.
- Snapshot ID uses cwd + total bytes + file count, not file content: `server/index.js:323-376`.

**Impact**

The optional capability was marked closed even though its primary isolation rule is not implemented. Same-sized content changes can reuse a stale snapshot ID. The current deployed instance has preview disabled, which is the correct safe state.

**Required change**

Keep preview disabled until one of these is deliberately accepted:

1. Implement the separate preview origin exactly as designed, with no app token/cookies sent; or
2. Replace the threat model with a separately reviewed sandbox architecture and document residual risk.

Also derive IDs from actual content, add lifecycle/expiry, make stale state visible and test hostile HTML/SVG/CSS/navigation cases.

**Acceptance**

A preview document has a different origin from the app, cannot read app storage/cookies, cannot execute scripts or navigate the parent, cannot request unauthorized private files, and receives a new content hash when any copied byte changes.

---

## 4.2 P1 — Major parity and usability gaps

### ZPAR-011 — History pagination is offset-based and silently capped

**Evidence**

- Transcript input is capped to the newest 6,000 parts: `server/sessions.js:220-228`.
- `total` is calculated only from that window: `server/sessions.js:305-330`.
- The client loads older data using `offset = history.turns.length`: `web/src/components/ChatPanel.tsx:465-495`.
- Older pages are prepended without ID deduplication, while latest-page merging does deduplicate: `web/src/components/ChatPanel.tsx:118-138`, `486-489`.

**Impact**

Very long sessions can silently lose older messages. Desktop appends during an older-page request can shift offsets and produce duplicates or omissions. This is particularly important for long automations and heavily tooled turns.

**Required change**

- Page by stable message identity/sequence, not shifting offset.
- Query message IDs first, then fetch all parts for those exact messages.
- Return `nextBefore`, `snapshotUpperBound` and an honest total/completeness state.
- Remove the global part-row cap from correctness logic; use per-message/bounded pages.
- Merge every page by stable message ID.

**Acceptance**

A fixture with at least 1,000 messages and over 6,000 parts loads completely. Concurrent Desktop appends during scrollback create no duplicates, omissions or anchor jump.

---

### ZPAR-012 — Runs are owned by ChatPanel instead of the workspace

**Evidence**

- Comments claim an app-wide run registry, but `web/src/workspace.tsx:14-36` creates a Map that no feature consumes.
- ChatPanel owns the reducer, EventSource, active job and polling interval: `web/src/components/ChatPanel.tsx:51-82`, `223-275`, `503-550`.
- Navigation deliberately detaches and resets that run.
- Statusbar uses only the currently visible panel’s boolean and always says either `1 running` or `idle`: `web/src/App.tsx:430-440`.

**Impact**

After navigation, the server job continues but the workspace loses its stream/status/stop affordance. Returning to the session treats it as an external run. Multiple jobs cannot be represented accurately.

**Required change**

Move run ownership into a real app-level `RunStore` keyed by `jobId`, with secondary indices by session and draft context. The store owns:

- submission and idempotency keys;
- stream controller;
- reconciliation polling;
- accumulated render state;
- terminal retention;
- navigation-independent stop/reattach behavior.

ChatPanel should subscribe to the run matching the active session. Sidebar/statusbar should render all known active jobs. Add `GET /api/jobs?active=1` or another authenticated recovery contract so refresh can reattach to server-owned jobs.

**Acceptance**

Start a run in A, navigate to B, observe A as running globally, return to A and see the same output/job/stop action. No second EventSource or CLI process is created.

---

### ZPAR-013 — Persisted and live answers can become two separate assistant messages

**Evidence**

- History renders from the SQLite transcript.
- The local live block renders independently whenever `run.answer`, `run.reasoning`, `localBusy` or `run.error` exists: `web/src/components/ChatPanel.tsx:719-757`.
- The run is not folded into/reset after the corresponding persisted message appears.

**Impact**

A completed answer can appear once from the live reducer and again from the shared database. Local and external runs also use different visual/state paths, unlike Desktop’s single conversation timeline.

**Required change**

Create one normalized transcript projection:

- persisted messages are authoritative;
- a local in-flight turn is an overlay keyed by job/turn/message ID;
- once the persisted assistant message covers the overlay, atomically replace/fold it;
- external incomplete messages and local streamed messages use the same component and status model;
- only one working indicator is rendered.

**Acceptance**

Every turn appears once from submit through persistence. Expanded reasoning/tool state and scroll position survive the live→persisted handoff.

---

### ZPAR-014 — Live tools are event rows, not evolving tool calls

**Evidence**

- Every `tool.call.*` event becomes a new card: `web/src/components/ChatPanel.tsx:576-582`.
- Cards show generic name/status and a truncated input string: `web/src/components/ChatPanel.tsx:938-952`.

**Impact**

One tool can appear as separate started/completed cards. Output, duration, structured arguments and failure evidence are lost. This is visibly less clear than Desktop.

**Required change**

Normalize tools by stable call/part ID. Preserve started/completed/failed transitions, start/end times, structured input, bounded output and error. Render one evolving card per call with tool-specific summaries for Bash, Read, Edit/Write, search, web/browser and agent delegation.

**Acceptance**

Started→completed updates one card in place. Failed tools retain error evidence. Persisted and live cards have equivalent structure and do not duplicate after DB sync.

---

### ZPAR-015 — Pinned/hidden preferences are not durable in the latest-50 model

**Evidence**

- The Sessions view only has metadata for the current latest 50: `web/src/App.tsx:218-241`.
- Pinned rows resolve only through `recent.find`: `web/src/App.tsx:339-350`.
- Row-level pin/hide calls save to localStorage without updating React state: `web/src/App.tsx:355-367`, `501-503`.

**Impact**

A pinned session disappears after falling below rank 50. Some pin/hide actions do not visually update until an unrelated rerender. Hidden sessions have no clear recovery view.

**Required change**

- Use the Workspace preferences state rather than calling `loadPrefs()` on every render.
- Add a bounded metadata lookup for pinned IDs, or persist sufficient non-sensitive display metadata locally.
- Add “Hidden on this device” management in Settings.
- Keep user-requested latest-50 default; do not revert to project-only behavior.

**Acceptance**

A session older than rank 50 remains in Pinned after reload. Pin/hide updates immediately. Hidden sessions can be listed and restored without modifying the ZCode database.

---

### ZPAR-016 — Mobile navigation and inspector actions are not wired

**Evidence**

- CSS expects `.is-sidebar-open`, a scrim, `.preview-active` and `.preview-expanded`: `web/src/styles/reference.css:50-58`.
- App only toggles `sidebar-collapsed`; it never applies `.is-sidebar-open` or renders the scrim: `web/src/App.tsx:35-38`, `260-271`.
- At mobile width, `.sidebar` is `display:none` unless `.is-sidebar-open` exists.
- RightPanel toggles local `expanded`, but does not communicate/apply a layout class: `web/src/components/RightPanel.tsx:19-43`.
- CSS references a mobile preview button, but App does not render one.

**Impact**

The hamburger cannot open the sidebar on narrow screens. The panel expand button changes its icon/label without changing width. Below 820 px the inspector is hidden with no usable switch.

**Required change**

Implement explicit responsive shell state:

- desktop sidebar collapsed/expanded;
- tablet/mobile navigation drawer + scrim + Escape/focus restore;
- desktop inspector normal/expanded/collapsed;
- tablet/mobile primary pane switch between Chat and Inspector;
- resize persistence only where meaningful.

**Acceptance**

At 390 and 360 px, the user can open navigation, select a session, return to chat, open the inspector and return again. No primary action becomes unreachable. At desktop width, expand/collapse visibly changes the panel.

---

### ZPAR-017 — Keyboard behavior conflicts with browser and accessibility norms

**Evidence**

- App intercepts Ctrl/Cmd+N for New chat: `web/src/App.tsx:97-109`.
- Composer intercepts Shift+Tab to cycle execution mode: `web/src/components/ChatPanel.tsx:840-847`.
- The product plan explicitly said not to intercept either browser New Window or reverse focus navigation.
- Slash and search listboxes are not connected to their inputs with complete combobox semantics: `web/src/components/ChatPanel.tsx:787-805`, `web/src/components/SearchDialog.tsx:43-79`.
- Preview overlay closes on Escape but has no focus trap/restore: `web/src/components/ChatPanel.tsx:1012-1035`.

**Impact**

Browser shortcuts are overridden, reverse keyboard navigation is broken in the composer, and assistive technology has incomplete active-option context.

**Required change**

- Remove Ctrl/Cmd+N interception; use a non-browser-conflicting shortcut or make it opt-in.
- Restore native Shift+Tab.
- Add `aria-expanded`, `aria-controls`, stable option IDs and `aria-activedescendant` to command/search/model/mode controls.
- Use one dialog primitive with focus entry, trap, restore, Escape and backdrop behavior for every modal including previews and rename.

**Acceptance**

Keyboard-only and screen-reader tests cover all overlays, forward/reverse Tab, focus restoration, IME, reduced motion and narrow-screen drawers.

---

### ZPAR-018 — Model/mode controls can ignore configuration

**Evidence**

- Model initialization picks the server default before the saved valid model despite the opposite comment: `web/src/components/ChatPanel.tsx:83-98`.
- When either plan/build exists, the mode menu hardcodes all four modes, including modes not advertised by the server: `web/src/components/ChatPanel.tsx:860-875`.

**Impact**

A saved model can be silently ignored. The UI can offer modes the server will reject.

**Required change**

- Saved model wins if it still exists; otherwise use server default, then first available.
- Render exactly the server-advertised modes, adding descriptions only for known IDs.
- Disable send with a clear readiness reason if no valid model/provider exists.
- Reconcile model changes made by Desktop through timeline events without changing the user’s next-run preference unexpectedly.

**Acceptance**

Configuration permutations (empty, one mode, changed model, removed saved model, multiple providers) render and submit exactly the allowed value.

---

### ZPAR-019 — Attachment flow needs preflight limits and real file mention behavior

**Evidence**

- Every selected file is fully read into browser memory and Base64 encoded before the server can reject it: `web/src/components/ChatPanel.tsx:383-404`.
- No client count/type/size preflight exists.
- Both Plus and `@` buttons open the same local file picker: `web/src/components/ChatPanel.tsx:850-856`.
- The server silently truncates attachments to five: `server/index.js:642-650`.

**Impact**

Large/many files can freeze the tab; the UI does not explain rejection or silent truncation. `@` looks like a workspace mention feature but is only a duplicate attach action.

**Required change**

- Return upload count/size/type limits in capabilities.
- Reject oversized/excess/unsupported files before FileReader.
- Show one state per file: queued, uploading, uploaded, rejected, retrying.
- Reject more than five server-side instead of silently slicing.
- Either implement `@` as an allowed-root file search/reference picker or remove it until supported.
- Prefer multipart/streaming upload when the server/runtime convergence work permits it.

**Acceptance**

Oversized and sixth-file attempts fail before memory-heavy reads with accessible messages. Failed files can be removed/retried. `@` never pretends to be a different feature.

---

### ZPAR-020 — “All changes saved” and similar labels are not evidence-backed

**Evidence**

- Topbar shows “All changes saved” whenever the visible chat is not busy: `web/src/App.tsx:278-280`.
- Statusbar shows “Workspace synced” when the database merely exists: `web/src/App.tsx:430-440`.
- Settings can label an unconfigured provider “Demo mode,” but there is no production demo agent: `web/src/components/SettingsDialog.tsx:88-101`.
- Changes panel says agent changes will appear even though Git status includes every working-tree change: `web/src/components/RightPanel.tsx:251-265`.

**Impact**

The interface makes stronger claims than the evidence supports, increasing user confusion about whether work, files or sessions are persisted and who made a change.

**Required change**

Use precise state copy:

- “Idle,” “Starting,” “Working,” “Stopping,” “Connection lost,” “Failed,” “Cancelled,” “Timed out.”
- “Session database available” rather than “Workspace synced.”
- “No provider configured” rather than “Demo mode.”
- “Working tree clean/changed” without attribution.
- Desktop-style “Worked for …” only when authoritative duration exists.

**Acceptance**

Every visible status has a named authoritative source in code/tests. No generic save, success, test-pass or agent-attribution claim is inferred from inactivity or process exit.

---

### ZPAR-021 — The Lugas server is not contract-equivalent to current production

**Evidence**

The current Lugas route table ends after basic health/config/models/projects/sessions/upload/SSE/chat/cancel: `server-lugas/app.ts:90-278`. It lacks or trails current Node behavior including:

- latest/recent sessions and global search;
- skills and commands;
- artifacts, rename, files, Git and preview;
- job status and idempotent submissions;
- numbered/resumable SSE;
- runActive/runStartedAt, timelines, reasoning, durations and message IDs;
- modern Vite static asset serving and SPA fallback.

Its SQLite adapter still reads ascending `LIMIT 2000` parts and inlines errors: `server-lugas/db.ts:60-100`. `Dockerfile.lugas` copies ignored `server-lugas/node_modules` from the working tree rather than installing from a clean lockfile: `Dockerfile.lugas:28-34`.

**Impact**

The migration issue and gate document say the Lugas layer is deployable, but deploying it now would regress most recent parity work. There is also no Lugas contract lane in CI.

**Required change**

Keep Node as the only production-supported runtime until one decision is completed:

- **Recommended:** extract shared domain modules (path policy, SessionStore, JobManager, tickets, upload rules, contracts) and make Node/Lugas thin transport adapters; or
- archive/remove the Lugas path until there is capacity to maintain full parity.

Do not duplicate new parity logic in two independent servers.

**Acceptance**

The same backend contract suite runs unchanged against Node and Lugas. Both serve the same built SPA and every advertised capability. Clean Docker build installs locked Lugas dependencies. No cutover occurs while any route/state fixture differs.

---

## 4.3 P2 — Quality and maintainability improvements

### ZPAR-022 — Break up App and ChatPanel by responsibility

Current sizes are approximately:

- `web/src/App.tsx`: 689 lines
- `web/src/components/ChatPanel.tsx`: 1,037 lines
- `server/index.js`: 1,005 lines

Split by stable ownership, not arbitrary line count:

- `WorkspaceShell`, `Sidebar`, `Topbar`, `Statusbar`
- `SessionList`, `ProjectTree`
- `Transcript`, `MessageTurn`, `ToolCard`, `AttachmentCard`, `TimelineRow`
- `Composer`, `CommandPalette`, `ModelPicker`, `ModePicker`
- `RunStore`, `SessionSyncController`, `MediaResourceManager`
- server route adapters over shared `SessionRepository`, `JobService`, `PathPolicy`, `MediaService`

### ZPAR-023 — Use one state/data strategy

TanStack Query is installed but most server state uses hand-written fetch/effect/poll code. Preferences exist both in Workspace context and direct localStorage calls. The app-wide run registry is declared but unused.

Recommended division:

- TanStack Query: capabilities, models, skills, commands, project/session metadata, history pages, Git/files capability data.
- RunStore/reducer: live jobs and transport state.
- Versioned preference store: theme/text size/sidebar/pins/hides/aliases/drafts.
- Router: active workspace/session identity only.

### ZPAR-024 — Eliminate React warnings and dead code

Current lint finds 12 warnings, including:

- mutation of a memoized context object: `web/src/workspace.tsx:75`;
- stale/missing effect dependencies: `web/src/components/ChatPanel.tsx:158-165`, `306-310`;
- callback initialization/dependency problems: `web/src/App.tsx:97-132`;
- unstable `roots` fallback: `web/src/App.tsx:111-118`;
- state reset effect in PreviewOverlay;
- Fast Refresh mixed exports.

Also remove unused `useStickyModel`: `web/src/components/ChatPanel.tsx:931-935`, duplicate token helpers, and stale CSS classes after responsive wiring is complete.

### ZPAR-025 — Replace CSS `zoom` font sizing with typography tokens

Current text-size preferences apply `zoom` to only transcript/composer: `web/src/styles/reference.css:202-207`. Mobile body text still starts around 11 px before zoom, and many hints remain 7–10 px.

Use CSS custom properties for body, compact, metadata, line-height and control size. Default conversation text should be approximately 15–16 CSS px, with WCAG-compliant contrast and 44 px mobile targets. Preserve density with spacing/progressive disclosure, not unreadably small text.

### ZPAR-026 — Make direct database rename an explicit exception or remove it

`renameSession` writes the CLI-owned database directly: `server/sessions.js:459-470`, while several docs/UI strings claim the web layer is read-only. Prefer an official CLI rename command if available. If none exists, gate the mutation, validate schema/version and allowed-root ownership, use a transaction, document the exact fields, and correct the “read-only” claims.

### ZPAR-027 — Add security headers and upload retention

- Add CSP for the app shell, `X-Content-Type-Options: nosniff`, frame policy, Referrer-Policy and appropriate cache controls.
- Return opaque upload IDs rather than absolute host paths to the browser.
- Add upload/artifact object URL cleanup and server-side retention/garbage collection.
- Bound JSON parsing and surface malformed JSON as 400 rather than generic 500.

### ZPAR-028 — Keep dependencies current through tested small upgrades

At audit time, only small frontend updates were pending for TanStack Router and Marked; TypeScript 7 and Node type 26 are major-line upgrades and should not be bundled into parity fixes. Add a scheduled dependency/CLI compatibility lane, use lockfiles consistently, and record the installed ZCode CLI schema/version used for fixtures.

---

## 5. Target product behavior

The goal should be **semantic parity first, visual parity second**.

### 5.1 Session identity

For every visible conversation, the app must know and show:

- immutable session ID;
- canonical stored project directory;
- title and optional user alias;
- selected next-run model/mode;
- active owned or external run state;
- history completeness/cursor state.

A route can select a session, but it cannot redefine that session’s directory.

### 5.2 One conversation timeline

The transcript should be one ordered model containing:

- user prompt and attachments;
- assistant reasoning (collapsed by default according to preference);
- evolving tool calls;
- assistant answer;
- timeline separators;
- authoritative duration/token/error state;
- an in-flight overlay that becomes the persisted message without duplication.

Local web runs and Desktop/CLI runs should use the same message components. Their only difference is ownership: an owned job can expose Stop; an external job may only expose status unless a supported job handle exists.

### 5.3 Truthful lifecycle

The UI must never collapse these into one flag:

- submission state;
- server job state;
- SSE transport state;
- persisted message state;
- selected route/view.

Recommended user-facing mapping:

| Internal evidence | User-facing state | Composer |
|---|---|---|
| POST in flight | Starting… | Locked |
| Job queued/running + transport live | Working… | Locked; Stop for owned job |
| Job running + transport reconnecting | Reconnecting… work is still running | Locked |
| Server job missing after restart + incomplete DB turn | Outcome unknown | Locked until reconciled or explicit recovery |
| Authoritative cancelled | Cancelled | Enabled |
| Authoritative timeout | Timed out | Enabled |
| `turn.failed` or failed process | Failed | Enabled |
| Persisted completed assistant turn | Answer + optional “Worked for …” | Enabled |

### 5.4 Sidebar behavior

Preserve the user-requested default:

- latest 50 sessions across allowed roots;
- project chip on every row;
- active/running indicators;
- durable pinned rows even if older than 50;
- optional Projects view for hierarchy;
- correct canonical-directory navigation;
- search labeled with index completeness when content indexing is partial.

### 5.5 Composer behavior

- Enter sends; Shift+Enter inserts newline; IME never sends accidentally.
- Shift+Tab remains reverse focus navigation.
- `/` opens a fully accessible command palette.
- `@` either opens a real allowed-root reference picker or is absent.
- Mode/model options exactly match server capabilities.
- Attachments have explicit upload state and preflight limits.
- Busy state explains whether work is local, Desktop/external, reconnecting or stopping.
- No second turn can be sent while the session is owned by an active run.

### 5.6 Inspector behavior

Files, Changes and Preview are secondary evidence surfaces, not the primary Desktop parity target.

- Hide a capability completely or show an honest unavailable state.
- Changes shows working-tree evidence without agent attribution.
- Files supports navigation, truncation/binary/denied states and no write control.
- Preview stays disabled until its isolation contract passes.
- On mobile, Chat and Inspector are explicit panes with a reliable switch.

---

## 6. Target architecture

```text
Router (selected workspace/session only)
                 │
                 ▼
WorkspaceProvider
  ├─ Auth/bootstrap state
  ├─ Versioned preferences and drafts
  ├─ TanStack Query cache
  │    ├─ capabilities/models/modes
  │    ├─ projects/sessions/search
  │    ├─ cursor-paged transcript
  │    └─ files/git metadata
  └─ RunStore (navigation independent)
       ├─ Job state by jobId
       ├─ index by sessionId/draftId
       ├─ StreamController per active job
       ├─ reconciliation/restart recovery
       └─ normalized in-flight message/tool projection
                 │
                 ▼
Transcript view = persisted pages + matching in-flight overlay
                 │
                 ▼
Typed API contract
  ├─ canonical PathPolicy
  ├─ SessionRepository
  ├─ JobService
  ├─ Ticket/Replay service
  ├─ Media service
  └─ thin Node transport adapter
       └─ optional thin Lugas adapter after parity tests pass
                 │
                 ▼
ZCode CLI on explicit Node 24 + CLI-owned SQLite/project files
```

### Architectural rules

1. **Session, job, stream and selected view are different identities.**
2. **The session’s stored directory is authoritative.**
3. **One job service owns terminal transitions and cleanup.**
4. **One renderer owns Markdown safety.**
5. **One path policy protects all root-scoped capabilities.**
6. **One run store survives navigation.**
7. **One cursor model pages history.**
8. **One contract suite must pass against every claimed server runtime.**
9. **Desktop/CLI database writes are observed, not rewritten, except for explicitly documented supported mutations.**
10. **No status text may claim more than its evidence.**

---

## 7. Dependency-ordered implementation plan

Relative scope uses **S / M / L** for review surface, not calendar estimates.

## Phase 0 — Freeze the parity baseline

### ZPAR-P0.1 — Capture current Desktop comparison fixtures (M)

- Select redacted sessions that demonstrate text, reasoning, multiple tools, files, model change, compaction, fork, error, completed duration and an active external turn.
- Store only synthetic/redacted schema fixtures in Git; never commit real transcripts or credentials.
- Capture approved Desktop screenshots and equivalent web screenshots outside sensitive paths.
- Record installed CLI version, relevant SQLite columns/part variants and application build revision.

**Done when:** every later visual or transcript change can be compared against a named fixture/state instead of memory.

### ZPAR-P0.2 — Publish a current capability ledger (S)

Replace “all issues closed” as the product status signal with a living matrix:

- implemented and verified across all test suites;
- implemented but partial across edge cases;
- disabled by design;
- blocked by CLI/Desktop upstream behavior;
- experimental runtime only.

**Done when:** README and Settings use the same capability facts.

---

## Phase 1 — Correctness and security boundary

### ZPAR-P1.1 — Fix auth bootstrap (M)

Implements ZPAR-002. Add auth state tests before changing visual access UI.

### ZPAR-P1.2 — Centralize Markdown and protected media (M)

Implements ZPAR-003 and ZPAR-004. Include object URL lifecycle and logout cleanup.

### ZPAR-P1.3 — Add canonical PathPolicy and session authorization (L)

Implements ZPAR-001 and ZPAR-009 for every Node route. Add session directory to selection callbacks and canonicalize deep links.

### ZPAR-P1.4 — Disable/unadvertise preview until isolation passes (S)

Implements the immediate safe part of ZPAR-010. Keep the code behind an experimental flag if desired, but do not call it an accepted capability.

**Phase 1 exit gate**

- First-time protected access works across all browser sessions.
- Production chat uses the single centralized sanitizer across all inputs.
- Authenticated media renders.
- No cross-root or cross-session context request reaches the CLI across all routes.
- Symlink and sibling-prefix cases pass.
- Preview cannot be accidentally enabled as a same-origin accepted feature across environments.

---

## Phase 2 — Authoritative job lifecycle

### ZPAR-P2.1 — Rebuild JobManager terminal semantics (L)

Implements ZPAR-005 and ZPAR-007:

- explicit `stopping` and `unknown` states;
- exactly-once finalize method;
- CLI failure-event tracking;
- process-tree termination;
- bounded terminal retention;
- subscriber/timer cleanup.

### ZPAR-P2.2 — Same-session lock and request fingerprinting (M)

Implements ZPAR-008. Return structured 409 errors the UI can explain.

### ZPAR-P2.3 — Bound decoder, stderr and replay memory (L)

The current `replayMax` is declared but never applied: `server/zcode.js:100-107`, `173-178`, `252-257`.

Implement:

- `StringDecoder` or equivalent for split UTF-8 chunks;
- final non-newline record flush;
- maximum record size and explicit diagnostic;
- tail-only stderr storage;
- ring-buffer replay with `firstRetainedEventId`;
- explicit `reset-required` when a cursor is too old;
- compact server snapshots for reconciliation.

### ZPAR-P2.4 — Separate stream state from job state (M)

Implements ZPAR-006 in frontend reducer/controller. `onAttached` must mean the connection actually opened, not merely that EventSource was constructed.

**Phase 2 exit gate**

Cancellation, timeout, failure, network loss, restart uncertainty and success each produce one truthful outcome. Buffers are bounded. A second run cannot overlap the same session.

---

## Phase 3 — Workspace-owned runs and stable session sync

### ZPAR-P3.1 — Implement the real RunStore (L)

Implements ZPAR-012. Move EventSource and polling ownership above ChatPanel. Add active job recovery after reload.

### ZPAR-P3.2 — Add cursor-based logical-message history (L)

Implements ZPAR-011. Query complete parts per selected message page and expose completeness explicitly.

Suggested response shape:

```json
{
  "session": { "id": "sess_…", "directory": "/canonical/path" },
  "messages": [],
  "page": {
    "nextBefore": "message-sequence-or-id",
    "upperBound": "stable-snapshot-boundary",
    "hasMore": true,
    "complete": true
  },
  "run": { "active": false, "ownedJobId": null, "startedAt": null }
}
```

### ZPAR-P3.3 — Build one live/persisted transcript projection (L)

Implements ZPAR-013 and ZPAR-014. Stable keys are mandatory; remove array-index fallbacks.

### ZPAR-P3.4 — Improve Desktop change notification (M)

Keep incremental merge, but make cadence/state explicit:

- immediate visibility refresh;
- fast polling or DB change token while external active;
- slower idle polling;
- no concurrent duplicate fetch;
- server-provided session/message revision if available;
- preserve scroll/read state.

**Phase 3 exit gate**

A run survives navigation and can be reattached. A 1,000-message session remains complete under concurrent Desktop appends. Every assistant turn appears exactly once.

---

## Phase 4 — Chat and composer parity

### ZPAR-P4.1 — Truthful status and footer pass (M)

Implements ZPAR-020. Remove inferred save/success claims. Match Desktop language where the same evidence exists.

### ZPAR-P4.2 — Structured activity/tool cards (L)

Implement tool-specific summary/detail renderers with one evolving card per call. Preserve raw bounded evidence for unknown tools.

### ZPAR-P4.3 — Composer capability pass (M)

Implements ZPAR-018 and ZPAR-019:

- exact configured modes;
- correct saved model selection;
- valid no-provider/no-model states;
- attachment preflight and per-file progress;
- honest `@` behavior;
- accessible `/` palette.

### ZPAR-P4.4 — Message-level interaction polish (M)

- Per-message details state instead of one global hide toggle unless a global preference is explicitly selected.
- Copy feedback tied to stable message IDs.
- Meaningful artifact names/alt text.
- Code blocks with copy and horizontal scrolling.
- Tables, lists, links and long unbroken text matched against Desktop fixtures.
- Error details concise by default, with copyable diagnostic expansion.

### ZPAR-P4.5 — Typography token pass (M)

Implements ZPAR-025 and removes `zoom`. Validate default body size, metadata contrast, mobile targets and 200% browser zoom.

**Phase 4 exit gate**

The chat reads as one coherent ZCode conversation from submit through tools and final persistence. Controls expose only real capabilities. No duplicate working/completed rows remain.

---

## Phase 5 — Navigation, responsive behavior and accessibility

### ZPAR-P5.1 — Repair latest-50 navigation and local organization (M)

Implements ZPAR-015 while preserving global latest 50. Add running indicators and durable pinned metadata.

### ZPAR-P5.2 — Wire responsive shell state (L)

Implements ZPAR-016 at 1440, 1280, 1024, 820, 768, 390 and 360 px, plus 200% zoom/reflow.

### ZPAR-P5.3 — Complete keyboard and dialog semantics (L)

Implements ZPAR-017. Use a single accessible dialog/menu/listbox primitive and restore browser-native shortcuts.

### ZPAR-P5.4 — Search scope and index completeness (M)

- Latest empty state remains 50 global sessions.
- Title/content results show project path.
- Partial FTS indexing displays progress/completeness.
- Search can page beyond 20 where useful without claiming complete global results prematurely.

**Phase 5 exit gate**

All core chat/navigation actions work with keyboard only and at 360 px. A screen reader receives selected session, run-state changes, command selection and error status without duplicated announcements.

---

## Phase 6 — Inspector and optional capabilities

### ZPAR-P6.1 — Files inspector completeness (M)

Add directory navigation, breadcrumb, file limits, binary/large states and authenticated fetch through ApiClient. Preserve read-only behavior.

### ZPAR-P6.2 — Git evidence clarity (M)

Handle rename, untracked, binary, staged/unstaged and detached HEAD. Show actual diff scope/base and remove agent attribution.

### ZPAR-P6.3 — Rebuild preview against the approved boundary (L, optional)

Implements the full ZPAR-010 only after a separate security review. Preview remains optional and non-blocking for core ZCode chat parity.

**Phase 6 exit gate**

Every visible inspector tab is backed by a tested capability. Disabled/unsupported states are honest and do not resemble broken features.

---

## Phase 7 — Runtime convergence and maintainability

### ZPAR-P7.1 — Extract shared backend domain modules (L)

Implement ZPAR-021. Node remains production while extraction occurs. Do not add features to two copied route stacks.

### ZPAR-P7.2 — Make Lugas pass the production contract suite (L)

- Clean locked install; no copied host `node_modules`.
- Modern SPA assets, font routes, cache rules and deep-link fallback.
- Full route/capability parity.
- Numbered SSE and job reconciliation parity.
- Current SessionRepository parity.
- Same security/path policy.

Only then decide whether Lugas replaces Node. If maintenance cost is not justified, retain Node and archive the experimental adapter.

### ZPAR-P7.3 — Frontend responsibility split and warning cleanup (L)

Implements ZPAR-022 through ZPAR-024. Make lint warning-free and add explicit package scripts.

Recommended `web/package.json` commands:

```json
{
  "scripts": {
    "typecheck": "tsc -b --force",
    "lint": "oxlint --deny-warnings",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "build": "tsc -b && vite build"
  }
}
```

**Phase 7 exit gate**

There is one source of truth per domain rule, lint is clean, clean builds are reproducible, and every supported HTTP runtime passes identical behavior tests.

---

## Phase 8 — Release proof and documentation

### ZPAR-P8.1 — Expand automated verification (L)

See the matrix in Section 8.

### ZPAR-P8.2 — Live Desktop side-by-side acceptance (M)

For the same host-shared sessions, verify:

- list ordering/title/project;
- model change and compaction separators;
- reasoning/tool/file grouping;
- active external turn lock and elapsed state;
- duration/error footer;
- new Desktop message append without web reload;
- web-created session appears in Desktop;
- model/mode limitations are disclosed.

Use human-reviewed screenshots; do not accept pixel diffs without examining them.

### ZPAR-P8.3 — Rewrite current operational docs (M)

- Remove duplicate README claims.
- Replace the stock Vite `web/README.md`.
- Update API docs with commands, recent sessions, artifacts, rename, run state and current pagination.
- Correct “read-only DB” around rename.
- Mark Lugas experimental until contract parity.
- Remove duplicated/contradictory “What is NOT yet claimed” sections.
- Record exact candidate SHA, build digest, CLI version, Node/Bun/browser versions and test commands.

### ZPAR-P8.4 — Rehearse deployment and rollback (M)

- Node modern build and host-share deployment.
- Legacy UI rollback only if it is still maintained and tested across all routes; otherwise use image/commit rollback instead of an increasingly stale UI.
- Lugas rollback only after it becomes supported.
- Confirm no migration or rollback modifies the CLI DB unexpectedly.

**Phase 8 exit gate**

The release claim matches current evidence, not issue closure history. A previous safe image/commit is available and data-preserving rollback is rehearsed.

---

## 8. Required verification matrix

The current 16 unit + 23 browser + 25 backend tests are a useful base. Add the following before claiming Desktop-near parity.

### 8.1 Backend contract and reliability

| Area | Required deterministic cases |
|---|---|
| Session boundary | wrong cwd/session, outside-root session, missing session, canonical deep link, sibling-prefix root |
| Symlink policy | cwd symlink escape, file symlink escape, preview symlink, legitimate internal symlink if policy allows it |
| Same-session locking | two tabs, direct API race, Desktop incomplete turn, terminal release |
| Idempotency | same key/same body replay; same key/different body 409; retained/expired key |
| Terminal semantics | zero exit, nonzero exit, `turn.failed` + zero exit, spawn error, signal, cancel, timeout, close races |
| Process cleanup | cooperative child, SIGTERM-ignoring child, grandchild/process group, repeated cancel |
| Decoder | split Unicode, split JSON line, final line without newline, malformed line, oversized line, huge stderr |
| Replay | reconnect at every event boundary, duplicate cursor, cursor older than retained window, terminal replay, ticket expiry |
| History | >1,000 messages, >6,000 parts, many parts in one message, concurrent append, unsupported schema, DB lock/open failure |
| Media | auth-enabled image/PDF/text, pruned 404, unsupported MIME, ticket/object URL expiry |
| Upload | invalid base64, exact limit, over limit, >5 files, unsafe names, cleanup/retention |
| Preview | remains disabled until separate-origin hostile-content suite passes |

### 8.2 Frontend unit/component

- Auth bootstrap state machine and invalid-token retry.
- Job vs transport reducer transitions, including unknown/recovery.
- RunStore navigation independence and reattachment.
- Live→persisted message/tool folding.
- Cursor page merge/deduplication.
- Saved model and server mode permutations.
- Attachment preflight/retry.
- Production Markdown component forced through degraded sanitizer path.
- Preference updates/pinned metadata/hidden restore.
- Object URL reference counting and cleanup.

### 8.3 Browser integration

Run at least Chromium, Firefox and WebKit for core flows:

1. First access with no/wrong/correct token.
2. Cross-project latest-50 session navigation.
3. Navigate A→B→A while A runs.
4. Drop/reconnect stream and reconcile terminal state.
5. Cancel a long/ignoring run.
6. Concurrent Desktop append during older-page loading.
7. Authenticated image and PDF preview.
8. Slash palette, search, model/mode menus and all dialogs by keyboard.
9. Mobile drawer and chat/inspector switching at 390/360 px.
10. External Desktop run locks composer and completes without duplicate bubble.

### 8.4 Accessibility

The existing axe check covers only the initial shell. Add stateful checks for:

- access prompt and errors;
- transcript loading, active run, reconnecting, failed and external run;
- command/search/model/mode overlays;
- preview/media dialog;
- attachment progress/errors;
- mobile drawer and inspector;
- 200% zoom and 320 CSS px reflow equivalent;
- reduced motion;
- manual screen-reader announcement review.

### 8.5 Performance and resource bounds

The current “JS under 250 KB gzip” browser test sums `Content-Length`, but static assets do not set that header, so it can record zero and pass without measuring the bundle. Replace it with build-artifact gzip measurement or actual encoded response bytes.

Required budgets/evidence:

- initial JS/CSS measured from built artifacts;
- input-to-paint p95 under an active fixture stream;
- event-to-visible p95 under sustained deltas/tools;
- 1,000-message history interaction;
- 50 navigation cycles with no leaked EventSource, timer or object URL;
- bounded server job/replay/stderr memory;
- no unbounded browser event array.

### 8.6 CI lanes

Recommended mandatory lanes:

1. `node-contract` — backend/security tests against Node adapter.
2. `web-unit` — typecheck, warning-free lint, unit/component tests, build.
3. `browser-core` — Chromium/Firefox/WebKit matrix.
4. `browser-a11y-responsive` — dynamic states and viewports.
5. `docker-node` — clean image, authenticated health, deep link, fake CLI smoke.
6. `lugas-contract` and `docker-lugas` — required only while Lugas is claimed supported.
7. `live-cli-smoke` — manually/scheduled with authorized non-secret fixture; visible skip when unavailable.

---

## 9. Recommended pull-request sequence

This sequence keeps each review coherent and reduces rollback risk.

| PR | Scope | Depends on |
|---:|---|---|
| 1 | Auth bootstrap state machine and access tests | — |
| 2 | Single production Markdown renderer + authenticated media object URLs | 1 |
| 3 | Shared canonical PathPolicy + session/cwd enforcement + cross-project navigation | 1 |
| 4 | JobManager finalize/cancel/failure/concurrency/idempotency rules | 3 |
| 5 | Bounded CLI decoder, stderr, replay ring and reset protocol | 4 |
| 6 | Frontend job/transport split and workspace RunStore | 4–5 |
| 7 | Cursor-based transcript repository and stable page merging | 3 |
| 8 | Single live/persisted transcript + evolving tool calls | 6–7 |
| 9 | Composer modes/models/attachments/commands/status copy | 8 |
| 10 | Latest-50 pins, responsive drawers/panes and accessible overlays | 6, 9 |
| 11 | Inspector truthfulness; preview either isolated or kept disabled | 3, 10 |
| 12 | Shared backend core and Lugas convergence/archival decision | 4–7 |
| 13 | Cross-browser, a11y, resource, Docker and Desktop comparison gates | 1–12 |
| 14 | README/API/release evidence and rollback rehearsal | 13 |

Do not combine PRs 3–8 into one “parity rewrite.” Those changes affect independent failure boundaries and need focused regression evidence.

---

## 10. Upstream limitations to expose honestly

These should not be hidden with invented UI.

### 10.1 Model variants

If the headless CLI still has no stable syntax/API for Desktop variants such as a “Max” choice, do not fabricate a variant picker. Render only actual provider/model refs and document the upstream dependency.

### 10.2 External-run cancellation

A Desktop/CLI-created run observed only through SQLite has no web JobManager handle. The web can lock the session and show activity, but Stop must be absent or explicitly unavailable. If ZCode later exposes an owned job/control API, add it through a verified contract.

### 10.3 Interactive provider login

Providers that require interactive `zcode login`, OAuth UI or captcha cannot be promised in headless mode. Readiness must distinguish configured API-key providers from Desktop-only interactive sessions.

### 10.4 Pruned Desktop artifacts

When ZCode has removed artifact bytes, keep the metadata card and explanatory unavailable state. Never infer a filesystem path from `zcode-artifact://`.

### 10.5 Session database schema evolution

The database is an internal CLI store, not a versioned public web API. Record observed schema versions/fixtures, fail distinctly on unsupported layouts, and avoid writable fallback behavior.

---

## 11. Definition of “close to ZCode”

The parity milestone is complete only when all of the following are true:

### Context and navigation

- [ ] Every session opens in its canonical project.
- [ ] Latest 50 remains global with clear project labels.
- [ ] Pinned sessions remain visible beyond the latest 50.
- [ ] Deep link, reload, back and forward preserve correct identity.
- [ ] Navigation never cancels, retargets or hides the existence of a running job.

### Conversation

- [ ] One logical turn renders once from streaming through persistence.
- [ ] Reasoning, tools, files, timelines, errors, tokens and duration match fixture evidence.
- [ ] Long histories are complete and stable under Desktop appends.
- [ ] Scroll follow and scrollback anchor behave predictably.
- [ ] No raw error is mistaken for answer text.

### Run lifecycle

- [ ] Starting, running, reconnecting, stopping, failed, cancelled, timed out and unknown are distinct.
- [ ] Agent failure cannot become UI success.
- [ ] One active run per session is enforced server-side.
- [ ] Stop terminates the process tree and cleans all resources.
- [ ] Refresh/navigation can reattach to owned active work.

### Composer

- [ ] Model/mode/command options come from real capabilities.
- [ ] Attachments have bounded, visible upload states.
- [ ] Slash/search menus are keyboard and screen-reader complete.
- [ ] Browser and reverse-Tab shortcuts are not hijacked.
- [ ] External activity blocks send without pretending the web owns Stop.

### Safety and truth

- [ ] Production Markdown uses the fail-closed sanitizer boundary across all inputs.
- [ ] Protected media renders without exposing the bearer token.
- [ ] Every root-scoped route enforces canonical containment.
- [ ] Preview is separate-origin accepted or disabled.
- [ ] Status text never invents save, success, Git attribution or test evidence.
- [ ] No secrets, real transcripts or proprietary CLI bundle enter Git/test artifacts.

### Responsive/accessibility

- [ ] Core flows work at 360 px and 200% zoom.
- [ ] Sidebar and inspector drawers are operable and restore focus.
- [ ] All dynamic states have correct names, roles, focus and announcements.
- [ ] Automated axe plus manual keyboard/screen-reader review pass.

### Operations

- [ ] Warning-free lint, build, unit, contract, browser and Docker gates pass.
- [ ] Node is explicitly the production server; Lugas is either fully equivalent or clearly experimental.
- [ ] Live host-share Desktop comparison passes on the release candidate.
- [ ] Documentation and rollback evidence identify the exact candidate and current limitations.

---

## 12. Immediate next milestone

The most valuable first implementation milestone is:

> **A session can never run in the wrong project, the browser can always determine auth state, and every owned job reaches exactly one truthful terminal outcome.**

That milestone consists of ZPAR-P1.1 through P1.4 and ZPAR-P2.1 through P2.4. It should be completed before further visual parity work. Once it passes, the RunStore/history/transcript phases can make the chat feel like ZCode without building on ambiguous state.

---

## 13. Final assessment

The project is much closer to ZCode than its original baseline: the shared store, timeline rendering, duration footers, external-run lock, incremental transcript merge, slash commands, Inter typography option and global latest-50 list are all meaningful parity gains.

The next improvement is not “more UI.” It is to make **session identity, job ownership, stream recovery and persisted transcript identity agree at all times**. Once those four foundations are authoritative, the remaining visual and interaction differences become straightforward, testable refinements instead of recurring state bugs.
