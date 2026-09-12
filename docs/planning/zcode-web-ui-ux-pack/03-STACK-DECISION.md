# ADR-001: frontend stack and retained backend

**Status:** Recommended, ready for implementation confirmation in ZWUI-001/002.

## Decision

Use a **client-rendered React + TypeScript application built with Vite**, with **TanStack Router** for navigation and **TanStack Query** for remote data. Style it with **Tailwind CSS**, CSS custom properties and selected **shadcn/ui components using a consistently chosen accessible primitive implementation**. Retain the existing Node 24 server, SSE API, CLI runner and CLI-owned database.

Do not use Next.js. Do not introduce TanStack Start merely to obtain Router or Query.

## These products sit at different layers

| Tool | Role in this design |
|---|---|
| Vite | Development/build tooling that produces deployable frontend assets. |
| React | Component rendering and local interaction. |
| TanStack Router | Typed routes, route/search state, navigation and route boundaries. |
| TanStack Query | Remote query caching, invalidation, pagination and explicit mutation state. |
| TanStack Start | An optional full-stack framework; not needed by this decision. |

Vite's production build can be served as static assets. TanStack Router is designed to work with client-side data caches, and Start adds full-stack/server features around routing. This makes “Vite or TanStack?” a false binary for the proposed architecture. [S01–S04](12-SOURCES-AND-EVIDENCE.md#primary-technology-sources).

## Recommended dependency policy

| Layer | Selection | Boundary |
|---|---|---|
| Build | Vite, React plugin, TypeScript | Build/dev dependencies; run an independent typecheck. |
| UI | React, React DOM | Client rendering only; no SSR/server components needed. |
| Routes | `@tanstack/react-router` and supported tooling | Route state only; avoid a second competing server-data cache. |
| Remote data | `@tanstack/react-query` | Queries for projects/models/history/health; explicit send mutation, no automatic run retries. |
| Styles | Tailwind CSS with its Vite integration | Tokens own the design language; utility classes do not replace the UX specification. |
| Primitives | Selected shadcn/ui components, consistently Radix-based for this plan | Dialog, menu, tabs, tooltip, scroll area and supporting pieces only. Verify current generated components when installing. |
| Icons | Lucide React | Import only used icons; no icon font or CDN dependency. |
| Markdown | Marked + DOMPurify, bundled locally | Preserve behavior while moving to imports; a single fail-closed rendering boundary. |
| State | React state/reducers plus a small subscribed run store | No Redux/Zustand requirement initially. |
| Tests | Vitest, React Testing Library, Playwright, axe integration | Node built-in test runner remains suitable for dependency-free server units. |
| Long lists | TanStack Virtual, only if measurement justifies it | Do not add before stable IDs, pagination and scroll-anchor tests. |
| Code inspection | Lazy syntax renderer; editor framework deferred | Start read-only. CodeMirror/Monaco is not necessary for launch. |

Do not pin versions in this planning document to guessed latest releases. ZWUI-002 resolves compatible supported versions on Node 24, records them in a lockfile, checks current advisories and license notices, and verifies the exact resolved graph. The supplied archive's dependency versions are not an approved dependency set.

Official integration references: [Vite and React](12-SOURCES-AND-EVIDENCE.md#primary-technology-sources), [Tailwind/shadcn/Radix](12-SOURCES-AND-EVIDENCE.md#primary-ui-and-testing-sources).

## Why this fits this repository

The core product is an authenticated interactive workspace rather than a public indexable document site. Its existing API already owns the difficult server work. Keeping that boundary avoids migrating auth, process orchestration, uploads and host-share history while also replacing the UI.

The reference is React/TSX, so its presentation concepts transfer without switching the component language. Router and Query provide useful organization for multiple sessions, deep links, paginated history and stale responses; they do not themselves solve stream deduplication or job identity. Those remain explicit application contracts.

The production server serves one built bundle and the existing API. There is no requirement to run Vite in production or add a second application server. Frontend rendering work belongs to the browser; CLI execution remains server-side.

## Alternatives considered

| Alternative | Assessment |
|---|---|
| Vanilla JavaScript + custom CSS | Still viable for a small chat UI. With resizable panes, route state, menus, drafts and stream ownership, the maintenance burden is less attractive for this redesign. |
| Vite + React without Router/Query | Fewer dependencies but more hand-built navigation/cache behavior. Suitable only if the product retreats to one screen and no deep-link/history requirements. |
| Vite + Vue or Svelte | Technically valid. Would rewrite the supplied React presentation concepts without a concrete project requirement that compensates for that work. |
| React Router instead of TanStack Router | A valid substitute if the team already standardizes on it. Choose one router; do not mix them. |
| TanStack Start | It can support SPA-oriented applications; rejection is about unnecessary scope, not inability. Revisit only for a deliberate full-stack/server-function requirement. |
| Next.js | Excluded by user preference and unnecessary for the retained backend architecture. |
| A simultaneous backend framework migration | Deferred. Separate any future Node/Lugas/other backend decision from this frontend change to keep regressions attributable. |

## Query and state rules

Configure Query deliberately rather than relying on all defaults. In particular, avoid focus-triggered history refetches overwriting a live transcript and avoid repeated authentication requests. Disable retries for auth/validation errors. A send command is not a background query and cannot be automatically retried without the server's idempotency contract. [S05](12-SOURCES-AND-EVIDENCE.md#primary-technology-sources).

Router owns route identity. Query owns server snapshots. The run store owns live event accumulation. Draft storage owns unsent input. Do not duplicate the full workspace in multiple stores. Router loaders may prefetch through the same Query client rather than creating a second authoritative cache.

## Consequences

The server can remain dependency-free at runtime, but the **whole repository can no longer honestly claim zero npm dependencies**. Update documentation to distinguish the Node service from frontend/build tooling. The frontend bundle will be larger than the current vanilla client; measure it rather than assuming React is free.

This choice does not itself provide browser execution of the ZCode CLI, a preview sandbox, safe file access, collaboration or public deployment. Those are different product and security decisions.
