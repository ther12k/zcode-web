// zcode-web server — zero-dependency Node 24 HTTP server.
// Serves the static UI from ./public and a small JSON + SSE API that drives
// the ZCode CLI headless (see server/zcode.js).

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { JobManager, cliStatus, cliRuntimeStatus, config, uploadsDir } from "./zcode.js";
import { ContentSearchIndex, renameSession } from "./sessions.js";
import { SessionStore } from "./sessions.js";
import { githubCapability, fetchIssue, fetchComments, validOwner, validRepo } from "./github.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
// ZWUI-003: modern UI (built Vite app) is the default surface; the legacy
// vanilla UI remains as an explicit rollback (ZCODE_UI=legacy).
const UI_MODE = (process.env.ZCODE_UI || "modern").trim(); // modern | legacy
const WEB_DIST = join(ROOT, "web", "dist");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = (process.env.ZCODE_WEB_TOKEN || "").trim();
const WORKSPACE_ROOT = resolve(process.env.ZCODE_WORKSPACE_ROOT || join(homedir(), "Workspace"));
// Additional browsable roots (colon-separated), e.g. the desktop app's own
// workspace dir in host-share mode. The workspace root is always allowed.
const ALLOWED_ROOTS = [
  ...new Set(
    [WORKSPACE_ROOT, ...(process.env.ZCODE_ALLOWED_ROOTS || "").split(":")]
      .map((r) => r && r.trim() && resolve(r))
      .filter(Boolean)
  ),
];

const jobs = new JobManager();
const store = new SessionStore(cliStatus().dbPath);
// prompt attachments per message — enforced here and advertised to the
// composer so over-limit files are rejected at pick time, not at send
const MAX_ATTACHMENTS = 5;
// sidecar FTS index for message-content search — our own file, the CLI's
// session DB is never written
const contentIndex = new ContentSearchIndex(
  join(config.zcodeHome, "web", "search-index.sqlite"),
  cliStatus().dbPath,
);
const TERMINAL_STATUS = new Set(["succeeded", "failed", "cancelled", "timeout"]);

// THE one session-activity resolver (detail, list, and recent all use it —
// a session must not read idle in detail while its sidebar row pulses).
// The store's heuristic reads the newest message's time.completed: a turn
// cancelled/failed mid-stream leaves that null and looks busy until the
// recency window expires. The job registry's terminal verdict overrides it
// when the run finished at/after the newest message started. Known limit:
// the timestamp comparison cannot prove message OWNERSHIP — a different
// writer starting a turn just before this run finished could be suppressed;
// fixing that needs turn identity in the protocol, not timestamps.
function sessionRunState(sessionId, storeRunInfo) {
  if (!storeRunInfo.active) return storeRunInfo;
  const lastJob = jobs.lastJobForSession(sessionId);
  if (lastJob && TERMINAL_STATUS.has(lastJob.status) && lastJob.finishedAt && (storeRunInfo.startedAt ?? 0) <= lastJob.finishedAt) {
    return { active: false, startedAt: null };
  }
  return storeRunInfo;
}

// Short-lived tickets let EventSource connect without putting the long-lived
// bearer token in the URL (which leaks into proxy logs / history). A ticket
// is bound to one job and expires with it.
const sseTickets = new Map(); // ticket -> { jobId, exp }
function issueSseTicket(jobId) {
  for (const [t, v] of sseTickets) if (v.exp < Date.now()) sseTickets.delete(t);
  const ticket = randomBytes(24).toString("hex");
  sseTickets.set(ticket, { jobId, exp: Date.now() + config.jobTimeoutMs + 60_000 });
  return ticket;
}
// ZWUI-061: a ticket is a short-lived connection credential, not a session
// token — it is consumed on first successful use. A replayed ticket gets the
// explicit ticket-expired marker (not a bare 401) so a reconnecting client
// rotates cleanly instead of retrying a dead credential.
function consumeSseTicket(ticket, jobId) {
  const key = String(ticket || "");
  const v = sseTickets.get(key);
  if (v && v.jobId === jobId && v.exp > Date.now()) {
    sseTickets.delete(key);
    return true;
  }
  return false;
}

mkdirSync(WORKSPACE_ROOT, { recursive: true });

// ---------- helpers ----------

// ZWUI-060: lexical checks cannot see symlinks — a path that resolves inside
// a root on paper may point anywhere on disk. Policy: resolve the REAL path
// of the deepest existing ancestor, rejoin the not-yet-existing remainder,
// and require containment against the equally-realified roots. Symlinked
// directories (or files) that escape a root are rejected even when their
// lexical spelling is inside.
function realpathOf(p) {
  let abs = resolve(String(p));
  const trail = [];
  for (;;) {
    try {
      return join(realpathSync(abs), ...trail.reverse());
    } catch (err) {
      if (err.code !== "ENOENT") return abs; // EACCES etc: lexical fallback
      const parent = dirname(abs);
      if (parent === abs) return abs; // reached the filesystem root
      trail.push(basename(abs));
      abs = parent;
    }
  }
}

function insideRoot(abs, root) {
  return abs === root || abs.startsWith(root + sep);
}

// Roots are realpathified once at startup (e.g. macOS /tmp → /private/tmp)
// so every containment check compares real path to real root.
const REAL_ROOTS = ALLOWED_ROOTS.map(realpathOf);
const insideAllowedRoots = (abs) => REAL_ROOTS.some((root) => insideRoot(abs, root));

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

// ZWUI-061: the promise settles exactly once — an oversize body no longer
// leaves the promise pending when 'end' arrives after the 413 rejection, and
// listeners are removed once settled so aborted requests cannot resolve a
// promise nobody awaits anymore.
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolveBody, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      if (err) reject(err);
      else resolveBody(value);
    };
    const onData = (c) => {
      size += c.length;
      if (size > limit) {
        // drain so the 413 response can still be written; Node closes the
        // connection after the response ends
        req.resume();
        finish(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(c);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks).toString("utf8"));
    const onError = (err) => finish(err);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function isAuthorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Resolve and validate a project directory: must be an absolute path inside
// one of the allowed roots, or a relative name resolved under the primary
// workspace root. ZWUI-060: the containment verdict uses the REAL path, so a
// symlink that leaves the roots is rejected even though its spelling is inside.
function safeCwd(input) {
  if (!input || !String(input).trim()) return WORKSPACE_ROOT;
  const dir = resolve(String(input));
  if (ALLOWED_ROOTS.some((root) => dir === root || dir.startsWith(root + sep))) {
    if (!insideAllowedRoots(realpathOf(dir))) {
      throw Object.assign(new Error("cwd must be inside an allowed root: " + ALLOWED_ROOTS.join(", ")), { status: 400 });
    }
    return dir;
  }
  const rel = resolve(WORKSPACE_ROOT, "." + sep + dir.replace(/^\/+/, ""));
  if (ALLOWED_ROOTS.some((root) => rel === root || rel.startsWith(root + sep))) {
    if (!insideAllowedRoots(realpathOf(rel))) {
      throw Object.assign(new Error("cwd must be inside an allowed root: " + ALLOWED_ROOTS.join(", ")), { status: 400 });
    }
    return rel;
  }
  throw Object.assign(new Error("cwd must be inside an allowed root: " + ALLOWED_ROOTS.join(", ")), { status: 400 });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv",
  ".log": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res, pathname) {
  const serveFile = (file, cache = "no-store") => {
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      // no-store: UI updates must be picked up on a normal refresh
      "cache-control": cache,
    });
    res.end(readFileSync(file));
  };

  if (UI_MODE === "modern" && existsSync(join(WEB_DIST, "index.html"))) {
    // hashed Vite assets are content-addressed → immutable caching
    const assetsDir = join(WEB_DIST, "assets");
    if (pathname.startsWith("/assets/")) {
      const asset = normalize(join(assetsDir, pathname.slice("/assets/".length)));
      if (asset.startsWith(assetsDir + sep) && existsSync(asset)) {
        return serveFile(asset, "public, max-age=31536000, immutable");
      }
      return sendJson(res, 404, { error: "not found" });
    }
    // public/ files copied verbatim by Vite (fonts, icons) — served with a
    // name-spaced denylist so nothing under WEB_DIST but outside public
    // intent can be requested
    if (pathname.startsWith("/fonts/")) {
      const font = normalize(join(WEB_DIST, "fonts", pathname.slice("/fonts/".length)));
      if (font.startsWith(join(WEB_DIST, "fonts") + sep) && existsSync(font)) {
        return serveFile(font, "public, max-age=86400");
      }
      return sendJson(res, 404, { error: "not found" });
    }
    for (const rel of ["/vite.svg", "/favicon.ico"]) {
      if (pathname === rel && existsSync(join(WEB_DIST, rel.slice(1)))) {
        return serveFile(join(WEB_DIST, rel.slice(1)), "public, max-age=3600");
      }
    }
    // SPA fallback: every app route serves index.html (route identity is
    // client-side; deep links like /w/x/s/sess_y must survive refresh)
    return serveFile(join(WEB_DIST, "index.html"));
  }

  // legacy vanilla UI (rollback surface)
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep) && file !== join(PUBLIC_DIR, "index.html")) {
    return sendJson(res, 404, { error: "not found" });
  }
  if (!existsSync(file) || extname(file) === "") {
    return sendJson(res, 404, { error: "not found" });
  }
  serveFile(file);
}

// Parse a git remote URL into a GitHub identity: https or scp-style,
// github.com or an enterprise host. Returns null when it is not one.
function parseGitRemote(url) {
  try {
    let host = null;
    let path = url;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      host = u.host;
      path = u.pathname;
    } else if (/^[^@]+@[^:]+:.+/.test(url)) {
      const at = url.indexOf("@");
      const colon = url.indexOf(":", at);
      host = url.slice(at + 1, colon);
      path = url.slice(colon + 1);
    } else {
      return null;
    }
    const segs = path.replace(/^\/+/, "").replace(/\.git\/?$/, "").split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const [owner, repo] = segs.slice(-2);
    if (!validOwner(owner) || !validRepo(repo)) return null;
    return { host, owner, repo };
  } catch {
    return null;
  }
}

function providerConfigured() {  try {
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
        const modelConfig = models[modelId];
        const displayName = typeof modelConfig === "object" && modelConfig?.name
          ? String(modelConfig.name)
          : modelId;
        out.push({
          ref,
          provider: id,
          providerName: p.name || id,
          model: modelId,
          displayName,
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


// Skills come from the CLI's own registry (user dirs + plugins). First
// occurrence wins on duplicate names — the CLI lists user scopes before
// plugin caches, so the user's own skill shadows same-named plugin ones.
const skillsCache = { at: 0, value: null };
function listSkills() {
  return new Promise((resolve) => {
    const cli = cliStatus();
    if (!cli.present) return resolve([]);
    const proc = spawn(config.cliNode, [cli.entry, "skills", "list", "--json"], {
      timeout: 10_000,
    });
    let out = "";
    proc.stdout.on("data", (c) => { out += c; });
    proc.on("error", () => resolve(skillsCache.value || []));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(skillsCache.value || []);
      try {
        const parsed = JSON.parse(out);
        const seen = new Set();
        const skills = [];
        for (const s of parsed.skills || []) {
          if (seen.has(s.name)) continue;
          seen.add(s.name);
          skills.push({
            name: String(s.name || ""),
            description: String(s.description || "").slice(0, 500),
            scope: String(s.scope || ""),
          });
        }
        resolve(skills);
      } catch {
        resolve(skillsCache.value || []);
      }
    });
  });
}

// Custom slash commands come from the CLI's own registry — .zcode/commands
// discovered for a workspace (--cwd is the run cwd, so commands are per
// project). The CLI expands them itself when a run prompt starts with "/",
// so the web only needs names + descriptions for the palette.
const commandsCache = new Map(); // cwd → { at, value }
function listCommands(cwd) {
  return new Promise((resolve) => {
    const cached = commandsCache.get(cwd);
    const cli = cliStatus();
    if (!cli.present || !cwd) return resolve([]);
    if (cached && Date.now() - cached.at < 60_000) return resolve(cached.value);
    const proc = spawn(config.cliNode, [cli.entry, "commands", "list", "--json"], {
      timeout: 10_000,
      cwd,
    });
    let out = "";
    proc.stdout.on("data", (c) => { out += c; });
    proc.on("error", () => resolve(cached?.value || []));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(cached?.value || []);
      try {
        const parsed = JSON.parse(out);
        const seen = new Set();
        const commands = [];
        for (const c of parsed.commands || []) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          commands.push({
            name: String(c.name || ""),
            description: String(c.description || "").slice(0, 500),
            scope: String(c.scope || ""),
          });
        }
        commandsCache.set(cwd, { at: Date.now(), value: commands });
        resolve(commands);
      } catch {
        resolve(cached?.value || []);
      }
    });
  });
}

// ---- ZWUI-035 snapshot builder (threat-model compliant) ----
const PREVIEW_BUDGET_BYTES = 8 * 1024 * 1024;
const PREVIEW_MAX_FILES = 400;
const PREVIEW_ALLOWED_EXT = new Set([".html", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".txt", ".md", ".json"]);

function previewEnabled() {
  return process.env.ZCODE_ENABLE_PREVIEW === "1" && Boolean((process.env.ZCODE_PREVIEW_ORIGIN || "").trim());
}

// ZWUI-072d: remove ACTIVE content from snapshot HTML. Regexes are defense
// in depth only — the separate preview origin (and this `sandbox` CSP) are
// the actual boundary; this pass just avoids handing active markup to it.
function stripActiveHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*>/gi, "") // unclosed script tag (malformed HTML)
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "") // unquoted inline handler
    .replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "") // nested documents bypass nothing, but carry no value in a preview
    .replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2")
    .replace(/(href|src|action)\s*=\s*javascript:[^\s>]+/gi, '$1="#"');
}

function buildSnapshot(cwd) {
  const warnings = [];
  const files = [];
  let totalBytes = 0;
  const walk = (dir) => {
    if (files.length >= PREVIEW_MAX_FILES) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= PREVIEW_MAX_FILES) return;
      const full = join(dir, ent.name);
      if (ent.isSymbolicLink()) { warnings.push(`skipped symlink: ${full}`); continue; }
      if (ent.isDirectory()) {
        if (!ent.name.startsWith(".")) walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = extname(ent.name).toLowerCase();
      if (!PREVIEW_ALLOWED_EXT.has(ext)) continue;
      const stat = statSync(full);
      if (totalBytes + stat.size > PREVIEW_BUDGET_BYTES) {
        warnings.push("budget exceeded — snapshot truncated");
        return;
      }
      files.push({ full, rel: full.slice(cwd.length + 1), size: stat.size });
      totalBytes += stat.size;
    }
  };
  walk(cwd);
  const htmlFiles = files.filter((f) => f.rel.endsWith(".html"));
  const index = htmlFiles.find((f) => f.rel === "index.html") || htmlFiles[0];
  if (!index) {
    throw Object.assign(new Error("no HTML entry file found for snapshot"), { status: 422 });
  }
  // ZWUI-072d: the snapshot id is a hash of the CONTENT (path + exact bytes
  // of every file). The old cwd:totalBytes:fileCount id served STALE
  // snapshots after same-size edits and differed for identical content.
  const hash = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    hash.update(f.rel);
    hash.update("\0");
    hash.update(readFileSync(f.full));
    hash.update("\0");
  }
  const id = hash.digest("hex").slice(0, 16);
  const dir = join(uploadsDir(), "..", "previews", id);
  if (existsSync(join(dir, ".meta.json"))) {
    // identical content already snapshotted — snapshots are immutable
    return { id, fileCount: files.length, totalBytes, warnings, reused: true };
  }
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    let buf = readFileSync(f.full);
    if (f.rel.endsWith(".html")) {
      buf = Buffer.from(stripActiveHtml(buf.toString("utf8")), "utf8");
    }
    const dest = join(dir, f.rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, buf);
  }
  writeFileSync(join(dir, ".meta.json"), JSON.stringify({ cwd, builtAt: Date.now(), files: files.length, bytes: totalBytes }));
  return { id, fileCount: files.length, totalBytes, warnings };
}


// ---------- API ----------

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === "/api/health") {
    const cli = cliStatus();
    const runtime = cliRuntimeStatus();
    return sendJson(res, 200, {
      ok: true,
      // boot identity (test harnesses verify readiness against THIS build,
      // not whichever stale listener happens to hold the port)
      instance: process.env.ZCODE_INSTANCE_ID ?? null,
      cli: { entry: cli.entry, present: cli.present },
      cliRuntime: { ...runtime, warning: runtime.present ? null : "ZCODE_CLI_NODE not found — job spawns will fail" },
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
      allowedRoots: ALLOWED_ROOTS,
      modes: config.allowedModes,
      defaultMode: "plan",
      cliPresent: cliStatus().present,
      providerConfigured: providerConfigured(),
      // composer preflight limits — the client rejects over-limit attachments
      // at pick time instead of after a full base64 round trip
      maxUploadBytes: config.maxUploadBytes,
      maxAttachments: MAX_ATTACHMENTS,
    });
  }

  if (route === "/api/projects" && req.method === "GET") {
    const roots = ALLOWED_ROOTS.map((root) => {
      let projects = [];
      try {
        projects = readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name)
          .sort();
      } catch {
        // root may not exist yet
      }
      return { path: root, projects };
    });
    return sendJson(res, 200, { roots });
  }

  if (route === "/api/projects" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const name = String(body.name || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      return sendJson(res, 400, { error: "invalid project name" });
    }
    const rootIdx = Number.isInteger(body.rootIndex) ? body.rootIndex : 0;
    const root = ALLOWED_ROOTS[rootIdx] || WORKSPACE_ROOT;
    const dir = join(root, name);
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
    try {
      // ZWUI-082: per-row live flag from the shared store — the sidebar's
      // working loader must reflect ANY writer (desktop/CLI/web)
      const sessions = store.list(dir).map((s) => ({ ...s, active: sessionRunState(s.id, store.runInfo(s.id)).active }));
      return sendJson(res, 200, { cwd: dir, sessions });
    } catch (e) {
      // ZWUI-018: real DB failures are 5xx with the reason — never an empty list
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  const sessionMatch = route.match(/^\/api\/sessions\/(sess_[A-Za-z0-9_-]+)$/);
  if (sessionMatch && req.method === "GET") {
    let session;
    let page;
    let runInfo = { active: false, startedAt: null };
    let workedMs = 0;
    let todos = [];
    try {
      // DB_MISSING must not preempt the job-backed branches below: a web-only
      // session whose CLI never wrote the store still deserves its run's
      // detail answer instead of a 503
      try {
        session = store.get(sessionMatch[1]);
      } catch (e) {
        if (e.code !== "DB_MISSING") throw e;
        session = undefined;
      }
      // A fresh CLI turn can announce its session before the CLI has committed
      // the session row. Keep a reload in that short window on the live job
      // instead of returning 404 and losing the run's stream identity.
      const liveJob = jobs.activeJobForSession(sessionMatch[1]);
      const lastJob = jobs.lastJobForSession(sessionMatch[1]);
      if (!session && liveJob) {
        session = {
          id: sessionMatch[1],
          title: String(liveJob.text || "New chat").slice(0, 200),
          directory: liveJob.cwd,
          createdAt: liveJob.createdAt,
          updatedAt: liveJob.createdAt,
          goal: null,
        };
        page = { turns: [], total: 0, hasMore: false, tokensTotal: null, contextTokens: null };
        runInfo = { active: true, startedAt: liveJob.startedAt || liveJob.createdAt };
      } else if (!session && lastJob && TERMINAL_STATUS.has(lastJob.status)) {
        // A web-only session whose run just ended: the store never saw a row
        // (the CLI owns store writes). Answer with the run's own record so
        // the browser can settle to idle — a 404 here would leave the
        // pre-cancel runActive=true stuck on the client.
        session = {
          id: sessionMatch[1],
          title: String(lastJob.text || "New chat").slice(0, 200),
          directory: lastJob.cwd,
          createdAt: lastJob.createdAt,
          updatedAt: lastJob.finishedAt ?? lastJob.createdAt,
          goal: null,
        };
        page = { turns: [], total: 0, hasMore: false, tokensTotal: null, contextTokens: null };
        runInfo = { active: false, startedAt: null };
      } else {
        if (!session) return sendJson(res, 404, { error: "session not found" });
        // ZWUI-060: containment verdict on the REAL path (symlink-aware)
        if (!insideAllowedRoots(realpathOf(session.directory))) {
          return sendJson(res, 403, { error: "session outside allowed roots" });
        }
        session.goal = store.goal(session.id);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 400);
        const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
        page = store.transcript(session.id, { limit, offset });
        runInfo = sessionRunState(session.id, store.runInfo(session.id));
        workedMs = store.workedMs(session.id);
        todos = store.todos(session.id);
      }
    } catch (e) {
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
    return sendJson(res, 200, {
      session,
      transcript: page.turns,
      total: page.total,
      hasMore: page.hasMore,
      // session-wide token sum, independent of transcript pagination
      tokensTotal: page.tokensTotal ?? null,
      // latest step usage ≈ the current context window the next call re-feeds
      contextTokens: page.contextTokens ?? null,
      // a turn is running from ANY writer (desktop/CLI/web) — the UI shows
      // progress and blocks sending while this is true
      runActive: runInfo.active,
      runStartedAt: runInfo.startedAt,
      // ZWUI-075: if the running turn was spawned by THIS server instance,
      // report its job id so a reloaded browser can adopt the live stream
      // instead of degrading to store polling.
      activeJobId: jobs.activeJobForSession(session.id)?.id ?? null,
      // completed-turn working time (the desktop's "Worked for …" figure);
      // the live turn's elapsed time is added client-side
      workedMs,
      // the agent's todo checklist for this session — the desktop's Progress
      // list (empty for sessions that never created todos)
      todos,
    });
  }

  if (route === "/api/models" && req.method === "GET") {
    return sendJson(res, 200, { models: listModels() });
  }

  // Real ZCode skills, listed by the CLI itself (`skills list --json`).
  // Deduped by name (the CLI lists the same skill once per scope); spawn
  // runs on the approved CLI runtime with a hard timeout, results cached
  // for 60s — skills rarely change and the spawn is not cheap.
  if (route === "/api/skills" && req.method === "GET") {
    const now = Date.now();
    if (!skillsCache.value || now - skillsCache.at > 60_000) {
      skillsCache.value = await listSkills();
      skillsCache.at = now;
    }
    return sendJson(res, 200, { skills: skillsCache.value });
  }

  // Custom slash commands for a workspace (the composer's "/" palette).
  // cwd optional — without it the server's own workspace is listed.
  if (route === "/api/commands" && req.method === "GET") {
    const rawCwd = url.searchParams.get("cwd") || "";
    let cwd = "";
    if (rawCwd) {
      cwd = resolve(decodeURIComponent(rawCwd));
      const inside = ALLOWED_ROOTS.some((root) => cwd === root || cwd.startsWith(root + sep));
      if (!inside) return sendJson(res, 403, { error: "cwd outside allowed roots" });
    }
    const commands = await listCommands(cwd || undefined);
    return sendJson(res, 200, { commands });
  }

  // Upload a file (base64 JSON body) for use as a prompt attachment. Files
  // land in <ZCODE_HOME>/uploads and are passed to the CLI via --attach.
  if (route === "/api/upload" && req.method === "POST") {
    // base64 expands payloads by ~33%, plus a small JSON envelope
    const body = JSON.parse(await readBody(req, Math.ceil(config.maxUploadBytes * 1.34) + 64 * 1024));
    const rawName = String(body.name || "file");
    const safeName = rawName.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "_").slice(0, 120);
    const b64 = String(body.data || "").replace(/^data:[^;]*;base64,/, "");
    // strict validation: Buffer.from("base64") silently ignores invalid
    // characters and would persist corrupted files
    if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      return sendJson(res, 400, { error: "invalid base64 payload" });
    }
    const data = Buffer.from(b64, "base64");
    if (!data.length) return sendJson(res, 400, { error: "empty file" });
    if (data.length < Math.floor((b64.length * 3) / 4) - 2) {
      return sendJson(res, 400, { error: "corrupt base64 payload" });
    }
    if (data.length > config.maxUploadBytes) return sendJson(res, 413, { error: "file too large" });
    const dir = uploadsDir();
    mkdirSync(dir, { recursive: true });
    // collision-resistant name: same-millisecond uploads must not overwrite
    // each other (ZWUI-072)
    const fname = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
    const fpath = join(dir, fname);
    writeFileSync(fpath, data);
    return sendJson(res, 201, { path: fpath, name: fname, size: data.length });
  }

  // Serve an uploaded file (images render inline in the chat).
  const uploadMatch = route.match(/^\/api\/uploads\/([A-Za-z0-9._-]+)$/);
  if (uploadMatch && (req.method === "GET" || req.method === "HEAD")) {
    const dir = uploadsDir();
    const file = normalize(join(dir, uploadMatch[1]));
    // ZWUI-060: realpath check — a symlink inside the uploads dir must not
    // serve anything outside it
    if (!file.startsWith(dir + sep) || !existsSync(file) || !insideRoot(realpathOf(file), realpathOf(dir))) {
      return sendJson(res, 404, { error: "not found" });
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    });
    if (req.method === "HEAD") return res.end();
    return res.end(readFileSync(file));
  }

  // Serve a desktop artifact (tool outputs saved by the CLI: screenshots,
  // PDFs, text) so transcripts can render their attached media. Addressed by
  // session id + the artifact suffix from the zcode-artifact:// URL; the file
  // is resolved inside the session's artifact dir only. Content type is
  // sniffed from magic bytes — artifact filenames are .txt regardless of
  // their true payload.
  const artifactMatch = route.match(/^\/api\/artifacts\/(sess_[A-Za-z0-9_-]+)\/([A-Za-z0-9-]+)$/);
  if (artifactMatch && (req.method === "GET" || req.method === "HEAD")) {
    const [, artifactSess, artifactUuid] = artifactMatch;
    if (artifactSess.length > 80 || artifactUuid.length > 80) return sendJson(res, 404, { error: "not found" });
    try {
      const sess = store.get(artifactSess);
      if (sess) {
        // ZWUI-060: symlink-aware containment; a missing session row keeps
        // the artifact path checks below as the only gate (desktop parity:
        // artifacts are addressed by session id, not the sessions table)
        if (!insideAllowedRoots(realpathOf(sess.directory))) {
          return sendJson(res, 403, { error: "session outside allowed roots" });
        }
      }
    } catch {}
    const artifactsBase = join(config.zcodeHome, "cli", "artifacts");
    const dir = normalize(join(artifactsBase, artifactSess));
    if (!dir.startsWith(artifactsBase + sep) || !insideRoot(realpathOf(dir), realpathOf(artifactsBase))) {
      return sendJson(res, 404, { error: "not found" });
    }
    let file = null;
    if (existsSync(dir)) {
      const needle = `tool-result-${artifactUuid}`;
      const hit = readdirSync(dir).find((f) => f.includes(needle));
      if (hit) file = normalize(join(dir, hit));
    }
    if (!file || !file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return sendJson(res, 404, { error: "not found" });
    }
    const buf = readFileSync(file);
    let contentType = "application/octet-stream";
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) contentType = "image/png";
    else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) contentType = "image/jpeg";
    else if (buf.subarray(0, 3).toString("latin1") === "GIF") contentType = "image/gif";
    else if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") contentType = "image/webp";
    else if (buf.subarray(0, 5).toString("latin1") === "%PDF-") contentType = "application/pdf";
    else if (!buf.subarray(0, 8192).includes(0)) contentType = "text/plain; charset=utf-8";
    res.writeHead(200, { "content-type": contentType, "cache-control": "private, max-age=3600" });
    if (req.method === "HEAD") return res.end();
    return res.end(buf);
  }

  // Session rename — writes only the session row's title (same fields the
  // CLI's own rename sets: title + title_source='user').
  const renameMatch = route.match(/^\/api\/sessions\/(sess_[A-Za-z0-9_-]+)\/rename$/);
  if (renameMatch && req.method === "POST") {
    const body = JSON.parse(await readBody(req, 8192));
    const title = String(body.title || "").trim();
    if (!title) return sendJson(res, 400, { error: "title is required" });
    if (!cliStatus().dbPresent) return sendJson(res, 503, { error: "session database not found", code: "DB_MISSING" });
    try {
      const sess = store.get(renameMatch[1]);
      if (sess) {
        // ZWUI-060: symlink-aware containment before the write
        if (!insideAllowedRoots(realpathOf(sess.directory))) {
          return sendJson(res, 403, { error: "session outside allowed roots" });
        }
      }
      const ok = renameSession(cliStatus().dbPath, renameMatch[1], title);
      if (!ok) return sendJson(res, 404, { error: "session not found" });
      return sendJson(res, 200, { ok: true, title: title.slice(0, 200) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (route === "/api/chat" && req.method === "POST") {
    const body = JSON.parse(await readBody(req, 1024 * 1024));
    let text = String(body.text || "").trim();
    const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
    if (!text && hasAttachments) text = "Analyze the attached file(s).";
    if (!text) return sendJson(res, 400, { error: "text is required" });
    let cwd;
    try {
      cwd = safeCwd(body.cwd);
      mkdirSync(cwd, { recursive: true });
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message });
    }
    const sessionId = body.sessionId && /^sess_[A-Za-z0-9_-]+$/.test(body.sessionId) ? body.sessionId : null;
    if (sessionId) {
      let session = null;
      try {
        session = store.get(sessionId);
      } catch (e) {
        if (e.code === "DB_MISSING") {
          // session DB not present; proceed if allowed by environment
        }
      }
      if (session) {
        // ZWUI-060: compare REAL paths — a symlinked spelling of the same
        // directory still matches its session, a symlink to elsewhere doesn't
        if (!insideAllowedRoots(realpathOf(session.directory))) {
          return sendJson(res, 403, { error: "session directory outside allowed roots", code: "SESSION_ROOT_FORBIDDEN" });
        }
        if (realpathOf(session.directory) !== realpathOf(cwd)) {
          return sendJson(res, 409, {
            error: "session directory mismatch",
            code: "SESSION_CONTEXT_MISMATCH",
            canonicalDirectory: session.directory,
          });
        }
      }
    }

    const mode = config.allowedModes.includes(body.mode) ? body.mode : "plan";
    const modelEntry = listModels({ withKeys: true }).find((m) => m.ref === body.model) || null;
    const attachments = [];
    // attachments must be files previously uploaded to the uploads dir
    const upDir = uploadsDir();
    const requested = (Array.isArray(body.attachments) ? body.attachments : [])
      .map((p) => resolve(String(p)));
    // ZWUI-072: an explicit error, never a silent drop — a caller that sent
    // six files must know the fifth onward were not analyzed
    if (requested.length > MAX_ATTACHMENTS) {
      return sendJson(res, 400, { error: `too many attachments (max ${MAX_ATTACHMENTS})`, rejected: requested.slice(MAX_ATTACHMENTS) });
    }
    const bad = requested.filter((p) => !p.startsWith(upDir + sep) || !existsSync(p));
    if (bad.length) {
      return sendJson(res, 400, { error: "attachments must be uploaded via /api/upload first", rejected: bad });
    }
    attachments.push(...requested);

    // ZWUI-007: idempotent submission — same X-Request-Id returns the same job
    const requestId =
      (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].slice(0, 100)) ||
      (typeof body.requestId === "string" && body.requestId.slice(0, 100)) ||
      null;
    try {
      const existing = jobs.findByIdempotencyKey(requestId, {
        text,
        sessionId,
        cwd,
        mode,
        model: modelEntry?.ref || null,
        attachments,
      });
      if (existing) {
        return sendJson(res, 200, {
          jobId: existing.id, sessionId: existing.sessionId, cwd: existing.cwd,
          mode: existing.mode, model: existing.modelRef || null, replayed: true,
        });
      }
    } catch (e) {
      return sendJson(res, e.status || 409, { error: e.message, code: e.code });
    }

    try {
      const { job, replayed } = jobs.start({
        text,
        sessionId,
        cwd,
        mode,
        model: modelEntry?.ref || null,
        modelApiKey: modelEntry?.apiKey || null,
        modelBaseUrl: modelEntry?.baseURL || null,
        attachments,
        requestId,
      });
      job.modelRef = modelEntry?.ref || null;
      return sendJson(res, replayed ? 200 : 202, {
        jobId: job.id, sessionId: job.sessionId, cwd, mode, model: modelEntry?.ref || null, replayed,
      });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message, code: e.code });
    }
  }

  // ZWUI-007: immutable job status snapshot
  const statusMatch = route.match(/^\/api\/jobs\/([0-9a-f-]+)$/);
  if (statusMatch && req.method === "GET") {
    const job = jobs.get(statusMatch[1]);
    if (!job) return sendJson(res, 404, { error: "job not found" });
    return sendJson(res, 200, {
      jobId: job.id,
      status: job.status,
      sessionId: job.sessionId,
      cwd: job.cwd,
      mode: job.mode,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      error: job.error,
      timedOut: job.timedOut,
    });
  }

  // Recent sessions under a root (directory LIKE root%), bounded — powers the
  // sidebar "Sessions" view. Same scoping rules as search (ZWUI-029).
  if (route === "/api/sessions/recent" && req.method === "GET") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
    const rootParam = url.searchParams.get("root");
    try {
      if (!rootParam) {
        // no root → latest across every allowed root (search dialog's
        // "latest 50 sessions" empty state)
        // ZWUI-082: active flag per row — any writer (desktop/CLI/web)
        const sessions = store.recent(ALLOWED_ROOTS, limit).map((s) => ({ ...s, active: sessionRunState(s.id, store.runInfo(s.id)).active }));
        return sendJson(res, 200, { sessions });
      }
      const abs = resolve(rootParam);
      if (!ALLOWED_ROOTS.some((r) => abs === r || abs.startsWith(r + sep))) {
        return sendJson(res, 403, { error: "root outside allowed roots" });
      }
      const sessions = store.recentUnder(abs, limit).map((s) => ({ ...s, active: sessionRunState(s.id, store.runInfo(s.id)).active }));
      return sendJson(res, 200, { sessions });
    } catch (e) {
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  // ---- ZWUI-029: bounded authorized session search ----
  // LIKE-based title search across the sessions table, bounded (LIMIT 20),
  // scoped to the allowed roots by directory prefix matching. Longer queries
  // additionally search message CONTENT through the sidecar FTS index, which
  // is built incrementally (bounded chunk per call) — results merge.
  // Workspace analytics from the CLI's own records (read-only aggregates).
  // ZWUI-043 contract: 202 while the first build for this root set runs on
  // the analytics worker; 503 when a build failed and no snapshot exists;
  // 200 otherwise with `stale` + `generatedAt` (as-of) honesty flags.
  if (route === "/api/analytics" && req.method === "GET") {
    try {
      const days = Math.max(1, Math.min(Number(url.searchParams.get("days")) || 14, 60));
      const snap = store.requestAnalytics(ALLOWED_ROOTS, days);
      if (!snap.data) {
        if (snap.error) return sendJson(res, 503, { error: snap.error });
        return sendJson(res, 202, { pending: true });
      }
      return sendJson(res, 200, { ...snap.data, generatedAt: snap.generatedAt, stale: snap.stale });
    } catch (e) {
      return sendJson(res, e.code === "DB_MISSING" ? 503 : 500, { error: e.message });
    }
  }
  // ---- ZWUI-051: read-only GitHub issue reading (backend-owned credentials;
  // requests go only to the configured API base — never an arbitrary proxy) ----
  if (route === "/api/github/capability" && req.method === "GET") {
    return sendJson(res, 200, githubCapability());
  }

  const ghIssueMatch = route.match(/^\/api\/github\/issues\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (ghIssueMatch && req.method === "GET") {
    if (!githubCapability().enabled) {
      return sendJson(res, 403, { error: "GitHub reading is disabled on this deployment", code: "GITHUB_DISABLED" });
    }
    const owner = decodeURIComponent(ghIssueMatch[1]);
    const repo = decodeURIComponent(ghIssueMatch[2]);
    try {
      const out = await fetchIssue(owner, repo, ghIssueMatch[3], { refresh: url.searchParams.get("refresh") === "1" });
      return sendJson(res, 200, out);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message, code: e.code, retryAfter: e.retryAfter ?? null });
    }
  }

  const ghCommentsMatch = route.match(/^\/api\/github\/issues\/([^/]+)\/([^/]+)\/(\d+)\/comments$/);
  if (ghCommentsMatch && req.method === "GET") {
    if (!githubCapability().enabled) {
      return sendJson(res, 403, { error: "GitHub reading is disabled on this deployment", code: "GITHUB_DISABLED" });
    }
    try {
      const out = await fetchComments(
        decodeURIComponent(ghCommentsMatch[1]),
        decodeURIComponent(ghCommentsMatch[2]),
        ghCommentsMatch[3],
        { page: Number(url.searchParams.get("page")) || 1 }
      );
      return sendJson(res, 200, out);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message, code: e.code });
    }
  }

  if (route === "/api/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return sendJson(res, 200, { results: [] });
    try {
      const results = store.searchSessions(q, ALLOWED_ROOTS, 20);
      const seen = new Set(results.map((r) => r.id));
      if (q.length >= 3) {
        // ZWUI-059: an index failure must not take the whole search route
        // down — title hits still return, the failure is reported honestly
        let progress = { indexedThrough: 0, total: 0 };
        let contentHits = [];
        let indexError = null;
        try {
          progress = contentIndex.indexChunk(ALLOWED_ROOTS);
          contentHits = contentIndex.search(q, ALLOWED_ROOTS, 20).filter((r) => !seen.has(r.id));
        } catch (e) {
          indexError = e.message;
        }
        return sendJson(res, 200, {
          results: [...results, ...contentHits].slice(0, 20),
          index: { through: progress.indexedThrough, total: progress.total, error: indexError },
        });
      }
      return sendJson(res, 200, { results });
    } catch (e) {
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  // ---- ZWUI-030: capability-gated read-only project file API ----
  // Explicitly opt-in: ZCODE_ENABLE_FILES=1. Serves text files under the
  // allowed roots only; binary/image types are rejected (no byte exposure);
  // size-capped; traversal-proof.
  if (route === "/api/files/capability" && req.method === "GET") {
    return sendJson(res, 200, {
      enabled: process.env.ZCODE_ENABLE_FILES === "1",
      maxBytes: Math.min(config.maxUploadBytes, 512 * 1024),
    });
  }

  // Read-only directory listing for the Code inspector. EXACT route — it
  // must be matched before the /api/files/:path catch-all below, or a
  // listing request reads a file literally named "list".
  if (route === "/api/files/list" && req.method === "GET") {
    if (process.env.ZCODE_ENABLE_FILES !== "1") {
      return sendJson(res, 403, { error: "file API disabled (set ZCODE_ENABLE_FILES=1)" });
    }
    let dir;
    try { dir = safeCwd(url.searchParams.get("dir")); }
    catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return sendJson(res, 404, { error: "not found" });
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return sendJson(res, 200, { dir, entries });
  }

  const filesMatch = route.match(/^\/api\/files\/(.+)$/);
  if (filesMatch && req.method === "GET") {
    if (process.env.ZCODE_ENABLE_FILES !== "1") {
      return sendJson(res, 403, { error: "file API disabled (set ZCODE_ENABLE_FILES=1)" });
    }
    const rel = decodeURIComponent(filesMatch[1]);
    const abs = resolve(String(rel));
    const pasteRoot = resolve(join(config.zcodeHome, "tmp", "paste-attachments"));
    // transcript attachments pasted into the CLI/desktop live under the
    // shared zcode home — previewable like workspace files, without adding
    // the CLI's internals to the browsable allowed roots.
    // ZWUI-060: the verdict is on the REAL path — a symlink inside a root
    // that points outside is rejected.
    const realAbs = realpathOf(abs);
    const inside = insideAllowedRoots(realAbs)
      || insideRoot(realAbs, realpathOf(pasteRoot));
    if (!inside) return sendJson(res, 403, { error: "path outside allowed roots" });
    if (!existsSync(abs) || !statSync(abs).isFile()) return sendJson(res, 404, { error: "not found" });
    const stat = statSync(abs);
    const maxBytes = Math.min(config.maxUploadBytes, 512 * 1024);
    if (stat.size > maxBytes) {
      return sendJson(res, 413, { error: `file exceeds ${maxBytes} bytes` });
    }
    const buf = readFileSync(abs);
    // text sniff: reject NUL bytes in the first 8KB
    if (buf.subarray(0, 8192).includes(0)) {
      return sendJson(res, 415, { error: "binary files are not served" });
    }
    return sendJson(res, 200, {
      path: abs,
      size: stat.size,
      encoding: "utf-8",
      content: buf.toString("utf8"),
    });
  }

  // ---- ZWUI-035: isolated static snapshot preview service ----
  // Contract: docs/baseline/preview-threat-model.md. Double opt-in
  // (ZCODE_ENABLE_PREVIEW=1 + ZCODE_PREVIEW_ORIGIN), script-stripped static
  // snapshots under a content-hash id, budget-bounded, traversal-proof.

  if (route === "/api/preview/capability" && req.method === "GET") {
    return sendJson(res, 200, {
      enabled: previewEnabled(),
      budgetBytes: PREVIEW_BUDGET_BYTES,
      maxFiles: PREVIEW_MAX_FILES,
      origin: previewEnabled() ? process.env.ZCODE_PREVIEW_ORIGIN || null : null,
    });
  }

  if (route === "/api/preview/build" && req.method === "POST") {
    if (!previewEnabled()) {
      return sendJson(res, 403, { error: "preview disabled (set ZCODE_ENABLE_PREVIEW=1 and ZCODE_PREVIEW_ORIGIN)" });
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req, 64 * 1024));
        const cwd = safeCwd(body.cwd);
        const snapshot = buildSnapshot(cwd);
        return sendJson(res, 202, {
          snapshotId: snapshot.id,
          files: snapshot.fileCount,
          bytes: snapshot.totalBytes,
          warnings: snapshot.warnings,
        });
      } catch (e) {
        return sendJson(res, e.status || 400, { error: e.message });
      }
    })();
    return;
  }

  const previewAsset = route.match(/^\/api\/preview\/([0-9a-f]{16})\/(.+)$/);
  if (previewAsset && req.method === "GET") {
    if (!previewEnabled()) return sendJson(res, 403, { error: "preview disabled" });
    const dir = normalize(join(uploadsDir(), "..", "previews", previewAsset[1]));
    const rel = decodeURIComponent(previewAsset[2]);
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return sendJson(res, 404, { error: "not found" });
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "content-security-policy": "sandbox", // never run scripts even if one slipped in
      "cache-control": "private, max-age=600",
    });
    return res.end(readFileSync(file));
  }

  // Opt-in via ZCODE_ENABLE_GIT=1; executes `git status --porcelain` /
  // `git diff` in an allowed-root cwd. No staging, no checkout, no writes.
  if (route === "/api/git/status" && req.method === "GET") {
    if (process.env.ZCODE_ENABLE_GIT !== "1") {
      return sendJson(res, 403, { error: "git API disabled (set ZCODE_ENABLE_GIT=1)" });
    }
    let cwd;
    try { cwd = safeCwd(url.searchParams.get("cwd")); }
    catch (e) { return sendJson(res, 400, { error: e.message }); }
    execFile("git", ["status", "--porcelain"], { cwd, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return sendJson(res, 422, { error: stderr || err.message });
      const entries = stdout.split("\n").filter(Boolean).map((line) => ({
        // ZWUI-067: keep BOTH XY columns (staged/unstaged) — the UI decodes
        // them into words; trimming collapsed "M " and " M" into one meaning
        status: line.slice(0, 2),
        path: line.slice(3),
      }));
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }, (e2, branch) => {
        // the origin remote binds bare #N references to a repository
        // (issue resolution rule: never guess a repo for a bare number)
        execFile("git", ["remote", "get-url", "origin"], { cwd }, (e3, rurl) => {
          return sendJson(res, 200, {
            cwd, entries, branch: e2 ? null : String(branch).trim(),
            remote: e3 ? null : parseGitRemote(String(rurl).trim()),
          });
        });
      });
    });
    return;
  }
  if (route === "/api/git/diff" && req.method === "GET") {
    if (process.env.ZCODE_ENABLE_GIT !== "1") {
      return sendJson(res, 403, { error: "git API disabled (set ZCODE_ENABLE_GIT=1)" });
    }
    let cwd;
    try { cwd = safeCwd(url.searchParams.get("cwd")); }
    catch (e) { return sendJson(res, 400, { error: e.message }); }
    const file = url.searchParams.get("path");
    const args = ["diff", "--no-color"];
    if (file) args.push("--", resolve(cwd, "." + sep + file.replace(/^\/+/, "")));
    execFile("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return sendJson(res, 422, { error: stderr || err.message });
      return sendJson(res, 200, { cwd, path: file || null, diff: stdout });
    });
    return;
  }

  const cancelMatch = route.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const canceled = jobs.cancel(cancelMatch[1]);
    return sendJson(res, canceled ? 200 : 404, canceled ? { canceled: true } : { error: "job not found or already finished" });
  }

  // SSE ticket: the browser exchanges its bearer token for a short-lived,
  // job-scoped ticket so EventSource never carries the token in a URL.
  if (route === "/api/sse-ticket" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const jobId = String(body.jobId || "");
    if (!/^[0-9a-f-]{16,64}$/.test(jobId) || !jobs.get(jobId)) {
      return sendJson(res, 404, { error: "job not found" });
    }
    return sendJson(res, 200, { ticket: issueSseTicket(jobId) });
  }

  // SSE: stream job events. Auth: bearer header or ?ticket= from /api/sse-ticket
  // (EventSource cannot set headers; the ticket avoids URL token leakage and
  // ZWUI-061 makes it single-use — reconnects fetch a fresh one).
  // ZWUI-008 v2: numbered events, Last-Event-ID replay, explicit ticket-expiry
  // and terminal `done` re-delivery.
  const eventsMatch = route.match(/^\/api\/events\/([0-9a-f-]+)$/);
  if (eventsMatch && req.method === "GET") {
    const jobId = eventsMatch[1];
    const ticket = url.searchParams.get("ticket");
    const bearerOk = isAuthorized(req);
    // consume on first use — a replayed/expired/foreign ticket is invalid
    const ticketOk = !bearerOk && consumeSseTicket(ticket, jobId);
    if (!bearerOk && !ticketOk) {
      if (ticket) {
        // distinguishable from missing auth so clients can rotate: a stale,
        // used, or wrong-job ticket gets a ticket-expired event, then the
        // stream ends (the client fetches a fresh ticket and reconnects)
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ kind: "ticket-expired", jobId })}\n\n`);
        return res.end();
      }
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const job = jobs.get(jobId);
    if (!job) return sendJson(res, 404, { error: "job not found" });

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let cursor = Number(url.searchParams.get("lastEventId")) || 0;
    const lastIdHeader = req.headers["last-event-id"];
    if (lastIdHeader && Number(lastIdHeader) > cursor) cursor = Number(lastIdHeader);

    const write = (event) => {
      if (event.id) res.write(`id: ${event.id}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // replay from the client's cursor (bounded by the job's buffer)
    if (cursor > 0) {
      for (const event of jobs.replay(jobId, cursor) || []) write(event);
    } else {
      for (const event of job.lines) write(event);
    }

    const terminal = job.status && TERMINAL_STATUS.has(job.status);
    if (terminal) {
      // ensure `done` is always the last event on a completed stream — with
      // the same authoritative contract as the live terminal event
      if (!job.lines.some((e) => e.kind === "done")) {
        write({
          kind: "done", exitCode: job.exitCode, error: job.error, sessionId: job.sessionId,
          status: job.status, timedOut: job.timedOut, cancelRequested: job.cancelRequested, killSignal: job.killSignal,
        });
      }
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
  let url;
  try {
    // URL construction is INSIDE the guarded path: a malformed request
    // target or Host header throws here, and a throw escaping this callback
    // is an uncaught exception that takes the whole process down — before
    // authentication is even reached. Answer 400 instead.
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return sendJson(res, 400, { error: "malformed request" });
  }
  try {
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        return sendJson(res, 200, {
          authRequired: Boolean(TOKEN),
          serverVersion: "0.1.0",
        });
      }
      // SSE authenticates inside handleApi (bearer OR short-lived ticket)
      const isSse = /^\/api\/events\/[0-9a-f-]+$/.test(url.pathname) && req.method === "GET";
      if (!isSse && !isAuthorized(req)) return sendJson(res, 401, { error: "unauthorized" });
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
  const runtime = cliRuntimeStatus();
  console.log(`zcode-web listening on http://${HOST}:${PORT}`);
  console.log(`  cli entry : ${cli.entry} (${cli.present ? "found" : "MISSING"})`);
  console.log(`  cli runtime: ${runtime.executable} (${runtime.present ? "found" : "MISSING"}${runtime.isExplicit ? ", explicit ZCODE_CLI_NODE" : ", inherited"})`);
  console.log(`  zcode home: ${config.zcodeHome}`);
  console.log(`  sessions db: ${cli.dbPath} (${cli.dbPresent ? "found" : "not yet created"})`);
  console.log(`  workspace : ${WORKSPACE_ROOT}`);
  console.log(`  auth      : ${TOKEN ? "bearer token required" : "OPEN (set ZCODE_WEB_TOKEN!)"}`);
});
