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

export const config = {
  cliEntry: process.env.ZCODE_CLI_ENTRY || "/opt/zcode/zcode.cjs",
  zcodeHome: process.env.ZCODE_HOME || join(homedir(), ".zcode"),
  jobTimeoutMs: Number(process.env.ZCODE_JOB_TIMEOUT_MS || 15 * 60_000),
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
      try {
        sub(event);
      } catch {
        // a dead SSE subscriber must not break the job
      }
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

    const proc = spawn(process.execPath, args, {
      cwd,
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

    let stdoutBuf = "";
    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = { raw: line };
        }
        job.lines.push(parsed);
        if (parsed.sessionId && !job.sessionId) job.sessionId = parsed.sessionId;
        job.publish({ kind: "line", line: parsed });
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk;
      job.stderrTail = stderrBuf.slice(-4000);
    });

    const finish = (exitCode, error) => {
      if (job.done) return;
      job.done = true;
      job.exitCode = exitCode;
      job.error = error ? String(error) : null;
      job.publish({ kind: "done", exitCode, error: job.error, sessionId: job.sessionId, stderrTail: job.stderrTail });
      clearTimeout(timer);
      // keep finished jobs around briefly so late SSE subscribers can replay
      setTimeout(() => this.jobs.delete(job.id), 10 * 60_000).unref();
    };

    const timer = setTimeout(() => {
      if (!job.done) {
        job.publish({ kind: "timeout" });
        proc.kill("SIGKILL");
      }
    }, config.jobTimeoutMs);
    timer.unref();

    proc.on("error", (err) => finish(null, err));
    proc.on("close", (code) => finish(code));

    this.jobs.set(job.id, job);
    return job;
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.done) return false;
    job.proc.kill("SIGTERM");
    setTimeout(() => !job.done && job.proc.kill("SIGKILL"), 5000).unref();
    return true;
  }
}
