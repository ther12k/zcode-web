// Spawns the ZCode CLI in headless mode and manages chat jobs.
//
// Each chat message runs:
//   node <ZCODE_CLI_ENTRY> --prompt <text> --output-format stream-json \
//        --cwd <projectDir> --mode <mode> [--resume <sessionId>]
//
// The CLI prints one JSON event per line (envelope:
// {eventId, payload, seq, sessionId, timestamp, traceId, turnId, type}) and
// persists every turn into <ZCODE_HOME>/cli/db/db.sqlite, which is the same
// store the ZCode Desktop app reads.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stopCohort } from "./cleanup.js";

export const config = {
  cliEntry: process.env.ZCODE_CLI_ENTRY || "/opt/zcode/zcode.cjs",
  // Executable used to launch the CLI child process. Defaults to the current
  // runtime (Node today). A Bun-hosted server MUST set ZCODE_CLI_NODE to an
  // approved Node >= 24 path — launching zcode.cjs under Bun is unsupported.
  cliNode: (process.env.ZCODE_CLI_NODE || "").trim() || process.execPath,
  zcodeHome: process.env.ZCODE_HOME || join(homedir(), ".zcode"),
  jobTimeoutMs: Number(process.env.ZCODE_JOB_TIMEOUT_MS || 15 * 60_000),
  // how long a terminal job stays addressable for status + SSE replay
  jobRetentionMs: Number(process.env.ZCODE_JOB_RETENTION_MS || 30 * 60_000),
  maxJobs: Number(process.env.ZCODE_MAX_JOBS || 3),
  maxUploadBytes: Number(process.env.ZCODE_MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
  allowedModes: (process.env.ZCODE_ALLOWED_MODES || "plan,build,edit,yolo")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export function uploadsDir() {
  return join(config.zcodeHome, "uploads");
}

export function cliRuntimeStatus() {
  return {
    executable: config.cliNode,
    present: existsSync(config.cliNode),
    isExplicit: Boolean((process.env.ZCODE_CLI_NODE || "").trim()),
  };
}

export function cliStatus() {
  return {
    entry: config.cliEntry,
    present: existsSync(config.cliEntry),
    dbPath: join(config.zcodeHome, "cli", "db", "db.sqlite"),
    dbPresent: existsSync(join(config.zcodeHome, "cli", "db", "db.sqlite")),
    configPath: join(config.zcodeHome, "cli", "config.json"),
  };
}

class Job {
  constructor(opts) {
    this.id = randomUUID();
    this.cwd = opts.cwd;
    this.mode = opts.mode;
    this.resumeSessionId = opts.sessionId || null;
    this.sessionId = opts.sessionId || null; // first event updates it for new chats
    this.text = opts.text;
    this.requestId = opts.requestId || null;
    this.lines = [];
    this.subscribers = new Set();
    // ZWUI-007: immutable status state machine
    // queued -> running -> stopping -> (succeeded | failed | cancelled | timeout)
    this.status = "queued";
    this.timedOut = false;
    this.cancelRequested = false;
    this.killSignal = null;
    this.hasTurnFailed = false;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
    this.exitCode = null;
    this.error = null;
    this.stderrTail = "";
    // cleanup outcome is SEPARATE from execution status: a job may be
    // terminal (cancelled/timeout/...) while its process-cohort cleanup is
    // still pending / terminated / incomplete (inv/cleanup-verify)
    this.cleanup = { state: "none" };
    this.cleanupHandle = null;
  }

  setStatus(next) {
    // once terminal, status is immutable
    if (TERMINAL.has(this.status)) return;
    this.status = next;
    if (next === "running" && !this.startedAt) this.startedAt = Date.now();
    if (TERMINAL.has(next)) this.finishedAt = Date.now();
  }

  publish(event) {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // a dead SSE subscriber must not break the job
      }
    }
  }
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timeout"]);

// ZWUI-072: signal the CLI's process group (POSIX — spawn runs detached) so
// same-group members die with the CLI. Falls back to the direct child when
// the group is gone or on platforms without negative-PID signals. NOTE
// (inv/cleanup-verify): the CLI's tools run as their OWN session leaders, so
// a group signal can never reach them — the shared stop lifecycle
// (stopJobWork below) captures the descendant cohort and escalates against
// individual survivors; this group signal only covers same-group members.
function killTree(proc, signal) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    try {
      proc.kill(signal);
    } catch { /* already gone */ }
  }
}

function requestFingerprint({ text, sessionId, cwd, mode, model, attachments }) {
  return JSON.stringify({
    text: String(text || "").trim(),
    sessionId: sessionId || null,
    cwd: cwd || null,
    mode: mode || null,
    model: model || null,
    attachments: (attachments || []).map(String).sort(),
  });
}

export class JobManager {
  constructor() {
    this.jobs = new Map();
    // ZWUI-007: requestId -> { job, fingerprint } for idempotent submission
    this.byRequest = new Map();
    // Same-session active concurrency lock: sessionId -> job
    this.bySession = new Map();
    // ZWUI-008: bounded replay buffers per job (SSE v2 Last-Event-ID)
    this.replayMax = Number(process.env.ZCODE_SSE_REPLAY_MAX || 4000);
    // Jobs whose process-cohort cleanup is still pending (terminal jobs stay
    // here until their cleanup resolves — a terminal execution status never
    // discards cleanup targets). Shutdown drains this set.
    this.pendingCleanups = new Set();
    // Shutdown admission gate: once true, start() rejects new jobs.
    this.admissionClosed = false;
  }

  /** Shared stop lifecycle (cancel / timeout / shutdown). Captures the
   *  cohort BEFORE the caller's group signal, escalates against
   *  identity-validated survivors, and records the cleanup outcome on the
   *  job — separate from the execution outcome. Idempotent per job. MUST be
   *  awaited-before-first-signal ordering-wise: call this, THEN killTree. */
  stopJobWork(job, { firstSignal = "SIGTERM" } = {}) {
    if (job.cleanupHandle) return job.cleanupHandle;
    const pid = job.proc?.pid ?? null;
    const handle = stopCohort(pid, { firstSignal });
    job.cleanupHandle = handle;
    job.cleanup = { state: "pending" };
    this.pendingCleanups.add(job);
    handle.done.then((outcome) => {
      job.cleanup = outcome;
      if (outcome.state !== "pending") this.pendingCleanups.delete(job);
    });
    return handle;
  }

  /** Shutdown: stop all non-terminal jobs (preserving each job's own reason
   *  semantics — a shutdown stop marks cancelRequested so the CLI's death
   *  settles the job as cancelled, never mislabeled succeeded) and await
   *  EVERY pending cleanup — including jobs already terminal but still
   *  cleaning. `remainingMs` may be a duration or a () => ms function polled
   *  each tick (so an escalated shutdown can shorten a running drain).
   *  Resolves with an honest summary. */
  async shutdownDrain(remainingMs = 8000) {
    this.admissionClosed = true;
    const remain = () => {
      const v = typeof remainingMs === "function" ? remainingMs() : remainingMs;
      return Math.max(0, Number(v) || 0);
    };
    for (const job of this.jobs.values()) {
      if (!TERMINAL.has(job.status)) {
        job.cancelRequested = true;
        job.setStatus("stopping");
        this.stopJobWork(job, { firstSignal: "SIGTERM" });
        killTree(job.proc, "SIGTERM");
      }
    }
    const deadline = Date.now() + remain();
    while (Date.now() < deadline) {
      if (this.pendingCleanups.size === 0) break;
      await new Promise((r) => setTimeout(r, Math.min(200, Math.max(1, deadline - Date.now()))));
    }
    const unresolved = [...this.pendingCleanups];
    let incomplete = 0;
    for (const job of unresolved) {
      incomplete++;
      job.cleanup = { state: "incomplete", survivors: [], note: "shutdown deadline exceeded before cleanup resolved" };
      this.pendingCleanups.delete(job);
    }
    // also count cleanups that resolved incomplete during the drain
    for (const job of this.jobs.values()) {
      if (job.cleanup?.state === "incomplete" && !unresolved.includes(job)) incomplete++;
    }
    return { drained: unresolved.length === 0, incomplete, stopped: this.jobs.size };
  }

  get activeCount() {
    let n = 0;
    for (const job of this.jobs.values()) if (!TERMINAL.has(job.status)) n++;
    return n;
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  // Active (non-terminal) job currently running for a session, if any.
  // Used by /api/sessions/:id so a reloaded browser can adopt the live
  // run instead of falling back to a polling-only "working" state.
  activeJobForSession(sessionId) {
    if (!sessionId) return null;
    const job = this.bySession.get(sessionId);
    return job && !TERMINAL.has(job.status) ? job : null;
  }

  // The most recent job for a session REGARDLESS of status. The store's
  // runActive heuristic reads the newest message's time.completed — a turn
  // cancelled mid-stream leaves that null and looks busy for the recency
  // window. The registry's terminal verdict is authoritative over it.
  // After the retention window the entry is a COMPACT terminal record
  // (status/finishedAt + session descriptor), not a Job.
  lastJobForSession(sessionId) {
    if (!sessionId) return null;
    return this.bySession.get(sessionId) ?? null;
  }

  findByIdempotencyKey(requestId, payload) {
    if (!requestId) return null;
    const entry = this.byRequest.get(requestId);
    if (!entry) return null;
    if (payload) {
      const fp = requestFingerprint(payload);
      if (entry.fingerprint && entry.fingerprint !== fp) {
        const err = new Error("Idempotency conflict: same request id with different payload");
        err.status = 409;
        err.code = "IDEMPOTENCY_CONFLICT";
        throw err;
      }
    }
    return entry.job;
  }

  start({ text, sessionId, cwd, mode, model, modelApiKey, modelBaseUrl, attachments, requestId }) {
    // shutdown admission gate: once draining, no new work is accepted
    if (this.admissionClosed) {
      throw Object.assign(new Error("Server is shutting down"), { status: 503 });
    }
    // idempotent resubmission returns the original job (or rejects on conflict)
    const fp = requestId ? requestFingerprint({ text, sessionId, cwd, mode, model, attachments }) : null;
    if (requestId) {
      const existing = this.byRequest.get(requestId);
      if (existing) {
        if (existing.fingerprint && existing.fingerprint !== fp) {
          const err = new Error("Idempotency conflict: same request id with different payload");
          err.status = 409;
          err.code = "IDEMPOTENCY_CONFLICT";
          throw err;
        }
        return { job: existing.job, replayed: true };
      }
    }
    if (!existsSync(config.cliEntry)) {
      throw Object.assign(new Error("ZCode CLI bundle not found at " + config.cliEntry), { status: 503 });
    }
    if (!config.allowedModes.includes(mode)) {
      throw Object.assign(new Error(`Mode "${mode}" not allowed`), { status: 400 });
    }
    if (sessionId) {
      const activeSessionJob = this.bySession.get(sessionId);
      if (activeSessionJob && !TERMINAL.has(activeSessionJob.status)) {
        const err = new Error(`Session ${sessionId} is busy with an active run`);
        err.status = 409;
        err.code = "SESSION_BUSY";
        err.jobId = activeSessionJob.id;
        throw err;
      }
    }
    if (this.activeCount >= config.maxJobs) {
      throw Object.assign(new Error("Too many running jobs, try again shortly"), { status: 429 });
    }

    const job = new Job({ text, sessionId, cwd, mode, requestId });
    if (requestId) this.byRequest.set(requestId, { job, fingerprint: fp });
    if (sessionId) this.bySession.set(sessionId, job);
    const args = [
      config.cliEntry,
      "--prompt", text,
      "--output-format", "stream-json",
      "--cwd", cwd,
      "--mode", mode,
    ];
    if (sessionId) args.push("--resume", sessionId);
    for (const p of attachments || []) args.push("--attach", p);

    const proc = spawn(config.cliNode, args, {
      cwd,
      // own process group on POSIX (ZWUI-072): cancellation and timeout can
      // then signal the whole tree — the CLI shells out to tools whose
      // grandchildren would otherwise survive a kill of the direct child
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        // ZCODE_MODEL overrides the run's model, but the env-sourced provider
        // entry shadows the one in config.json — its API key AND baseURL must
        // ride along via env or the turn fails (provider_not_configured /
        // wrong endpoint auth).
        ...(model
          ? {
              ZCODE_MODEL: model,
              ...(modelApiKey ? { ZCODE_API_KEY: modelApiKey } : {}),
              ...(modelBaseUrl ? { ZCODE_BASE_URL: modelBaseUrl } : {}),
            }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.proc = proc;

    // ZWUI-008: numbered event stream for Last-Event-ID replay (bounded)
    let lastEventId = 0;
    const record = (event) => {
      event.id = ++lastEventId;
      job.lines.push(event);
      if (job.lines.length > this.replayMax) {
        job.lines.shift();
      }
      job.publish(event);
      return event;
    };

    // ZWUI-072: streaming UTF-8 decode — naively concatenating chunks splits
    // multibyte characters at chunk boundaries and corrupts the JSONL
    const decoder = new StringDecoder("utf8");
    const handleLine = (line) => {
      if (!line) return;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = { raw: line };
      }
      if (parsed.sessionId && !job.sessionId) {
        job.sessionId = parsed.sessionId;
        this.bySession.set(job.sessionId, job);
      }
      if (parsed.type === "turn.failed") {
        job.hasTurnFailed = true;
        if (parsed.payload?.error?.message) job.error = String(parsed.payload.error.message);
        else if (parsed.payload?.error) job.error = String(parsed.payload.error);
      }
      record({ kind: "line", line: parsed });
    };
    let stdoutBuf = "";
    proc.stdout.on("data", (chunk) => {
      stdoutBuf += decoder.write(chunk);
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        handleLine(line);
      }
    });
    proc.stdout.on("end", () => {
      // flush the decoder tail and any final unterminated line
      stdoutBuf += decoder.end();
      handleLine(stdoutBuf.trim());
      stdoutBuf = "";
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
      job.stderrTail = stderrBuf.slice(-4000);
    });

    const finish = (exitCode, error) => {
      if (TERMINAL.has(job.status)) return;
      job.finishedAt = Date.now();
      // bySession KEEPS the terminal verdict (for BOTH fresh and resumed
      // runs — resumeSessionId and sessionId are the same identity on a
      // resume, so deleting "the resume entry" deletes the verdict itself).
      // The detail/list routes read it to override the store's runActive
      // heuristic: a turn cancelled mid-stream leaves the newest message's
      // time.completed null and would otherwise look busy for the whole
      // recency window. Replacement is guarded so a newer job's entry is
      // never clobbered.
      job.exitCode = exitCode;
      job.error = error ? String(error) : (job.hasTurnFailed && !job.error ? "turn failed" : job.error);
      if (job.status === "stopping") {
        job.setStatus("cancelled");
      } else if (job.timedOut) {
        job.setStatus("timeout");
      } else if (error || job.hasTurnFailed || exitCode !== 0) {
        job.setStatus("failed");
      } else {
        job.setStatus("succeeded");
      }
      // ZWUI-040: the terminal event carries the AUTHORITATIVE job status —
      // the browser must not re-derive cancelled/failed/succeeded from
      // exitCode and error (a cancelled run closes with exitCode null and
      // a graceful post-cancel exit can be 0; both are still cancelled)
      record({
        kind: "done",
        exitCode,
        error: job.error,
        sessionId: job.sessionId,
        stderrTail: job.stderrTail,
        status: job.status,
        timedOut: job.timedOut,
        cancelRequested: job.cancelRequested,
        killSignal: job.killSignal,
      });
      clearTimeout(timer);
      // terminal jobs stay addressable (status + replay) for a window; the
      // session map only keeps a SMALL terminal record afterwards so replay
      // buffers and process references cannot accumulate per session. The
      // record carries the session DESCRIPTOR (title text, cwd, createdAt)
      // because the synthetic session-detail path serves web-only sessions
      // from it after expiry. Full-job retention is bounded by this window;
      // terminal-record cardinality itself is still unbounded — any future
      // eviction policy must preserve reconciliation, not silently restore
      // false busy states.
      setTimeout(() => {
        this.jobs.delete(job.id);
        if (job.requestId) this.byRequest.delete(job.requestId);
        for (const key of [job.sessionId, job.resumeSessionId]) {
          if (key && this.bySession.get(key) === job) {
            this.bySession.set(key, {
              sessionId: key,
              status: job.status,
              finishedAt: job.finishedAt,
              text: String(job.text || "").slice(0, 200),
              cwd: job.cwd,
              createdAt: job.createdAt,
              terminalRecord: true,
            });
          }
        }
      }, config.jobRetentionMs).unref();
    };

    const timer = setTimeout(() => {
      if (!TERMINAL.has(job.status)) {
        job.timedOut = true;
        record({ kind: "timeout" });
        // shared stop lifecycle: capture the cohort BEFORE the group signal
        // (timeout keeps its own reason — timedOut stays set, the settle
        // path below reports "timeout", never a plain cancellation)
        this.stopJobWork(job, { firstSignal: "SIGKILL" });
        killTree(proc, "SIGKILL");
      }
    }, config.jobTimeoutMs);
    timer.unref();

    proc.on("error", (err) => finish(null, err));
    proc.on("close", (code, signal) => {
      if (signal) job.killSignal = signal;
      if (job.timedOut) finish(code, null);
      else finish(code);
    });

    // live → running (single transition; errors surface via finish)
    job.setStatus("running");
    this.jobs.set(job.id, job);
    return { job, replayed: false };
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || TERMINAL.has(job.status)) return false;
    if (job.status === "stopping") return true;
    job.cancelRequested = true;
    job.setStatus("stopping");
    // shared stop lifecycle FIRST: the descendant cohort must be captured
    // before any signal can destroy the parent-child edges (own-session
    // tools are unreachable by the group signal alone)
    this.stopJobWork(job, { firstSignal: "SIGTERM" });
    killTree(job.proc, "SIGTERM");
    // Group escalation still runs (same-group members the cohort walk cannot
    // see, e.g. non-descendant group members). The cohort's individual,
    // identity-checked SIGKILL escalation runs inside stopJobWork — a
    // terminal job status never cancels it.
    const pgid = job.proc?.pid;
    setTimeout(() => {
      if (!job.cancelRequested || !pgid) return;
      try { process.kill(-pgid, "SIGKILL"); } catch { /* group already empty */ }
    }, 5000).unref();
    return true;
  }

  // ZWUI-008: events after a cursor for Last-Event-ID replay (bounded window)
  replay(jobId, afterId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return job.lines.filter((e) => (e.id || 0) > afterId);
  }
}
