// Lugas HTTP layer for zcode-web (#43). Serves the same API contract as the
// Node server (docs/baseline/api-contracts.md) with the vendored frontend.
//
// Run: ZCODE_CLI_NODE=/usr/local/bin/node bun run app.ts

import { defineApp, guard, json, route, sse } from "lugas";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  JobManager, SessionStoreProxy, TicketStore, bearerOk, config, saveUpload, uploadsDir,
} from "./shared.js";
import { SessionStore } from "./db.js";

const jobs = new JobManager();
const tickets = new TicketStore();
const store = new SessionStore(join(config.zcodeHome, "cli", "db", "db.sqlite"));
for (const r of config.allowedRoots) mkdirSync(r, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv", ".log": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const auth = guard({
  name: "auth",
  handler: ({ request }) => (bearerOk(request) ? { authed: true } : json(401, { error: "unauthorized" })),
});

function safeCwd(input) {
  const base = (input || "").trim();
  if (!base) return resolve(config.allowedRoots[0]);
  const dir = resolve(base);
  for (const root of config.allowedRoots) {
    if (dir === root || dir.startsWith(root + sep)) return dir;
  }
  const rel = resolve(config.allowedRoots[0], "." + sep + dir.replace(/^\/+/, ""));
  if (config.allowedRoots.some((root) => rel === root || rel.startsWith(root + sep))) return rel;
  throw Object.assign(new Error("cwd must be inside an allowed root: " + config.allowedRoots.join(", ")), { status: 400 });
}

function listModels() {
  try {
    const cfg = JSON.parse(readFileSync(join(config.zcodeHome, "cli", "config.json"), "utf8"));
    const main = cfg.model?.main || (typeof cfg.model === "string" ? cfg.model : null);
    const out = [];
    for (const [id, p] of Object.entries(cfg.provider || {})) {
      for (const modelId of Object.keys(p?.models || {})) {
        const ref = `${id}/${modelId}`;
        out.push({
          ref, provider: id, providerName: p.name || id, model: modelId, isDefault: ref === main,
          ...(false ? {} : {}),
        });
      }
    }
    return { models: out, entryMap: Object.fromEntries(out.map((m) => [m.ref, {
      apiKey: cfg.provider[m.provider]?.options?.apiKey || null,
      baseURL: cfg.provider[m.provider]?.options?.baseURL || null,
    }])) };
  } catch {
    return { models: [], entryMap: {} };
  }
}

function providerConfigured() {
  try {
    const cfg = JSON.parse(readFileSync(join(config.zcodeHome, "cli", "config.json"), "utf8"));
    return Boolean(cfg?.model?.main || typeof cfg?.model === "string");
  } catch {
    return false;
  }
}

const upDir = uploadsDir();

async function readJsonBody(request, limitBytes) {
  const text = await request.text();
  if (text.length > limitBytes) throw Object.assign(new Error("body too large"), { status: 413 });
  return JSON.parse(text);
}

function apiRoutes() {
  return {
    "/api/health": {
      GET: route({
        handler: () =>
          json(200, {
            ok: true,
            runtime: "lugas/bun",
            cli: { entry: config.cliEntry, present: existsSync(config.cliEntry) },
            cliRuntime: {
              executable: config.cliNode || "(unset — job spawns will fail)",
              present: Boolean(config.cliNode && existsSync(config.cliNode)),
              isExplicit: Boolean(config.cliNode),
            },
            db: { path: store.dbPath, present: existsSync(store.dbPath), driver: store.driver },
            providerConfigured: providerConfigured(),
            workspaceRoot: config.allowedRoots[0],
            activeJobs: jobs.activeCount,
            maxJobs: config.maxJobs,
            authRequired: Boolean(config.token),
          }),
      }),
    },

    "/api/config": {
      GET: route({ before: [auth], handler: () => json(200, {
        authRequired: Boolean(config.token),
        workspaceRoot: config.allowedRoots[0],
        allowedRoots: config.allowedRoots,
        modes: config.allowedModes,
        defaultMode: "plan",
        cliPresent: existsSync(config.cliEntry),
        providerConfigured: providerConfigured(),
      }) }),
    },

    "/api/models": {
      GET: route({ before: [auth], handler: () => {
        const { models } = listModels();
        return json(200, { models });
      } }),
    },

    "/api/projects": {
      GET: route({ before: [auth], handler: () => json(200, {
        roots: config.allowedRoots.map((path) => {
          let projects = [];
          try {
            projects = readdirSync(path, { withFileTypes: true })
              .filter((d) => d.isDirectory() && !d.name.startsWith("."))
              .map((d) => d.name).sort();
          } catch {}
          return { path, projects };
        }),
      }) }),
      POST: route({ before: [auth], handler: async ({ request }) => {
        const body = await readJsonBody(request, 64 * 1024);
        const name = String(body.name || "").trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) return json(400, { error: "invalid project name" });
        const rootIdx = Number.isInteger(body.rootIndex) ? body.rootIndex : 0;
        const root = config.allowedRoots[rootIdx] || config.allowedRoots[0];
        const dir = join(root, name);
        if (existsSync(dir)) return json(409, { error: "project already exists" });
        mkdirSync(dir, { recursive: true });
        return json(201, { name, directory: dir });
      } }),
    },

    "/api/sessions": {
      GET: route({ before: [auth], handler: ({ request, query }) => {
        let dir;
        try { dir = safeCwd(new URL(request.url).searchParams.get("cwd")); }
        catch (e) { return json(400, { error: e.message }); }
        return json(200, { cwd: dir, sessions: store.list(dir) });
      } }),
    },

    "/api/sessions/:id": {
      GET: route({ before: [auth], handler: ({ params, query }) => {
        const session = store.get(params.id);
        if (!session) return json(404, { error: "session not found" });
        const limit = Math.min(Math.max(Number(query?.limit) || 5, 1), 400);
        const offset = Math.max(Number(query?.offset) || 0, 0);
        const { turns, total, hasMore } = store.transcript(session.id, { limit, offset });
        return json(200, { session, transcript: turns, total, hasMore });
      } }),
    },

    "/api/upload": {
      POST: route({ before: [auth], handler: async ({ request }) => {
        try {
          const body = await readJsonBody(request, Math.ceil(config.maxUploadBytes * 1.34) + 64 * 1024);
          const saved = saveUpload(body.name, body.data);
          return json(201, saved);
        } catch (e) {
          return json(e.status || 400, { error: e.message });
        }
      } }),
    },

    "/api/uploads/:file": {
      GET: route({ before: [auth], handler: ({ params }) => {
        const file = normalize(join(upDir, String(params.file)));
        if (!file.startsWith(upDir + sep) || !existsSync(file)) return json(404, { error: "not found" });
        return new Response(readFileSync(file), {
          status: 200,
          headers: { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "private, max-age=3600" },
        });
      } }),
    },

    "/api/sse-ticket": {
      POST: route({ before: [auth], handler: async ({ request }) => {
        const body = await readJsonBody(request, 16 * 1024);
        const jobId = String(body.jobId || "");
        if (!/^[0-9a-f-]{16,64}$/.test(jobId) || !jobs.get(jobId)) return json(404, { error: "job not found" });
        return json(200, { ticket: tickets.issue(jobId) });
      } }),
    },

    "/api/events/:jobId": {
      GET: route({
        handler: ({ request, params }) => {
          // auth: bearer header OR short-lived ticket (EventSource can't set headers)
          const jobId = String(params.jobId);
          const url = new URL(request.url);
          const ok = bearerOk(request) || tickets.valid(url.searchParams.get("ticket"), jobId);
          if (!ok) return json(401, { error: "unauthorized" });
          const job = jobs.get(jobId);
          if (!job) return json(404, { error: "job not found" });
          return sse({
            heartbeatMs: 15_000,
            start: (writer) => {
              const write = (event) => writer.send({ data: JSON.stringify(event) });
              for (const line of job.lines) write({ kind: "line", line });
              if (job.done) {
                write({ kind: "done", exitCode: job.exitCode, error: job.error, sessionId: job.sessionId });
                writer.close();
                return () => {};
              }
              job.subscribers.add(write);
              // G4: browser disconnect removes ONLY this subscriber — the CLI
              // job keeps running; cancel is an explicit POST.
              return () => job.subscribers.delete(write);
            },
          });
        },
      }),
    },

    "/api/chat": {
      POST: route({ before: [auth], handler: async ({ request }) => {
        const body = await readJsonBody(request, 1024 * 1024);
        let text = String(body.text || "").trim();
        const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
        if (!text && hasAttachments) text = "Analyze the attached file(s).";
        if (!text) return json(400, { error: "text is required" });
        let cwd;
        try { cwd = safeCwd(body.cwd); mkdirSync(cwd, { recursive: true }); }
        catch (e) { return json(e.status || 400, { error: e.message }); }
        const sessionId = body.sessionId && /^sess_[A-Za-z0-9-]+$/.test(body.sessionId) ? body.sessionId : null;
        const mode = config.allowedModes.includes(body.mode) ? body.mode : "plan";
        const { entryMap } = listModels();
        const modelEntry = entryMap[String(body.model)] || null;
        const requested = (Array.isArray(body.attachments) ? body.attachments : []).map((p) => resolve(String(p)));
        const bad = requested.filter((p) => !p.startsWith(upDir + sep) || !existsSync(p));
        if (bad.length) return json(400, { error: "attachments must be uploaded via /api/upload first", rejected: bad });
        try {
          const job = jobs.start({
            text, sessionId, cwd, mode,
            model: modelEntry ? String(body.model) : null,
            modelApiKey: modelEntry?.apiKey || null,
            modelBaseUrl: modelEntry?.baseURL || null,
            attachments: requested.slice(0, 5),
          });
          return json(202, { jobId: job.id, sessionId: job.sessionId, cwd, mode, model: modelEntry ? String(body.model) : null });
        } catch (e) {
          return json(e.status || 500, { error: e.message });
        }
      } }),
    },

    "/api/jobs/:id/cancel": {
      POST: route({ before: [auth], handler: ({ params }) => {
        const canceled = jobs.cancel(String(params.id));
        return json(canceled ? 200 : 404, canceled ? { canceled: true } : { error: "job not found or already finished" });
      } }),
    },
  };
}

// Legacy vanilla UI is served until the Vite app replaces it (ZWUI-003).
const PUBLIC_DIR = join(import.meta.dir, "..", "public");

export default defineApp({
  routes: apiRoutes(),
  assets: {
    files: {
      "/": join(PUBLIC_DIR, "index.html"),
      "/index.html": join(PUBLIC_DIR, "index.html"),
      "/app.js": join(PUBLIC_DIR, "app.js"),
      "/style.css": join(PUBLIC_DIR, "style.css"),
      "/vendor/marked.min.js": join(PUBLIC_DIR, "vendor", "marked.min.js"),
      "/vendor/purify.min.js": join(PUBLIC_DIR, "vendor", "purify.min.js"),
    },
  },
  notFound: () => json(404, { error: "not found" }),
});
