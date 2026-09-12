# Lugas migration gate evidence (#43)

Run: 2026-09-12, lugas@0.1.0-beta.4 (npm) on Bun 1.4.0, server-lugas/ @ this commit.
Env: `ZCODE_CLI_NODE` = nvm node v24.11.0, `ZCODE_CLI_ENTRY` = host zcode.cjs 0.16.5,
`ZCODE_ALLOWED_ROOTS` = ~/.zcode/workspace:/tmp/zc-lugas-ws, token auth on.

| Gate | Result | Evidence |
|---|---|---|
| G1 explicit CLI runtime | **PASS** | `/api/health` cliRuntime `{executable: nvm/.../node, present: true, isExplicit: true}`; process tree: Bun server (pid A) → child `zcode-cli` exe = `.../v24.11.0/bin/node`; unset/missing ZCODE_CLI_NODE fails job spawn closed (503) |
| G2 history compatibility | **PASS** | `node:sqlite` opened read-only under Bun; 9 sessions listed; 460-message session transcript paginates (limit/offset, hasMore) with grouped tools/files; concurrent CLI writes (this desktop session) visible |
| G3 HTTP contract parity | **PASS** | 401 without bearer on /api/config; /api/models 3 entries; /api/projects roots grouped; /api/sessions?cwd; /api/sessions/:id pagination; legacy `?token=` on SSE 401s; JSON error envelope `{error}` |
| G4 streaming & lifecycle | **PASS** | lugas `sse()` streamed 231 live envelope events incl. `model.streaming` deltas via `?ticket=`; early client disconnect (2s) left the CLI job running (child alive minutes later — cancel stays explicit); post-run replay re-served the full buffer (5,630 events) to a second ticket holder |
| G5 deployment & rollback | **PASS** | `Dockerfile.lugas`: Bun 1.4.0 (pinned) + Node 24.21.0 in one image, `ZCODE_CLI_NODE=/usr/local/bin/node` baked; container rehearsal — bun server → CLI job (fake CLI) → session row written to the volume DB via the node child (host-uid-readable: `{c:1}`); rollback: the SAME volume on the node-only image (`zcode-web:node`) listed the lugas-written session (`sessions: 1`) and served the UI; forward again on lugas — zero data loss either way. Runbook: run containers as `--user $(id -u):$(id -g)` or the CLI's root-owned db is unreadable to the host user |

## Container-specific findings (G5)

1. `VOLUME [/data/zcode, /data/workspace]` in an image shadows a single
   `/data` bind (Docker plants anonymous volumes at those paths). Mount the
   two paths explicitly: `-v $PWD/data/zcode:/data/zcode -v
   $PWD/data/workspace:/data/workspace`.
2. The lugas server default `HOST` is now `0.0.0.0` — a loopback bind is
   unreachable through `docker -p`.
3. Headless CLI runs need a provider config (`~/.zcode/cli/config.json`)
   even for smoke tests; the fake CLI bypasses this for runtime proofs.

## What is NOT yet claimed

- Load/soak behavior under concurrent jobs (only single-job runs exercised).
- Static asset serving of the Vite build inside the lugas image (works on the
  Node image; lugas `assets` config currently lists the legacy files only).

## Notes for the Lugas framework (feedback from real use)

1. `sse()` + tickets compose cleanly; the cleanup contract (return unsubscribe fn) mapped exactly onto our subscriber model.
2. `assets.files` worked for the legacy UI's five files; a `dirs` mount or SPA-fallback `notFound` needs verifying once the Vite app lands (ZWUI-003).
3. `app.serve({ maxRequestBodySize })` handled the upload ceiling; our base64+JSON route still self-validates lengths identically to Node.
4. `node:sqlite` under Bun 1.4.0 worked for every read path exercised — no `bun:sqlite` fallback needed so far (driver label records which ran).
5. Boot log prints `server.url` as a URL object — cosmetic; a string would be nicer.

## What is NOT yet claimed

- G5 (dual-runtime image + rollback rehearsal).
- Static asset serving of the Vite build (dir mounts) — blocked on ZWUI-002/003.
- Load/soak behavior under concurrent jobs (only single-job runs exercised).
