// Shared runtime bits for the Lugas server (Bun) that differ from the Node
// server only in runtime APIs. Application semantics — job rules, ticket
// policy, upload validation — are ported verbatim from ../server/*.

import { spawn } from "node:child_process";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const config = {
  cliEntry: process.env.ZCODE_CLI_ENTRY || "/opt/zcode/zcode.cjs",
  // G1: the CLI child must run under an approved Node >= 24 — never the Bun
  // process hosting this server. Explicit env wins; otherwise refuse to
  // start jobs (fail-closed) rather than silently spawning Bun.
  cliNode: (process.env.ZCODE_CLI_NODE || "").trim(),
  zcodeHome: process.env.ZCODE_HOME || join(homedir(), ".zcode"),
  jobTimeoutMs: Number(process.env.ZCODE_JOB_TIMEOUT_MS || 15 * 60_000),
  maxJobs: Number(process.env.ZCODE_MAX_JOBS || 3),
  maxUploadBytes: Number(process.env.ZCODE_MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
  token: (process.env.ZCODE_WEB_TOKEN || "").trim(),
  allowedModes: (process.env.ZCODE_ALLOWED_MODES || "plan,build,edit,yolo")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowedRoots: [
    ...new Set(
      [
        process.env.ZCODE_WORKSPACE_ROOT || join(homedir(), "Workspace"),
        ...(process.env.ZCODE_ALLOWED_ROOTS || "").split(":"),
      ]
        .map((r) => r && r.trim())
        .filter(Boolean)
    ),
  ],
};

export function uploadsDir() {
  return join(config.zcodeHome, "uploads");
}

// ---------- jobs ----------

class Job {
  constructor(opts) {
    this.id = randomUUID();
    this.cwd = opts.cwd;
    this.mode = opts.mode;
    this.sessionId = opts.sessionId || null;
    this.text = opts.text;
    this.lines = [];
    this.subscribers = new Set();
    this.done = false;
    this.exitCode = null;
    this.error = null;
    this.stderrTail = "";
    this.startedAt = Date.now();
  }
  publish(event) {
    for (const sub of this.subscribers) {
      try { sub(event); } catch { /* dead subscriber */ }
    }
  }
}

export class JobManager {
  constructor() {
    this.jobs = new Map();
  }
  get activeCount() {
    let n = 0;
    for (const job of this.jobs.values()) if (!job.done) n++;
    return n;
  }
  get(jobId) {
    return this.jobs.get(jobId) || null;
  }
  start({ text, sessionId, cwd, mode, model, modelApiKey, modelBaseUrl, attachments }) {
    if (!existsSync(config.cliEntry)) {
      throw Object.assign(new Error("ZCode CLI bundle not found at " + config.cliEntry), { status: 503 });
    }
    if (!config.cliNode || !existsSync(config.cliNode)) {
      throw Object.assign(
        new Error("ZCODE_CLI_NODE must name an existing Node >= 24 executable (the CLI cannot run under Bun)"),
        { status: 503 }
      );
    }
    if (this.activeCount >= config.maxJobs) {
      throw Object.assign(new Error("Too many running jobs, try again shortly"), { status: 429 });
    }
    if (!config.allowedModes.includes(mode)) {
      throw Object.assign(new Error(`Mode "${mode}" not allowed`), { status: 400 });
    }
    const job = new Job({ text, sessionId, cwd, mode });
    const args = [
      config.cliEntry,
      "--prompt", text,
      "--output-format", "stream-json",
      "--cwd", cwd,
      "--mode", mode,
    ];
    if (sessionId) args.push("--resume", sessionId);
    for (const p of attachments || []) args.push("--attach", p);

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      ...(model
        ? {
            ZCODE_MODEL: model,
            ...(modelApiKey ? { ZCODE_API_KEY: modelApiKey } : {}),
            ...(modelBaseUrl ? { ZCODE_BASE_URL: modelBaseUrl } : {}),
          }
        : {}),
    };
    const proc = spawn(config.cliNode, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    job.proc = proc;

    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      let nl;
      while ((nl = out.indexOf("\n")) !== -1) {
        const line = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (!line) continue;
        let parsed = null;
        try { parsed = JSON.parse(line); } catch { parsed = { raw: line }; }
        job.lines.push(parsed);
        if (parsed.sessionId && !job.sessionId) job.sessionId = parsed.sessionId;
        job.publish({ kind: "line", line: parsed });
      }
    });
    let err = "";
    proc.stderr.on("data", (chunk) => {
      err += chunk;
      job.stderrTail = err.slice(-4000);
    });
    const finish = (exitCode, error) => {
      if (job.done) return;
      job.done = true;
      job.exitCode = exitCode;
      job.error = error ? String(error) : null;
      job.publish({ kind: "done", exitCode, error: job.error, sessionId: job.sessionId, stderrTail: job.stderrTail });
      clearTimeout(timer);
      setTimeout(() => this.jobs.delete(job.id), 10 * 60_000).unref?.();
    };
    const timer = setTimeout(() => {
      if (!job.done) {
        job.publish({ kind: "timeout" });
        proc.kill("SIGKILL");
      }
    }, config.jobTimeoutMs);
    timer.unref?.();
    proc.on("error", (e) => finish(null, e));
    proc.on("close", (code) => finish(code));
    this.jobs.set(job.id, job);
    return job;
  }
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.done) return false;
    job.proc.kill("SIGTERM");
    setTimeout(() => !job.done && job.proc.kill("SIGKILL"), 5000).unref?.();
    return true;
  }
}

// ---------- SSE tickets (same policy as the Node server) ----------

export class TicketStore {
  constructor() {
    this.map = new Map();
  }
  issue(jobId) {
    for (const [t, v] of this.map) if (v.exp < Date.now()) this.map.delete(t);
    const ticket = randomBytes(24).toString("hex");
    this.map.set(ticket, { jobId, exp: Date.now() + config.jobTimeoutMs + 60_000 });
    return ticket;
  }
  valid(ticket, jobId) {
    const v = this.map.get(String(ticket || ""));
    return Boolean(v && v.jobId === jobId && v.exp > Date.now());
  }
}

// ---------- bearer auth (constant-time) ----------

export function bearerOk(request) {
  if (!config.token) return true;
  const h = request.headers.get("authorization") || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- uploads (same validation as Node server) ----------

export function saveUpload(name, b64) {
  const rawName = String(name || "file");
  const safeName = rawName.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "_").slice(0, 120);
  b64 = String(b64 || "").replace(/^data:[^;]*;base64,/, "");
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw Object.assign(new Error("invalid base64 payload"), { status: 400 });
  }
  const data = Buffer.from(b64, "base64");
  if (!data.length) throw Object.assign(new Error("empty file"), { status: 400 });
  if (data.length < Math.floor((b64.length * 3) / 4) - 2) {
    throw Object.assign(new Error("corrupt base64 payload"), { status: 400 });
  }
  if (data.length > config.maxUploadBytes) {
    throw Object.assign(new Error("file too large"), { status: 413 });
  }
  const dir = uploadsDir();
  mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
  writeFileSync(join(dir, fname), data);
  return { path: join(dir, fname), name: fname, size: data.length };
}
