# Architecture and implementation boundaries

## 1. Target topology

```text
Browser
  React workspace
    Router -> selected project/session and inspector route state
    Query  -> server snapshots and paged history
    Run store + stream controller -> live execution evidence
    Draft/preference storage -> explicitly scoped local state
             |
       same-origin HTTP/SSE
             |
Existing Node 24 service
  authenticated API + built frontend assets
  project/session adapters + job manager + scoped stream tickets
             |
        existing ZCode CLI
             |
  existing session database + project files
```

Vite is used during development/build. Production still uses the existing service for assets and API. The optional preview extension is a separate untrusted-content boundary, not another route rendered inside the trusted React DOM.

The current repository documents a CLI-owned session store and HTTP/SSE wrapper. This topology preserves that operating model; it does not certify a running deployment. [R01](12-SOURCES-AND-EVIDENCE.md#repository-sources).

## 2. Proposed source layout

```text
server/                         # retained Node runtime
  index.js
  zcode.js
  sessions.js
  ... narrowly extracted adapters as needed
public/                         # temporary safe legacy frontend
web/
  package.json
  package-lock.json
  index.html
  vite.config.ts
  src/
    app/                        # providers, route tree, root boundaries
    api/                        # contracts, validation, client, query keys
    components/ui/              # owned accessible primitives
    features/
      workspace/                # shell, panes, project/session navigation
      conversation/             # composer, transcript, message parts
      runs/                     # event normalization, reducer, transport
      artifacts/                # metadata and authenticated media
      settings/                 # access, preferences, diagnostics
      files/                    # optional read-only capability
      changes/                  # optional real Git capability
      preview/                  # optional isolated preview controller
    storage/                    # versioned drafts/preferences
    styles/                     # tokens and global layout
  tests/
  dist/                         # generated, not hand-edited
fixtures/                       # synthetic/redacted CLI and DB fixtures
```

Avoid a single `Workspace.tsx` that fetches all data, holds every dialog and rewrites the entire workspace after each action. Split by behavior ownership rather than arbitrary file length.

## 3. State ownership

| State | Owner | Invariant |
|---|---|---|
| Selected project/session | Router | Navigation cannot mutate active execution context. |
| Inspector tab/selected artifact | Route search state or local view state | Non-sensitive stable identifiers only; validate unknown tabs. |
| Projects/models/config/history | TanStack Query | Query keys include server identity and project/session scope. |
| Running jobs and stream output | Run store | Keyed by server epoch + job ID; immutable project/session binding. |
| Unsent input/attachment UI | Draft store | Keyed by instance + project + session/draft identity. |
| Pane sizes/theme | Preference store | Versioned, validated, clamped to current viewport. |
| Auth bearer | Access controller | Memory by default; optional explicit device persistence; never in routes. |
| EventSource/timers/AbortControllers | Stream controller | One transport owner per active job in a tab; deterministic cleanup. |

Use reducers and a subscribed store (`useSyncExternalStore` is an appropriate React boundary) to avoid rerendering the whole workspace for every delta. Zustand is optional if it materially simplifies the measured implementation, not a mandatory extra global store.

Router loaders may seed Query's cache. They must not maintain an independent conflicting history cache. Cancel stale read requests and still verify their generation and context before committing a result.

## 4. Identity and routes

Proposed routes:

```text
/                               # landing/access/last valid workspace
/w/$projectKey/new              # unsent draft in one project
/w/$projectKey/s/$sessionId      # persisted CLI conversation
/settings/$section             # preference/access/readiness pages
```

`projectKey` is a stable non-secret server-issued identifier mapped to a canonical directory. It is not an authorization token. ZWUI-004 adds it to project/config contracts without removing legacy directory fields. Define how directory renames affect identity; a canonical-path-based key may intentionally produce a new project identity after a rename. Do not encode raw credentials, prompts, file bytes or upload paths in URLs.

The server verifies that a resumed session belongs to the requested canonical project. The frontend cannot establish this by hiding a row. Unknown project/session routes show a contextual not-found/denied state, not a silent fallback to the first project.

A newly accepted run may not yet have a session ID. Preserve its draft/run identity until the first authoritative binding event. When it becomes known, move the draft/run mapping atomically and update the URL only if the user is still viewing that draft.

## 5. Run and connection states are separate

Proposed run states:

```text
accepted -> running -> succeeded | failed | cancelled | timed_out
                    -> stopping -> cancelled | failed | timed_out | succeeded
```

`unknown` is a reconciliation state for a lost server record/restart, not a successful terminal result. Preserve `outcomeSource` (process/agent/reconciliation) and an independent agent outcome when available. An agent failure wins over a generic exit-zero success label. Passing tests requires actual test evidence, not any run state.

Transport states:

```text
idle -> acquiring_ticket -> connecting -> live -> reconnecting
                                  -> auth_required | unavailable | closed
```

Transport failure never fabricates a terminal run state. A cancel response acknowledges intent; terminal evidence resolves the result. State transitions are idempotent and tested against reordered cancellation/close/timeout callbacks.

## 6. Event flow and stale work protection

The server wraps upstream CLI events in its own per-job monotonic sequence. The frontend normalizes that wrapper into bounded domain updates. Preserve the original upstream IDs as optional metadata; do not assume upstream sequence numbers cover server-generated completion or timeout events.

Each async operation captures an instance/epoch, job ID and generation. A late ticket response, replay page, history request or blob fetch must be ignored after its owner is disposed or retargeted. Transport lifetime belongs to the run manager, not the currently rendered conversation component. Route unmount removes a view subscription, not the CLI process.

React development effect replay must not start duplicate CLI jobs or transports. Start jobs only through an explicit user-command path with a request ID. A reducer must not contain network calls or DOM mutations.

On completion, reconcile persisted history once it is available, matching stable message/turn IDs. Do not append both the live final answer and an identical persisted answer. Persistence lag receives a visible, bounded refresh state.

## 7. Local data and credentials

Theme and layout may persist by default. Draft text persistence is opt-in because prompts may contain sensitive project data. Suggested limit: 50 drafts, 100 KiB text each, 7-day expiry, oldest unused draft eviction with notice. Store no attachment bytes, bearer tickets, provider keys or model output in draft preferences. These are proposed limits and must be configurable or documented.

Draft keys include server identity, canonical project identity and session/draft identity. Auth-context changes clear sensitive cache/store data so a shared browser cannot display a previous operator's transcript. Device persistence is not cross-device sync and must not be labeled as such.

Authenticated media fetches yield object URLs with ownership/ref-count cleanup. Revoke when no consumer remains, on credential change and on application disposal. Never pass an untrusted arbitrary URL to an API client that automatically adds the bearer header.

## 8. API evolution

Retain the existing endpoint names and legacy response fields while adding explicit versioned contracts for new UI behavior. Version negotiation must be capability-driven; a missing feature is unsupported rather than guessed. No frontend mock data is allowed in the production live adapter.

See [API and event contracts](06-API-AND-EVENT-CONTRACTS.md). Critical additions are job lookup/reconciliation, idempotent submission, cursor-based replay and stable message pagination. Optional file/Git/preview APIs remain separate.

The Node service need not gain runtime dependencies for the UI migration. Browser-side validators can be small typed guards or one deliberately selected schema package. Do not claim TypeScript interfaces alone validate network input. Shared fixtures and contract tests bridge browser types and server validation.

## 9. Development and deployment

During development, Vite proxies `/api` to the existing server and supports the same stream semantics. Use exact local origins; do not loosen production CORS or authentication to make development easier. Keep provider/CLI environment variables server-side. Never put a secret in a `VITE_` variable, which belongs to client build configuration.

Production builds `web/dist` in a separate Docker build stage, then copies the output into the Node runtime image. No React SSR runtime or Vite dev server is started. Static asset routing serves the selected UI; API routing always wins over SPA fallback. Hashed immutable assets and revalidated HTML must not leave users on an incoherent mixed build.

## 10. Optional tool boundaries

Read-only filesystem APIs validate canonical paths on the server and disclose truncation/unsupported types. Real Git reads use fixed argument lists, bounded output and no shell interpolation; external diff/text conversion hooks must not execute. The Changes pane shows actual comparison semantics, not inferred ownership by an agent run.

Static preview receives an explicit immutable snapshot of approved public project files. It has no bearer, no privileged parent bridge and no main-origin DOM access. A sandbox is not a complete CPU, memory or network-containment promise. Design review precedes implementation and must record residual risk. No generic authenticated URL-fetch proxy is introduced.
