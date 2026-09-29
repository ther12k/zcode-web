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
import { AgentHostRegistry } from "./agent-host.mjs";

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
  // Execution engine (Path 2): "prompt" = one-shot CLI per message (default),
  // "agent" = long-lived agent-server per cwd with native session/stop
  // cancellation. Attachment jobs always use the prompt engine (--attach is
  // a prompt-mode flag; the protocol attachment surface is not wired yet).
  bridgeEngine: (process.env.ZCODE_BRIDGE_ENGINE || "prompt").trim(),
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
    engine: config.bridgeEngine,
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
    this.resultType = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
    this.exitCode = null;
    this.error = null;
    this.stderrTail = "";
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

// ZWUI-072: signal the whole process group (POSIX — spawn runs detached) so
// tool subprocesses die with the CLI. Falls back to the direct child when
// the group is gone or on platforms without negative-PID signals.
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

function requestFingerprint({ text, sessionId, cwd, mode, model, reasoningLevel, attachments }) {
  return JSON.stringify({
    text: String(text || "").trim(),
    sessionId: sessionId || null,
    cwd: cwd || null,
    mode: mode || null,
    model: model || null,
    reasoningLevel: reasoningLevel || null,
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
    // Path 2: cwd -> agent-server host (lazily created — a registry at boot
    // would spawn processes even when every job uses the prompt engine)
    this.agentHosts = null;
    if (config.bridgeEngine === "agent") {
      this.agentHosts = new AgentHostRegistry({
        cliNode: config.cliNode,
        cliEntry: config.cliEntry,
        zcodeHome: config.zcodeHome,
        log: (m) => console.log(m),
      });
      // best-effort host shutdown (the prompt engine has no long-lived
      // children; graceful-request drain is the separate cleanup branch)
      const shutdown = () => { try { this.agentHosts?.shutdownAll(2000); } catch {} };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    }
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

  start({ text, sessionId, cwd, mode, model, reasoningLevel, modelApiKey, modelBaseUrl, attachments, requestId }) {
    // idempotent resubmission returns the original job (or rejects on conflict)
    const fp = requestId ? requestFingerprint({ text, sessionId, cwd, mode, model, reasoningLevel, attachments }) : null;
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

    // Path 2: long-lived agent-server engine with native cancellation.
    // Attachment jobs stay on the prompt engine (--attach is prompt-only).
    if (this.agentHosts && !(attachments || []).length) {
      // async on purpose: the API returns 202 immediately and the SSE stream
      // carries session events once the host is up; setup failures terminate
      // the job through the same terminal-event contract as the prompt path
      this.startAgentJob(job, { text, mode, model, reasoningLevel });
      this.jobs.set(job.id, job);
      job.setStatus("running");
      return { job, replayed: false };
    }

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
              ZCODE_MODEL: reasoningLevel ? `${model}$${reasoningLevel}` : model,
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
      setTimeout(() => this.evictJob(job), config.jobRetentionMs).unref();
    };

    const timer = setTimeout(() => {
      if (!TERMINAL.has(job.status)) {
        job.timedOut = true;
        record({ kind: "timeout" });
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

  // ---- Path 2: agent-server engine --------------------------------------
  //
  // One TURN per job, executed on a long-lived per-cwd agent-server via the
  // ZCode Protocol. session/event notifications carry the SAME envelope shape
  // the prompt engine's stream-json lines do ({eventId,payload,seq,
  // sessionId,timestamp,type}), so they are recorded as {kind:"line"} events
  // and the SSE/ frontend contract is unchanged. Cancellation is NATIVE:
  // session/stop aborts the turn and the CLI itself tree-kills the turn's
  // tools (pinned-verified on 0.16.9) — no process kill, session stays
  // usable, host stays alive for the next message.
  async startAgentJob(job, { text, mode, model, reasoningLevel }) {
    let lastEventId = 0;
    const record = (event) => {
      event.id = ++lastEventId;
      job.lines.push(event);
      if (job.lines.length > this.replayMax) job.lines.shift();
      job.publish(event);
      return event;
    };

    let settled = false;
    const finishAgent = (error) => {
      if (TERMINAL.has(job.status)) return;
      job.finishedAt = Date.now();
      job.exitCode = null;
      job.error = error ? String(error) : (job.hasTurnFailed && !job.error ? "turn failed" : job.error);
      if (job.status === "stopping") job.setStatus("cancelled");
      else if (job.timedOut) job.setStatus("timeout");
      else if (error || job.hasTurnFailed || job.resultType === "error_during_execution") job.setStatus("failed");
      else job.setStatus("succeeded");
      // same authoritative terminal contract as the prompt engine (ZWUI-040)
      record({
        kind: "done",
        exitCode: null,
        error: job.error,
        sessionId: job.sessionId,
        stderrTail: job.stderrTail,
        status: job.status,
        timedOut: job.timedOut,
        cancelRequested: job.cancelRequested,
        killSignal: null,
        ...(job.resultType ? { resultType: job.resultType } : {}),
      });
      settled = true;
      clearTimeout(timeoutTimer);
      host?.listeners?.delete(listener);
      setTimeout(() => this.evictJob(job), config.jobRetentionMs).unref();
    };

    // routed notifications for THIS job's session
    let host = null;
    let modelRef = model && model.includes("/") ? model : null;
    let levelRetried = false;
    const listener = (n) => {
      if (n.method === "__host_exited") {
        if (!TERMINAL.has(job.status)) {
          finishAgent(`agent-server exited (${n.params?.code ?? n.params?.signal ?? "unknown"})`);
        }
        return;
      }
      if (n.method !== "session/event" || !n.params) return;
      const ev = n.params;
      if (ev.sessionId && ev.sessionId !== job.sessionId) return; // other sessions on the shared host
      if (ev.type === "turn.failed") {
        job.hasTurnFailed = true;
        if (ev.payload?.error?.message) job.error = String(ev.payload.error.message);
        // self-heal the known first-turn shape: the registry demands a
        // reasoning level, and the level list only arrives on the state
        // patch that FOLLOWS this failure — wait briefly for it, resend once
        if (
          !levelRetried && modelRef && job.status === "running"
          && /reasoning level is required/i.test(String(ev.payload?.error?.message || ""))
        ) {
          levelRetried = true;
          record({ kind: "line", line: ev });
          job.hasTurnFailed = false;
          job.error = null;
          const deadline = Date.now() + 1500;
          const tryResend = async () => {
            while (Date.now() < deadline && !host?.levelFor(job.sessionId, modelRef)) {
              await new Promise((r) => setTimeout(r, 50));
            }
            const level = host?.levelFor(job.sessionId, modelRef);
            if (!level || TERMINAL.has(job.status)) {
              job.hasTurnFailed = true;
              job.error = String(ev.payload?.error?.message || "turn failed");
              finishAgent(job.error);
              return;
            }
            try {
              const slash = modelRef.indexOf("/");
              await host.send(job.sessionId, job.text, {
                providerId: modelRef.slice(0, slash),
                modelId: modelRef.slice(slash + 1),
                options: { reasoningLevel: level },
              });
            } catch (e) {
              finishAgent(e?.message || String(e));
            }
          };
          tryResend();
          return;
        }
      }
      if (ev.type === "turn.completed" || ev.type === "turn.failed") {
        // per-session send lock means the terminal turn event arriving while
        // this job is active IS this job's turn
        job.resultType = ev.payload?.resultType ?? null;
        if (job.status === "stopping" || ev.payload?.resultType === "cancelled") {
          // stopping → cancelled; a completed turn after a stop request is
          // still a cancelled RUN even if the CLI finished the sentence
          job.resultType = "cancelled";
        }
        record({ kind: "line", line: ev });
        finishAgent(job.hasTurnFailed ? (job.error || "turn failed") : null);
        return;
      }
      record({ kind: "line", line: ev });
    };

    const timeoutTimer = setTimeout(() => {
      if (TERMINAL.has(job.status)) return;
      job.timedOut = true;
      record({ kind: "timeout" });
      // native stop, then a bounded wait; a wedged agent must not hold the
      // job addressable forever (the host itself is reaped independently)
      host?.stop(job.sessionId).catch(() => {});
      setTimeout(() => {
        if (!settled && !TERMINAL.has(job.status)) finishAgent("timeout waiting for turn to settle after session/stop");
      }, 8000).unref();
    }, config.jobTimeoutMs);
    timeoutTimer.unref();

    try {
      host = await this.agentHosts.acquire(job.cwd, (tail) => { job.stderrTail = tail.slice(-4000); });
      host.listeners.add(listener);
      job.agent = { host, sessionId: job.resumeSessionId };

      const { sessionId, resumed } = await host.ensureSession({ resumeId: job.resumeSessionId, mode });
      job.sessionId = sessionId;
      job.agent.sessionId = sessionId;
      this.bySession.set(sessionId, job);
      // follow-ups may change the mode (the UI sends it with every message);
      // resume keeps the session's old mode, so reconcile before sending
      const stored = host.sessions.get(sessionId);
      if (mode && stored && stored.mode !== mode) {
        await host.setMode(sessionId, mode).catch(() => {});
        stored.mode = mode;
      }
      if (!resumed && !job.resumeSessionId) {
        record({ kind: "line", line: { type: "session.created", sessionId, payload: {} } });
      }

      if (modelRef) {
        const slash = modelRef.indexOf("/");
        const base = { providerId: modelRef.slice(0, slash), modelId: modelRef.slice(slash + 1) };
        // an explicit user choice wins; otherwise the registry demands a
        // level whenever the merged spec declares values — send the
        // advertised default up front
        const level = reasoningLevel || host.levelFor(sessionId, modelRef);
        await host.send(sessionId, text, level
          ? { ...base, options: { reasoningLevel: level } }
          : base);
        // a level-requiring model with no cached level fails its first turn;
        // the listener self-heals that (see turn.failed above)
      } else {
        await host.send(sessionId, text, null);
      }
      // turn events now stream through `listener` until the terminal event
    } catch (e) {
      finishAgent(e?.message || String(e));
    }
  }

  /** Compact a session's history (context maintenance). Engine-aware:
   *  agent → protocol session/compact on the session's host (session must be
   *  idle; compaction itself runs a summarization turn inside the CLI);
   *  prompt → a regular one-shot job whose prompt text IS the /compact
   *  slash command, followed via the normal job/SSE surface. */
  async compactSession({ sessionId, cwd, instructions }) {
    if (!sessionId) throw Object.assign(new Error("sessionId is required"), { status: 400 });
    const active = this.bySession.get(sessionId);
    if (active && !TERMINAL.has(active.status)) {
      throw Object.assign(new Error("Session is busy with an active run"), { status: 409, code: "SESSION_BUSY" });
    }
    const text = instructions ? `/compact ${instructions}` : "/compact";
    if (this.agentHosts) {
      const host = await this.agentHosts.acquire(cwd);
      // strict: compacting must target THIS session — never a fresh one
      await host.ensureSession({ resumeId: sessionId, strict: true });
      const result = await host.compact(sessionId, instructions);
      return { engine: "agent", result };
    }
    const { job } = this.start({ text, sessionId, cwd, mode: "plan" });
    return { engine: "prompt", jobId: job.id };
  }

  /** Fork a session at a message boundary. Agent-engine only — the prompt
   *  engine has no fork concept. The CLI persists the child session itself
   *  (parent's directory), so it lands in the sidebar via normal listing;
   *  history is copied up to and including the boundary message. */
  async forkSession({ sessionId, cwd, messageId }) {
    if (!sessionId) throw Object.assign(new Error("sessionId is required"), { status: 400 });
    const active = this.bySession.get(sessionId);
    if (active && !TERMINAL.has(active.status)) {
      throw Object.assign(new Error("Session is busy with an active run"), { status: 409, code: "SESSION_BUSY" });
    }
    if (!this.agentHosts) {
      throw Object.assign(new Error("session fork requires the agent engine"), { status: 501, code: "ENGINE_UNSUPPORTED" });
    }
    const host = await this.agentHosts.acquire(cwd);
    // strict: forking must target THIS session — never a fresh one
    await host.ensureSession({ resumeId: sessionId, strict: true });
    try {
      const result = await host.fork(sessionId, messageId ? { kind: "message", messageId } : undefined);
      return { engine: "agent", result };
    } catch (e) {
      // the CLI's own guard fires when ANY writer (desktop, CLI) holds the
      // session — surface it as the same busy verdict our fast path returns
      if (/cannot fork/i.test(e.message || "")) {
        throw Object.assign(e, { status: 409, code: "SESSION_BUSY" });
      }
      throw e;
    }
  }

  // Bounded fallback when a native stop never produces a terminal event:
  // the run verdict is cancelled (the stop WAS requested); any events that
  // arrive later are recorded but cannot resurrect the job.
  settleAgentCancelled(job) {
    if (TERMINAL.has(job.status)) return;
    job.error = null;
    job.hasTurnFailed = false;
    job.resultType = "cancelled";
    job.setStatus("cancelled");
    job.finishedAt = Date.now();
    const done = {
      kind: "done",
      id: (job.lines[job.lines.length - 1]?.id || 0) + 1,
      exitCode: null,
      error: null,
      sessionId: job.sessionId,
      status: job.status,
      timedOut: false,
      cancelRequested: true,
      killSignal: null,
      resultType: "cancelled",
      lateSettlement: true,
    };
    job.lines.push(done);
    job.publish(done);
    setTimeout(() => this.evictJob(job), config.jobRetentionMs).unref();
  }

  // Shared terminal retention: drop the full job after the window, keep a
  // compact terminal record in the session map (see finish() notes).
  evictJob(job) {
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
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || TERMINAL.has(job.status)) return false;
    if (job.status === "stopping") return true;
    job.cancelRequested = true;
    job.setStatus("stopping");
    if (job.agent) {
      // NATIVE cancellation: session/stop aborts the turn and the CLI kills
      // the turn's tools itself; the host and session stay alive. A bounded
      // fallback settles the job if the terminal event never arrives — a
      // late terminal event is then recorded but the verdict stands.
      job.agent.host.stop(job.agent.sessionId).catch(() => {});
      setTimeout(() => this.settleAgentCancelled(job), 8000).unref();
      return true;
    }
    killTree(job.proc, "SIGTERM");
    // Escalation targets the PROCESS GROUP and runs even after the job goes
    // terminal: the CLI can exit promptly on SIGTERM while a tool subprocess
    // it spawned ignores the term signal — "group leader exited" is not
    // proof the owned group is empty. ESRCH means the group is gone (the
    // clean case); pid reuse before this fires would require the entire
    // group to die and a new session leader to take the id.
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
