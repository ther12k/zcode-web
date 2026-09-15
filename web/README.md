# zcode-web frontend (React + Vite)

The browser client served by the zero-dependency Node server in the repo
root (`server/index.js`). Built output lands in `web/dist/` and is served
from there — the dev server is for development only; the production server
never runs Vite. The legacy vanilla UI under `public/` remains as an
explicit rollback surface (`ZCODE_UI=legacy`).

## Commands

Run from the **repository root** (not this folder):

```bash
npm --prefix web install        # once, after cloning
npm run typecheck               # tsc -b web/tsconfig.json
npm --prefix web run dev        # Vite dev server (dev only)
npm --prefix web run lint       # oxlint
npm --prefix web run build      # production build → web/dist
npm run test:unit               # vitest unit tests (web/src)
npm run test:server             # backend/security tests against the real server + fake CLI
npm run test:e2e                # build, then Playwright browser tests (port 3472)
```

`npm run serve:test` starts the production server on `127.0.0.1:3472` with
the fake CLI, a synthetic workspace (`.e2e-ws/`), an isolated home
(`.e2e-home/`), and the Files/Git capabilities enabled — exactly what the
Playwright suite expects. The browser tests need
`npm --prefix web run build` first: they exercise the BUILT bundle, not the
dev server.

## Architecture map

- `src/App.tsx` — the workspace shell (sidebar, topbar, statusbar, dialogs).
  Reads capabilities and preferences from the workspace context.
- `src/workspace.tsx` — one app-wide API client + capabilities + prefs
  context. Capability-discovery failure (`capsError`) is distinct from
  loading, so the shell can offer a retry instead of hanging (ZWUI-065).
- `src/state/runManager.ts` — job-keyed external store owning runs/streams;
  panels subscribe, never own (ZWUI-050). `activeRunCount()` feeds the
  statusbar's "N running".
- `src/state/stream.ts` — ticketed SSE transport: single-use tickets,
  Last-Event-ID replay, rotation on `ticket-expired` (ZWUI-061).
- `src/components/ChatPanel.tsx` — conversation view: history pagination by
  stable turn id (ZWUI-062), live run block folded once its persisted turn
  lands (ZWUI-063), callID-keyed tool evidence (ZWUI-064), slash palette,
  composer.
- `src/components/RightPanel.tsx` — inspector tabs (overview, preview, code,
  changes, issues); git status codes are decoded into words (ZWUI-067).
- `src/auth/` — token persistence + capability contract discovery with an
  explicit `authState: ok | unauthorized | unreachable` (ZWUI-065).
- `src/state/prefs.ts` — versioned localStorage preferences; every save
  dispatches the `zcode-prefs` event so React state stays in sync.

## Constraints worth keeping

- Runtime deps stay minimal (React + router + icons) and DOMPurify guards
  all Markdown (ZWUI-015, fail-closed). Do not render model output as raw
  HTML.
- The bearer token lives in `localStorage` (`zcode-web-token`) and travels
  only to this server. SSE uses short-lived single-use tickets so the token
  never appears in a URL.
- Tests must never use real tokens — only the `e2e-token` fixture.
- Styling/design tokens per `docs/planning/zcode-web-ui-ux-pack/` — keep new
  components on the shared tokens instead of ad-hoc colors.
