// zcode-web server — zero-dependency Node 24 HTTP server.
// Serves the static UI from ./public and a small JSON + SSE API that drives
// the ZCode CLI headless (see server/zcode.js).

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { JobManager, cliStatus, config } from "./zcode.js";
import { SessionStore } from "./sessions.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = (process.env.ZCODE_WEB_TOKEN || "").trim();
const WORKSPACE_ROOT = resolve(process.env.ZCODE_WORKSPACE_ROOT || join(homedir(), "Workspace"));

const jobs = new JobManager();
const store = new SessionStore(cliStatus().dbPath);

mkdirSync(WORKSPACE_ROOT, { recursive: true });

// ---------- helpers ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isAuthorized(req, url) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token") || "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Resolve and validate a project directory: must stay under WORKSPACE_ROOT.
// Accepts absolute paths already under the root, or relative names.
function safeCwd(input) {
  const base = input && input.trim() ? input : WORKSPACE_ROOT;
  const dir = resolve(base);
  if (dir === WORKSPACE_ROOT || dir.startsWith(WORKSPACE_ROOT + sep)) return dir;
  const rel = resolve(WORKSPACE_ROOT, "." + sep + base.replace(/^\/+/, ""));
  if (rel.startsWith(WORKSPACE_ROOT + sep) || rel === WORKSPACE_ROOT) return rel;
  throw Object.assign(new Error("cwd must be inside the workspace root"), { status: 400 });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep) && file !== join(PUBLIC_DIR, "index.html")) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  if (!existsSync(file) || extname(file) === "") {
    // SPA-ish fallback for unknown routes
    sendJson(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(readFileSync(file));
}

function providerConfigured() {
  try {
    const cfg = JSON.parse(readFileSync(cliStatus().configPath, "utf8"));
    return Boolean(cfg?.model?.main || typeof cfg?.model === "string");
  } catch {
    return false;
  }
}

// Enumerate provider/model pairs from the CLI's user config, for the UI
// selector. Internal entries carry the provider apiKey (server-side only —
// never send to the client). Returns [] when unconfigured.
function listModels({ withKeys = false } = {}) {
  try {
    const cfg = JSON.parse(readFileSync(cliStatus().configPath, "utf8"));
    const providers = cfg.provider || {};
    const main = cfg.model?.main || (typeof cfg.model === "string" ? cfg.model : null);
    const out = [];
    for (const [id, p] of Object.entries(providers)) {
      const models = p?.models || {};
      for (const modelId of Object.keys(models)) {
        const ref = `${id}/${modelId}`;
        out.push({
          ref,
          provider: id,
          providerName: p.name || id,
          model: modelId,
          isDefault: ref === main,
          ...(withKeys
            ? { apiKey: p.options?.apiKey || null, baseURL: p.options?.baseURL || null }
            : {}),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === "/api/health") {
    const cli = cliStatus();
    return sendJson(res, 200, {
      ok: true,
      cli: { entry: cli.entry, present: cli.present },
      db: { path: cli.dbPath, present: cli.dbPresent },
      providerConfigured: providerConfigured(),
      workspaceRoot: WORKSPACE_ROOT,
      activeJobs: jobs.activeCount,
      maxJobs: config.maxJobs,
      authRequired: Boolean(TOKEN),
    });
  }

  if (route === "/api/config") {
    return sendJson(res, 200, {
      authRequired: Boolean(TOKEN),
      workspaceRoot: WORKSPACE_ROOT,
      modes: config.allowedModes,
      defaultMode: "plan",
      cliPresent: cliStatus().present,
      providerConfigured: providerConfigured(),
    });
  }

  if (route === "/api/projects" && req.method === "GET") {
    const dirs = readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
    return sendJson(res, 200, { root: WORKSPACE_ROOT, projects: dirs });
  }

  if (route === "/api/projects" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const name = String(body.name || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      return sendJson(res, 400, { error: "invalid project name" });
    }
    const dir = join(WORKSPACE_ROOT, name);
    if (existsSync(dir)) return sendJson(res, 409, { error: "project already exists" });
    mkdirSync(dir, { recursive: true });
    return sendJson(res, 201, { name, directory: dir });
  }

  if (route === "/api/sessions" && req.method === "GET") {
    let dir = WORKSPACE_ROOT;
    try {
      dir = safeCwd(url.searchParams.get("cwd"));
    } catch {
      return sendJson(res, 400, { error: "cwd outside workspace root" });
    }
    return sendJson(res, 200, { cwd: dir, sessions: store.list(dir) });
  }

  const sessionMatch = route.match(/^\/api\/sessions\/(sess_[A-Za-z0-9-]+)$/);
  if (sessionMatch && req.method === "GET") {
    const session = store.get(sessionMatch[1]);
    if (!session) return sendJson(res, 404, { error: "session not found" });
    return sendJson(res, 200, { session, transcript: store.transcript(session.id) });
  }

  if (route === "/api/models" && req.method === "GET") {
    return sendJson(res, 200, { models: listModels() });
  }

  if (route === "/api/chat" && req.method === "POST") {
    const body = JSON.parse(await readBody(req, 1024 * 1024));
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });
    let cwd;
    try {
      cwd = safeCwd(body.cwd);
      mkdirSync(cwd, { recursive: true });
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message });
    }
    const sessionId = body.sessionId && /^sess_[A-Za-z0-9-]+$/.test(body.sessionId) ? body.sessionId : null;
    const mode = config.allowedModes.includes(body.mode) ? body.mode : "plan";
    // model must be a configured provider/model pair — never a free string
    const modelEntry = listModels({ withKeys: true }).find((m) => m.ref === body.model) || null;
    try {
      const job = jobs.start({
        text,
        sessionId,
        cwd,
        mode,
        model: modelEntry?.ref || null,
        modelApiKey: modelEntry?.apiKey || null,
        modelBaseUrl: modelEntry?.baseURL || null,
      });
      return sendJson(res, 202, { jobId: job.id, sessionId: job.sessionId, cwd, mode, model: modelEntry?.ref || null });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  const cancelMatch = route.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const canceled = jobs.cancel(cancelMatch[1]);
    return sendJson(res, canceled ? 200 : 404, canceled ? { canceled: true } : { error: "job not found or already finished" });
  }

  // SSE: stream job events. Token may be passed via ?token= since EventSource
  // cannot set headers.
  const eventsMatch = route.match(/^\/api\/events\/([0-9a-f-]+)$/);
  if (eventsMatch && req.method === "GET") {
    const job = jobs.get(eventsMatch[1]);
    if (!job) return sendJson(res, 404, { error: "job not found" });
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const write = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    for (const line of job.lines) write({ kind: "line", line });
    if (job.done) {
      write({ kind: "done", exitCode: job.exitCode, error: job.error, sessionId: job.sessionId });
      return res.end();
    }
    job.subscribers.add(write);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    const drop = () => {
      clearInterval(heartbeat);
      job.subscribers.delete(write);
    };
    req.on("close", drop);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

// ---------- server ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    return serveStatic(res, url.pathname);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message || "internal error" });
  }
});

server.listen(PORT, HOST, () => {
  const cli = cliStatus();
  console.log(`zcode-web listening on http://${HOST}:${PORT}`);
  console.log(`  cli entry : ${cli.entry} (${cli.present ? "found" : "MISSING"})`);
  console.log(`  zcode home: ${config.zcodeHome}`);
  console.log(`  sessions db: ${cli.dbPath} (${cli.dbPresent ? "found" : "not yet created"})`);
  console.log(`  workspace : ${WORKSPACE_ROOT}`);
  console.log(`  auth      : ${TOKEN ? "bearer token required" : "OPEN (set ZCODE_WEB_TOKEN!)"}`);
});
