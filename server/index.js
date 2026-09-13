// zcode-web server — zero-dependency Node 24 HTTP server.
// Serves the static UI from ./public and a small JSON + SSE API that drives
// the ZCode CLI headless (see server/zcode.js).

import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { JobManager, cliStatus, cliRuntimeStatus, config, uploadsDir } from "./zcode.js";
import { SessionStore } from "./sessions.js";

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
const TERMINAL_STATUS = new Set(["succeeded", "failed", "cancelled", "timeout"]);

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
function validSseTicket(ticket, jobId) {
  const v = sseTickets.get(String(ticket || ""));
  return Boolean(v && v.jobId === jobId && v.exp > Date.now());
}

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
        // drain so the 413 response can still be written; Node closes the
        // connection after the response ends
        req.resume();
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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
// workspace root.
function safeCwd(input) {
  if (!input || !String(input).trim()) return WORKSPACE_ROOT;
  const dir = resolve(String(input));
  for (const root of ALLOWED_ROOTS) {
    if (dir === root || dir.startsWith(root + sep)) return dir;
  }
  const rel = resolve(WORKSPACE_ROOT, "." + sep + dir.replace(/^\/+/, ""));
  if (ALLOWED_ROOTS.some((root) => rel === root || rel.startsWith(root + sep))) return rel;
  throw Object.assign(new Error("cwd must be inside an allowed root: " + ALLOWED_ROOTS.join(", ")), { status: 400 });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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

// ---- ZWUI-035 snapshot builder (threat-model compliant) ----
const PREVIEW_BUDGET_BYTES = 8 * 1024 * 1024;
const PREVIEW_MAX_FILES = 400;
const PREVIEW_ALLOWED_EXT = new Set([".html", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".txt", ".md", ".json"]);

function previewEnabled() {
  return process.env.ZCODE_ENABLE_PREVIEW === "1" && Boolean((process.env.ZCODE_PREVIEW_ORIGIN || "").trim());
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
  const id = crypto.createHash("sha256").update(cwd + ":" + totalBytes + ":" + files.length).digest("hex").slice(0, 16);
  const dir = join(uploadsDir(), "..", "previews", id);
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    let buf = readFileSync(f.full);
    if (f.rel.endsWith(".html")) {
      // strip scripts and event handlers per the threat model (defense in
      // depth — the separate origin is the primary control)
      buf = Buffer.from(
        buf.toString("utf8")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
          .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, ""),
        "utf8"
      );
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
      return sendJson(res, 200, { cwd: dir, sessions: store.list(dir) });
    } catch (e) {
      // ZWUI-018: real DB failures are 5xx with the reason — never an empty list
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  const sessionMatch = route.match(/^\/api\/sessions\/(sess_[A-Za-z0-9-]+)$/);
  if (sessionMatch && req.method === "GET") {
    let session;
    let page;
    try {
      session = store.get(sessionMatch[1]);
      if (!session) return sendJson(res, 404, { error: "session not found" });
      session.goal = store.goal(session.id);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 400);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      page = store.transcript(session.id, { limit, offset });
    } catch (e) {
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
    return sendJson(res, 200, { session, transcript: page.turns, total: page.total, hasMore: page.hasMore });
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
    const fname = `${Date.now()}-${safeName}`;
    const fpath = join(dir, fname);
    writeFileSync(fpath, data);
    return sendJson(res, 201, { path: fpath, name: fname, size: data.length });
  }

  // Serve an uploaded file (images render inline in the chat).
  const uploadMatch = route.match(/^\/api\/uploads\/([A-Za-z0-9._-]+)$/);
  if (uploadMatch && (req.method === "GET" || req.method === "HEAD")) {
    const dir = uploadsDir();
    const file = normalize(join(dir, uploadMatch[1]));
    if (!file.startsWith(dir + sep) || !existsSync(file)) {
      return sendJson(res, 404, { error: "not found" });
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    });
    if (req.method === "HEAD") return res.end();
    return res.end(readFileSync(file));
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
    const sessionId = body.sessionId && /^sess_[A-Za-z0-9-]+$/.test(body.sessionId) ? body.sessionId : null;
    const mode = config.allowedModes.includes(body.mode) ? body.mode : "plan";
    // ZWUI-007: idempotent submission — same X-Request-Id returns the same job
    const requestId =
      (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].slice(0, 100)) ||
      (typeof body.requestId === "string" && body.requestId.slice(0, 100)) ||
      null;
    const existing = jobs.findByIdempotencyKey(requestId);
    if (existing) {
      return sendJson(res, 200, {
        jobId: existing.id, sessionId: existing.sessionId, cwd: existing.cwd,
        mode: existing.mode, model: existing.modelRef || null, replayed: true,
      });
    }
    // model must be a configured provider/model pair — never a free string
    const modelEntry = listModels({ withKeys: true }).find((m) => m.ref === body.model) || null;
    // attachments must be files previously uploaded to the uploads dir
    const upDir = uploadsDir();
    const requested = (Array.isArray(body.attachments) ? body.attachments : [])
      .map((p) => resolve(String(p)));
    const bad = requested.filter((p) => !p.startsWith(upDir + sep) || !existsSync(p));
    if (bad.length) {
      return sendJson(res, 400, { error: "attachments must be uploaded via /api/upload first", rejected: bad });
    }
    const attachments = requested.slice(0, 5);
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
      return sendJson(res, e.status || 500, { error: e.message });
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
        return sendJson(res, 200, { sessions: store.recent(ALLOWED_ROOTS, limit) });
      }
      const abs = resolve(rootParam);
      if (!ALLOWED_ROOTS.some((r) => abs === r || abs.startsWith(r + sep))) {
        return sendJson(res, 403, { error: "root outside allowed roots" });
      }
      return sendJson(res, 200, { sessions: store.recentUnder(abs, limit) });
    } catch (e) {
      const status = e.code === "DB_MISSING" ? 503 : 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  // ---- ZWUI-029: bounded authorized session search ----
  // LIKE-based title search across the sessions table, bounded (LIMIT 20),
  // scoped to the allowed roots by directory prefix matching.
  if (route === "/api/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return sendJson(res, 200, { results: [] });
    try {
      const results = store.searchSessions(q, ALLOWED_ROOTS, 20);
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

  const filesMatch = route.match(/^\/api\/files\/(.+)$/);
  if (filesMatch && req.method === "GET") {
    if (process.env.ZCODE_ENABLE_FILES !== "1") {
      return sendJson(res, 403, { error: "file API disabled (set ZCODE_ENABLE_FILES=1)" });
    }
    const rel = decodeURIComponent(filesMatch[1]);
    const abs = resolve(String(rel));
    const inside = ALLOWED_ROOTS.some((root) => abs === root || abs.startsWith(root + sep));
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
  // ZWUI-030 companion: read-only directory listing for the Code inspector.
  const filesListMatch = route.match(/^\/api\/files\/list$/);
  if (filesListMatch && req.method === "GET") {
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
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }, (e2, branch) => {
        return sendJson(res, 200, { cwd, entries, branch: e2 ? null : String(branch).trim() });
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
  // (EventSource cannot set headers; the ticket avoids URL token leakage).
  // ZWUI-008 v2: numbered events, Last-Event-ID replay, explicit ticket-expiry
  // and terminal `done` re-delivery.
  const eventsMatch = route.match(/^\/api\/events\/([0-9a-f-]+)$/);
  if (eventsMatch && req.method === "GET") {
    const jobId = eventsMatch[1];
    const ticket = url.searchParams.get("ticket");
    const authed = isAuthorized(req) || validSseTicket(ticket, jobId);
    if (!authed) {
      // distinguishable from missing job so clients can re-auth cleanly
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const job = jobs.get(jobId);
    if (!job) return sendJson(res, 404, { error: "job not found" });
    // ticket single-purpose check: an expired/invalid ticket with a valid
    // shape gets an explicit marker so the client can fetch a new one
    const ticketExpired =
      !isAuthorized(req) && ticket && !validSseTicket(ticket, jobId);

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

    if (ticketExpired) {
      write({ kind: "ticket-expired", jobId });
    }

    // replay from the client's cursor (bounded by the job's buffer)
    if (cursor > 0) {
      for (const event of jobs.replay(jobId, cursor) || []) write(event);
    } else {
      for (const event of job.lines) write(event);
    }

    const terminal = job.status && TERMINAL_STATUS.has(job.status);
    if (terminal) {
      // ensure `done` is always the last event on a completed stream
      if (!job.lines.some((e) => e.kind === "done")) {
        write({ kind: "done", exitCode: job.exitCode, error: job.error, sessionId: job.sessionId });
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
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
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
