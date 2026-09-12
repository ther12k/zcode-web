# API and event contracts

## Contract status

The small baseline inventory below describes integration points inspected at `f102cef`. Everything under **Proposed** is a requirement to implement and test, not an existing endpoint or a claim of compatibility. Preserve old clients until migration/rollback acceptance.

## 1. Baseline integration inventory

| Existing interface | Use |
|---|---|
| `GET /api/health`, `GET /api/config` | Readiness/configuration, subject to API authorization. |
| `GET/POST /api/projects` | Enumerate roots/projects; create a directory. |
| `GET /api/sessions?cwd=…` | Project history list. |
| `GET /api/sessions/:id?limit=…&offset=…` | Logical-message transcript page. |
| `GET /api/models` | Configured provider/model choices. |
| `POST /api/upload` | Base64 JSON upload; returns stored reference. |
| `GET/HEAD /api/uploads/:name` | Authenticated uploaded bytes. |
| `POST /api/chat` | Submit text/context; returns an accepted job. |
| `POST /api/jobs/:id/cancel` | Request cancellation. |
| `POST /api/sse-ticket` | Exchange bearer access for a job-scoped stream ticket. |
| `GET /api/events/:id?ticket=…` | SSE delivery. |

No job-status, general files, Git or application-preview API was identified in this baseline router. These must not be assumed by the new frontend. [R03](12-SOURCES-AND-EVIDENCE.md#repository-sources).

The current frontend/source define upstream event adaptation and artifact behavior; preserve compatibility through fixtures rather than copying assumptions into presentation code. [R04–R06](12-SOURCES-AND-EVIDENCE.md#repository-sources).

## 2. Proposed common response and capability contract

Use stable machine-readable error codes, HTTP status, optional safe details and request ID. Do not put prompts, secrets or complete host paths into generic logs.

```ts
// Proposed shapes, not current response declarations.
interface ApiError {
  error: string;
  code?: string;
  requestId?: string;
  retryable?: boolean;
}
interface UiCapabilities {
  apiVersion: 2;
  instanceId: string;       // stable, non-secret deployment identity
  serverEpoch: string;      // changes with process/reconciliation lifetime
  features: {
    jobsV2: boolean;
    streamV2: boolean;
    historyV2: boolean;
    fileRead: boolean;
    gitRead: boolean;
    staticPreview: boolean;
    globalSearch: boolean;
  };
  limits: {
    maxAttachmentCount: number;
    maxUploadBytes: number;
    maxActiveJobs: number;
  };
}
```

Add capability information to authenticated configuration. Unknown/absent flags are false. Keep auth bootstrap based on status: the unauthenticated app must be able to show an access form when config returns 401 rather than assuming it can first read `authRequired`.

Project entries gain a stable `projectKey`, display name and canonical-directory binding. The browser uses the key for routes and cache scope; the server remains responsible for authorization and containment.

## 3. Proposed submission and idempotency

Extend `POST /api/chat` with `clientRequestId`, `expectedServerEpoch` and optional `projectKey`, retaining existing request fields. Generate one UUID for one user-intended submission. Repeating that ID and an identical normalized payload in the same epoch returns the same job; a different payload returns 409. An epoch mismatch returns a reconciliation error, not a new run.

Keep a bounded request index for at least the retained-job window, document eviction, and expose it through job lookup. This is **not** an exactly-once guarantee across server crashes. After restart or expiration, the client must reconcile history and obtain explicit user intent before resubmitting an uncertain request.

Before accepting a resumed session, compare its canonical directory to the requested project. Reject mismatch. Reject invalid modes/models rather than silently changing a version-2 request to a different execution choice. Preserve the legacy contract where needed through explicit version handling.

The attachment-only default prompt remains a protected regression behavior. Confirm uploaded references server-side and reject an excess count instead of silently dropping files in the new contract. Disable sending until pending uploads are resolved.

**Acceptance response:** existing job/context fields plus `serverEpoch`, `clientRequestId`, explicit run state and protocol/capability version. The server may initially return a null session ID; that is not an error.

## 4. Proposed job reconciliation

Add authenticated `GET /api/jobs/:jobId` and bounded `GET /api/jobs` for active/retained jobs. Support lookup by `clientRequestId` and expected epoch so a lost submission response can be reconciled without running the prompt again.

```ts
interface JobSnapshot {
  jobId: string;
  serverEpoch: string;
  clientRequestId: string;
  projectKey: string;
  sessionId: string | null;
  state: 'accepted' | 'running' | 'stopping' |
         'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  agentOutcome: 'unknown' | 'succeeded' | 'failed';
  exitCode: number | null;
  signal: string | null;
  lastSequence: number;
  earliestReplaySequence: number;
  retainedUntil: string | null;
  output: unknown;          // versioned bounded current-message snapshot
  outputTruncated: boolean;
}
```

`output` must have an agreed domain schema before implementation, including message/part identity and text/tool/artifact state. The returned snapshot and `lastSequence` represent the same high-water mark. A frontend applies subsequent events strictly after that mark.

Do not return all raw outputs for all jobs in the list endpoint. List returns safe summaries; detail returns the bounded current-run snapshot. All lookups use the same auth boundary; no public job enumeration.

A missing job after restart/eviction is 404/410 with an explicit reason when known. It must not be interpreted as successful cancellation or proof that the CLI never ran.

## 5. Proposed ticket policy

Retain `POST /api/sse-ticket`. Version-2 response adds job identity, protocol version and an explicit `expiresAt`. Recommended ticket-open TTL: **60 seconds**, independent of the maximum job duration. Ticket binds to instance epoch, one job and stream read access only.

An accepted stream can remain open after ticket-open expiry; reconnect requires a newly minted ticket. Tickets may be reused within the short opening window unless implementation explicitly chooses and tests single-use behavior. Never claim one-time semantics without implementing them.

For post-completion reconciliation, allow short-lived tickets to retained terminal jobs. Eviction or epoch change invalidates the ticket. This policy deliberately distinguishes “time to open a stream” from “job completed.” Redact tickets from reverse-proxy/application logs and prohibit the old bearer `?token=` route in token-protected mode.

## 6. Proposed SSE v2 and replay

Negotiate v2 explicitly; keep legacy clients on legacy envelopes. Suggested v2 connect form:

```text
GET /api/events/{jobId}?ticket={opaque}&protocol=2&after={sequence}
```

The application controls reconnection: close a failed EventSource before retry, mint a fresh ticket, then create a new connection with the last applied sequence. `after` complements browser `Last-Event-ID` behavior when the application creates a fresh EventSource. Neither cursor is an authorization mechanism. [S09](12-SOURCES-AND-EVIDENCE.md#primary-technology-sources).

```ts
interface StreamEnvelope {
  v: 2;
  jobId: string;
  serverEpoch: string;
  seq: number;             // server-generated, monotonic within this job
  type: 'cli' | 'job_state' | 'diagnostic';
  payload: unknown;        // validated by the matching domain adapter
}
```

Each retained event is delivered with an SSE `id` equal to the wrapper sequence and JSON data containing the envelope. Sequence **all** retained events, including server-generated terminal status. Heartbeat comments do not advance application sequence.

Rules: validate cursor syntax/range; discard already-applied sequences; do not reuse the CLI's own sequence as the transport cursor; subscribe/replay at an atomic high-water boundary so no event is lost between replay and live delivery. Close the stream after a terminal event has been delivered.

When the requested sequence precedes retention, send an explicit non-application control message `reset_required` with replay bounds, then close. The client reads the authoritative job snapshot, replaces the current live-run view at its high-water mark and resumes after that sequence. If the snapshot is truncated, disclose it and offer persisted history where available. Do not silently drop data or append a replay on top of existing output.

Recommended configurable budgets: 8 MiB serialized replay per job, 32 MiB global replay, 256 KiB maximum incomplete CLI record, 16 KiB stderr tail. These are proposed initial values. Oversized input generates an explicit bounded diagnostic and defined termination/degradation behavior. Finalize and measure under ZWUI-008/026.

Cancellation, timeout and process close must produce one terminal decision. Preserve termination signal and reason. Require output decoder flush at EOF. Process-tree cleanup for the supported deployment platform must be tested or its remaining limitation disclosed; a UI label cannot prove descendant processes stopped.

## 7. Proposed logical-message history v2

Keep legacy offset responses during transition. Add explicit v2 pagination using a session-bound opaque cursor and stable message IDs. Query the message page **before** retrieving its parts so messages cannot be split by a global part-row cap.

```ts
interface HistoryPage {
  sessionId: string;
  snapshot: string;                // stable upper-bound anchor
  messages: Array<{
    id: string;
    sequence: number;
    role: string;
    parts: Array<{
      id: string;
      type: 'text' | 'tool' | 'file' | 'unsupported';
      data: unknown;
    }>;
  }>;
  nextBefore: string | null;
  hasMore: boolean;
  truncated: boolean;
}
```

Initial page selects the newest complete logical messages. Older pages remain anchored to the initial upper bound so a newly appended desktop turn cannot shift offsets. Display each page chronologically. Snapshot is a pagination boundary, not a promise that an actively edited message is a frozen database transaction forever; reconcile modified current messages by ID.

Counts must derive from the full eligible message set or be labeled approximate/unavailable. A malformed part becomes an explicit unsupported part where feasible. Missing database, unsupported schema and query failure are distinct outcomes; do not translate all failures to empty history. Read-only opening must not fall back to writable access.

## 8. Proposed optional APIs

| Capability | Proposed interface | Additional boundary |
|---|---|---|
| Global search | `GET /api/search/sessions` | Authorized roots; bounded query/cursor; scope and completeness metadata. |
| Files | `GET /api/projects/:key/files`; `GET /api/projects/:key/file` | Read-only; server-validated relative path; type/size/hash metadata; no arbitrary URL. |
| Git | `GET /api/projects/:key/git/status`; `GET /api/projects/:key/git/diff` | Fixed read-only command forms, no shell/external diff hooks; bounded output. |
| Static preview | Snapshot creation/lookup contract defined after ZWUI-034 | No generic URL fetch or arbitrary process launch; separate untrusted-content origin. |

These routes are design proposals and remain disabled until their tasks and security gates are complete. No frontend tab is evidence that an API exists.

## 9. Compatibility and version evidence

Contract fixtures identify repository SHA, CLI version, database schema signature and normalized protocol version. Use synthetic/redacted material in the repo. Do not publish proprietary CLI bundles or personal transcripts. ZWUI-001 freezes the actual observed baseline; ZWUI-023/024 demonstrate the upgraded contract against fixtures and one authorized live smoke run where available.
