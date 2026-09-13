# zcode-web

A self-hosted **web UI for the ZCode CLI agent**. Chat with the agent from any
browser, pick/create project directories on the server, and every session is
persisted by the CLI itself (`~/.zcode/cli/db/db.sqlite`) — the same store the
ZCode Desktop app reads, so sessions started here show up there when both run
on the same machine.

```
Browser ──HTTP/SSE──> zcode-web server (this repo, zero-dep Node 24)
                          │
                          │ spawns per message, headless
                          ▼
                  ZCode CLI bundle (zcode.cjs)
                  --prompt … --output-format stream-json --cwd <project>
                          │
                          ▼
              ~/.zcode/cli/db/db.sqlite  +  your project files
```

- **Runs anywhere**: locally next to the desktop app, or containerized on a
  server (Dockerfile + compose included; projects live in a volume).
- **Sessions resume**: the UI lists past sessions per project and continues
  them via the CLI's `--resume <sessionId>`.
- **Model switcher**: pick any `provider/model` pair from your CLI config per
  message (like the desktop's model/plan selector) — served per-run via the
  CLI's `ZCODE_MODEL` env override.
- **Streaming**: CLI events stream to the browser over SSE — model activity,
  reasoning (collapsible thinking block), errors, and live responses.
- **Artifacts**: displays tool execution cards (Bash, file edits, etc.) and
  persisted file/image artifacts from the CLI session database.
- **Image & File Uploads**: attach local files or images directly via the paperclip
  button; securely saved and forwarded to the agent using `--attach`.
- **Zero npm dependencies**; Node's built-in `http`, `child_process`, `sqlite`.
- **Zero npm dependencies**; Node's built-in `http`, `child_process`, `sqlite`.

> ⚠️ **This is an agent with shell access.** Anyone who can reach the server
> and token can run commands inside it (in `yolo` mode without asking). Set
> `ZCODE_WEB_TOKEN`, keep the port private or behind a VPN/tunnel, and prefer
> the `plan` mode default. Unofficial project — not affiliated with Z.AI.

## Requirements

- Node.js **>= 24** (for the server and the CLI bundle)
- The ZCode CLI bundle `zcode.cjs` from a ZCode Desktop install — see
  [cli/README.md](cli/README.md). It is proprietary and not committed here.
- A model provider configured for headless use (API-key based). If you already
  use ZCode Desktop on the machine, `scripts/setup-host.sh` derives
  `~/.zcode/cli/config.json` from the desktop's login automatically.

## Quickstart (local)

```bash
git clone https://github.com/ther12k/zcode-web && cd zcode-web

# 1. copy the CLI bundle from your desktop install
cp /opt/ZCode/resources/glm/zcode.cjs cli/zcode.cjs

# 2. derive headless model config from the desktop app (one-time)
./scripts/setup-host.sh

# 3. run
ZCODE_CLI_ENTRY="$PWD/cli/zcode.cjs" \
ZCODE_WORKSPACE_ROOT="$HOME/Workspace" \
ZCODE_WEB_TOKEN=some-long-random-value \
npm start
# → http://localhost:3000
```

## Quickstart (Docker)

```bash
cp /opt/ZCode/resources/glm/zcode.cjs cli/zcode.cjs   # bundle gets baked in / mounted

# CLI state: config + sessions db. Copy from a host set up above, or create manually:
mkdir -p data/zcode/cli
cp ~/.zcode/cli/config.json data/zcode/cli/config.json   # provider registry + model.main

ZCODE_WEB_TOKEN=some-long-random-value docker compose up -d --build
# → http://<server>:3000
```

The first run creates `data/workspace/` — your projects. Create them from the
UI (`+ project`) or `git clone` into the volume.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server listen address |
| `ZCODE_WEB_TOKEN` | *(none — OPEN!)* | Bearer token for the UI/API. **Set it.** |
| `ZCODE_CLI_ENTRY` | `/opt/zcode/zcode.cjs` | Path to the CLI bundle |
| `ZCODE_HOME` | `~/.zcode` | Where the CLI keeps config + session db |
| `ZCODE_WORKSPACE_ROOT` | `~/Workspace` | Root dir for projects (cwd of agent runs) |
| `ZCODE_ALLOWED_MODES` | `plan,build,edit,yolo` | Permission modes offered in the UI |
| `ZCODE_MAX_JOBS` | `3` | Concurrent CLI runs |
| `ZCODE_JOB_TIMEOUT_MS` | `900000` | Hard kill for a single agent run (15 min) |
| `ZCODE_CLI_NODE` | *(inherited runtime)* | Explicit Node ≥ 24 executable that runs the CLI child (required under a Bun-hosted server) |
| `ZCODE_ENABLE_FILES` | `0` | Read-only file list/read API for the Code inspector |
| `ZCODE_ENABLE_GIT` | `0` | Read-only git status/diff API for the Changes inspector and branch chip |
| `ZCODE_ENABLE_PREVIEW` | `0` (+ `ZCODE_PREVIEW_ORIGIN`) | Static script-stripped snapshot preview |

### Headless model config (`~/.zcode/cli/config.json`)

The headless CLI needs an explicit provider (the desktop passes its own at
spawn time; a bare install does not). Working shape, verified on CLI 0.16.5:

```json
{
  "provider": {
    "zai-coding-plan": {
      "name": "Z.AI Coding Plan",
      "kind": "anthropic",
      "options": { "apiKey": "…", "baseURL": "https://api.z.ai/api/anthropic" },
      "models": { "GLM-5.3": { "name": "GLM-5.3" } }
    }
  },
  "model": { "main": "zai-coding-plan/GLM-5.3" }
}
```

`scripts/setup-host.sh` writes exactly this from the desktop's
`~/.zcode/v2/config.json`. OAuth-only providers (empty `apiKey`) and some
start-plan keys (captcha-gated) do **not** work headless.

### Per-run model override (how the selector works)

The CLI supports `ZCODE_MODEL=provider/model` as an env override — but the
env-sourced provider entry **shadows** the same provider in `config.json`,
dropping its `apiKey` and `baseURL`. So a working override needs all three
(together in the spawned process env):

```bash
ZCODE_MODEL=zai-coding-plan/GLM-5.3-Flash \
ZCODE_API_KEY=<provider key> \
ZCODE_BASE_URL=https://api.z.ai/api/anthropic \
node zcode.cjs --prompt …
```

The zcode-web server does this automatically, taking the key and base URL
from its config. Without them the turn fails with `provider_not_configured`
or an auth error against the wrong endpoint.

## API

All routes sit behind the bearer token when `ZCODE_WEB_TOKEN` is set. The
inspector groups are additionally flag-gated and restricted to allowed roots.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | CLI bundle/db/runtime presence, provider config, job slots |
| GET | `/api/config` | UI bootstrap (modes, allowed roots, auth required) |
| GET/POST | `/api/projects` | List / create project dirs under the workspace root |
| GET | `/api/models` | Available model providers from the CLI configuration |
| GET | `/api/skills` | Real ZCode skills via the CLI (`skills list --json`, 60s cache) |
| GET | `/api/sessions?cwd=…` | Sessions the CLI stored for a project |
| GET | `/api/sessions/recent?root=…` | Recent sessions across a root |
| GET | `/api/sessions/:id` | Session metadata + text transcript |
| POST | `/api/chat` | `{text, sessionId?, cwd?, mode?, model?}` → `{jobId}` |
| GET | `/api/events/:jobId` | Ticketed SSE stream of CLI events for a job |
| GET | `/api/jobs/:id` | Job status (reconciliation for dropped streams) |
| POST | `/api/jobs/:id/cancel` | Kill a running job |
| POST | `/api/upload` | Upload image or file attachment (base64 JSON body) |
| GET | `/api/uploads/:file` | Serve an uploaded attachment file |
| GET | `/api/search?q=…` | Bounded server-wide session search |
| GET | `/api/files/capability` | Whether read-only file access is on (`ZCODE_ENABLE_FILES=1`) |
| GET | `/api/files/list?dir=…` | Directory listing inside an allowed root |
| GET | `/api/files/:path` | Read a text file inside an allowed root |
| GET | `/api/git/status?cwd=…` | Branch + porcelain status (`ZCODE_ENABLE_GIT=1`) |
| GET | `/api/git/diff?cwd=&path=` | Unified diff for one file |
| GET | `/api/preview/capability` | Whether static preview is on (`ZCODE_ENABLE_PREVIEW=1`) |
| POST | `/api/preview/build` | Build a script-stripped static snapshot of a project |
| GET | `/api/preview/:id/:asset` | Serve snapshot assets (isolated, no scripts) |

## Notes & limitations

- **Streaming shapes**: the renderer handles the event envelope
  `{payload:{type,text,error,…}, sessionId, …}` defensively; new CLI versions
  may add event types that simply show up as activity lines.
- **Quota**: Z.AI coding plans have 5-hour usage windows — a 429 arrives as a
  regular error event in the chat (and the reset time is in the message).
- **`--max-turns` is currently broken in the CLI 0.16.5** (listed in help,
  rejected by the parser) — bound runs with `ZCODE_JOB_TIMEOUT_MS` instead.
- Sessions created on a **server** live in that server's db and won't appear
  in your local desktop app (separate machines, separate stores).

## License

MIT — see [LICENSE](LICENSE). `zcode.cjs` and your credentials are yours;
never commit or ship them.
