// ZCode Protocol stdio client (NDJSON framing).
//
// Speaks the CLI's `agent-server` protocol: one JSON frame per line over the
// child's stdin/stdout. Frame shapes (packages/shared zcode-protocol):
//   request      {id, method, params}      → response {id, result} | {id, error:{code,message}}
//   notification {method, params}          (no id; server → us)
//   server-initiated requests carry string ids ("server-N") — we MUST answer
//   or the agent parks forever (session/requestRuntimePreferences,
//   interaction/requestPermission, interaction/requestUserInput).
//
// This module is transport only: what to do with events and how to answer
// server requests is injected, so tests can drive it against a fake
// agent-server without the real bundle.

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 20_000;

export class ProtocolClient {
  /**
   * @param {object} opts
   * @param {string} opts.command  executable (node)
   * @param {string[]} opts.args    [cliEntry, "agent-server"]
   * @param {string} opts.cwd
   * @param {NodeJS.ProcessEnv} opts.env
   * @param {(notification: {method: string, params?: unknown}) => void} [opts.onNotification]
   * @param {(req: {id: string|number, method: string, params?: unknown}) => unknown|Promise<unknown>} [opts.onServerRequest]
   * @param {(chunk: string) => void} [opts.onStderr]
   */
  constructor({ command, args, cwd, env, onNotification, onServerRequest, onStderr }) {
    this.pending = new Map();
    this.nextId = 1;
    this.exited = false;
    this.exitInfo = null;
    this.onNotification = onNotification || (() => {});
    this.onServerRequest = onServerRequest || (() => ({}));

    this.proc = spawn(command, args, {
      cwd,
      env,
      // own process group: a wedged agent must be hard-killable without
      // taking the server down with it
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exitedPromise = new Promise((resolve) => {
      this.proc.on("exit", (code, signal) => {
        this.exited = true;
        this.exitInfo = { code, signal };
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`agent-server exited before responding (${code ?? signal})`));
        }
        this.pending.clear();
        resolve(this.exitInfo);
      });
    });
    this.proc.on("error", (err) => {
      this.exited = true;
      this.exitInfo = { error: String(err?.message || err) };
    });

    const decoder = new StringDecoder("utf8");
    let buf = "";
    const handleLine = (line) => {
      if (!line) return;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return; // non-protocol stdout noise is ignored, not fatal
      }
      this.handleFrame(frame);
    };
    this.proc.stdout.on("data", (chunk) => {
      buf += decoder.write(chunk);
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        handleLine(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    });
    this.proc.stdout.on("end", () => {
      buf += decoder.end();
      handleLine(buf.trim());
    });
    if (onStderr) {
      const errDecoder = new StringDecoder("utf8");
      let errBuf = "";
      this.proc.stderr.on("data", (chunk) => {
        errBuf = (errBuf + errDecoder.write(chunk)).slice(-8000);
        onStderr(errBuf);
      });
    }
  }

  handleFrame(frame) {
    if (frame && frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.error) {
        const err = new Error(frame.error.message || "protocol error");
        err.code = frame.error.code;
        err.data = frame.error.data;
        entry.reject(err);
      } else {
        entry.resolve(frame.result);
      }
      return;
    }
    if (frame && frame.id !== undefined && frame.method) {
      // server-initiated request: answer async; failures answer as errors so
      // the agent is never parked waiting on a dead handler
      Promise.resolve()
        .then(() => this.onServerRequest({ id: frame.id, method: frame.method, params: frame.params }))
        .then((result) => this.respond(frame.id, { id: frame.id, result: result ?? {} }))
        .catch((err) => this.respond(frame.id, {
          id: frame.id,
          error: { code: -32000, message: String(err?.message || err) },
        }));
      return;
    }
    if (frame && frame.method) {
      this.onNotification({ method: frame.method, params: frame.params });
    }
  }

  respond(id, message) {
    if (this.exited) return;
    try {
      this.proc.stdin.write(JSON.stringify(message) + "\n");
    } catch { /* exiting */ }
  }

  /** Correlated request. Rejects on error frames, timeout, or child exit. */
  request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.exited) {
      return Promise.reject(new Error(`agent-server is not running (${this.exitInfo?.code ?? this.exitInfo?.signal ?? this.exitInfo?.error ?? "exited"})`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`agent-server request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.respond(id, { id, method, params });
    });
  }

  /** Best-effort terminate: TERM the group, then KILL after grace. */
  async dispose(graceMs = 2000) {
    if (this.exited) return this.exitInfo;
    try {
      if (process.platform !== "win32" && this.proc.pid) process.kill(-this.proc.pid, "SIGTERM");
      else this.proc.kill("SIGTERM");
    } catch { /* already gone */ }
    const exited = await Promise.race([
      this.exitedPromise,
      new Promise((r) => setTimeout(() => r(null), graceMs)),
    ]);
    if (!exited) {
      try {
        if (process.platform !== "win32" && this.proc.pid) process.kill(-this.proc.pid, "SIGKILL");
        else this.proc.kill("SIGKILL");
      } catch { /* already gone */ }
    }
    return this.exitInfo;
  }
}

/** Fresh correlation-safe id for session/send inputId tracking. */
export function newInputId() {
  return randomUUID();
}
