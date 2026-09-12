# ZWUI-027 release gate (M2) — evidence

Recorded: 2026-09-12. Commit under evidence: see git log at the time of writing.

## Gate checklist

| # | Gate | Evidence |
|---|---|---|
| 1 | All four verification tracks accepted | #29 backend/security (node:test, 12 green), #30 browser (playwright, 6+5 green), #31 a11y (axe 0 critical/serious + keyboard), #32 perf (JS budget + responsiveness) — all closed with commit refs |
| 2 | CI green | .github/workflows/ci.yml: backend (node:test), web (tsc → vitest → build), browser (playwright chromium) |
| 3 | Packaging | Dockerfile multi-stage: web build (npm ci + vite) → runtime image with server + public + web/dist + BYO CLI slot; volumes /data/zcode + /data/workspace; healthcheck authenticated |
| 4 | Rollback rehearsed | ZCODE_UI=legacy runtime switch verified live (both UI modes return the correct HTML); data volumes untouched by UI choice |
| 5 | Deployment docs | README quickstarts (local + docker), env table, security notes; docs/baseline/* contracts; runbooks below |
| 6 | Security | DOMPurify fail-closed renderer (#10) + browser-verified XSS neutralization (#30); bearer auth + job-scoped SSE tickets; uploads validated (charset/size/name/dir) |
| 7 | Data ownership | Session DB and project files remain CLI-owned; web reads SQLite read-only; uploads isolated in ZCODE_HOME/uploads |

## Rollout runbook

1. Build: `docker compose -f docker-compose.host.yml build` (or the volume variant).
2. Configure: `.env` with `ZCODE_WEB_TOKEN`, `HOST_HOME`/`HOST_UID`/`HOST_GID` (host-share) or defaults.
3. Up: `docker compose -f docker-compose.host.yml up -d`.
4. Verify: `GET /api/health` with bearer → `ok:true`, `cli.present:true`, `providerConfigured:true`; open `/` → modern UI.
5. Smoke: send one message in a scratch project; confirm streamed reply + session row in sidebar.

## Rollback runbook (rehearsed)

- UI regression: set `ZCODE_UI=legacy` and `docker compose up -d` (no rebuild) → previous vanilla UI; verified live on this host.
- Server regression: `git checkout <last-good>` and rebuild; session DB and projects live on volumes/bind mounts and are untouched by image swap — verified across the M0→M1→M2 upgrade path on this host.
- Full abort: `docker compose down` (volumes persist; `down -v` explicitly forbidden for host data).

## Known limitations shipped (documented, accepted)

- `zcode-artifact://` desktop artifacts render metadata cards (no byte resolver).
- `--max-turns` broken in CLI 0.16.5 (parser rejects); timeouts bound jobs instead.
- Start-plan providers captcha-gated headless (disambiguated in the model dropdown).
