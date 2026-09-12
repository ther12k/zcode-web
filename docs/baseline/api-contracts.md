# API contract inventory (ZWUI-001)

All routes under the bearer token (except static and ticketed SSE, see below).
Errors: JSON `{ "error": string, ...? }` with 400/401/404/405/409/413/429/500/503/504.

| Method & path | Request | Response | Notes |
|---|---|---|---|
| GET /api/health | — | `{ok, cli{entry,present}, db{path,present}, providerConfigured, workspaceRoot, activeJobs, maxJobs, authRequired}` | also used by Docker healthcheck (bearer) |
| GET /api/config | — | `{authRequired, workspaceRoot, allowedRoots[], modes[], defaultMode, cliPresent, providerConfigured}` | |
| GET /api/models | — | `{models: [{ref, provider, providerName, model, isDefault}]}` | keys/baseURL never leave the server |
| GET /api/projects | — | `{roots: [{path, projects[]}]}` | dirs under each allowed root, dotfiles excluded |
| POST /api/projects | `{name, rootIndex?}` | 201 `{name, directory}`; 409 exists; 400 invalid name | `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` |
| GET /api/sessions?cwd&limit? | — | `{cwd, sessions: [{id,title,directory,taskType,createdAt,updatedAt}]}` | excludes `sess_subagent_*` |
| GET /api/sessions/:id?limit&offset | — | `{session, transcript:[{role,text,tools?[],files?[]}], total, hasMore}` | logical-message pagination; offset counts from newest |
| POST /api/upload | `{name, data(base64)}` | 201 `{path,name,size}`; 400 invalid/empty/corrupt; 413 too large | ≤ ZCODE_MAX_UPLOAD_BYTES (15MB), name sanitized, stored under ZCODE_HOME/uploads |
| GET /api/uploads/:file | — | file bytes, typed by ext | GET/HEAD; traversal blocked; images render inline |
| POST /api/chat | `{text, sessionId?, cwd?, mode?, model?, attachments?[]}` | 202 `{jobId, sessionId, cwd, mode, model}` | attachment-only defaults to "Analyze the attached file(s)."; model must match /api/models ref; cwd must be under an allowed root |
| GET /api/events/:jobId | — | SSE stream | auth: bearer **or** ?ticket= from /api/sse-ticket; events below |
| POST /api/sse-ticket | `{jobId}` | `{ticket}` | short-lived, job-scoped |
| POST /api/jobs/:id/cancel | — | `{canceled:true}` / 404 | SIGTERM then SIGKILL |

## SSE event kinds (server → browser)

`{kind:"line", line:<CLI event>}` · `{kind:"done", exitCode, error, sessionId, stderrTail}` · `{kind:"timeout"}`

## CLI stream-json envelope (0.16.5)

`{eventId, payload, seq, sessionId, timestamp, traceId, turnId, type}`

Observed `type` values: `session.titleUpdated`, `turn.started`, `session.updated`
(payload.type = model_request_started/failed + request metadata incl. model,
modelRef, baseURL, usage), `model.streaming` (payload.kind =
reasoning_delta/text_delta/start/…/finish, payload.delta), `tool.call.started/
completed/failed`, `turn.completed` (payload.response, usage, duration),
`turn.failed` (payload.error{message,code,attribution}), `result`.

Samples: `docs/baseline/sse-samples.jsonl` (redacted from live runs).
