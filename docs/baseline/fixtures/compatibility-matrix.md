# Compatibility matrix (ZWUI-001)

Statuses: **implemented** (evidence in repo) · **limitation** (documented, deliberate) · **proposed** (issue filed) · **unverified** (claimed nowhere).

| Capability | Status | Where / evidence |
|---|---|---|
| Headless CLI runs (--prompt/--resume/--attach/--mode) | implemented | server/zcode.js, server-lugas/shared.ts; gate evidence G1 |
| stream-json event envelope parsing | implemented | docs/baseline/sse-samples.jsonl |
| Bearer auth + constant-time compare | implemented | server/index.js isAuthorized |
| Ticketed SSE (job-scoped, expiring) | implemented | server/index.js TicketStore; legacy ?token= rejected |
| SSE v2 replay / Last-Event-ID / explicit expiry | proposed | ZWUI-008 (#14) |
| Immutable job status endpoint + idempotent submit | proposed | ZWUI-007 (#13) |
| Uploads: strict base64, size, name sanitize, private dir | implemented | server/index.js /api/upload |
| Upload MIME-typed serving (GET+HEAD) | implemented | /api/uploads/:file |
| Logical-message pagination incl. tools/files | implemented | server/sessions.js |
| DB error surfacing distinct from empty | proposed | ZWUI-018 (#15) |
| Fail-closed Markdown (DOMPurify vendored) | implemented (vanilla UI) / proposed (React centralization) | public/vendor; ZWUI-015 (#10) |
| Model switcher w/ disambiguated labels | implemented | server/index.js listModels |
| Attachment-only send default prompt | implemented | server/index.js /api/chat |
| Tool artifact cards (live + history) | implemented | public/app.js; server/sessions.js |
| Desktop zcode-artifact:// byte resolution | limitation | metadata cards only; no stable on-disk mapping |
| Host-share mode (shared desktop DB) | implemented | docker-compose.host.yml |
| Lugas HTTP layer (Bun) | implemented (G1–G4) / proposed (G5) | #43, docs/baseline/lugas-gates.md |
| Dual-runtime Docker image | proposed | #43 G5 |
| Read-only file API / Code inspector | proposed | ZWUI-030/031 (#36/#37) |
| Real Git status/diff | proposed | ZWUI-032 (#38) |
| Isolated static preview | proposed | ZWUI-034/035/036 (#40–42) |
| --max-turns flag | limitation | listed by CLI --help, rejected by 0.16.5 parser; use ZCODE_JOB_TIMEOUT_MS |
