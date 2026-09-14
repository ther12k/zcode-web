// ZWUI-016: normalized run reducer + immutable event store.
//
// Design rules enforced here:
//  - The selected conversation, a running job, and its network connection are
//    three different states. Switching sessions must not retarget a job.
//  - Events are append-only (immutable event store); render state is derived.
//  - Losing the stream must NOT imply completion — only `done`/`timeout`
//    events (or /api/jobs/:id confirming a terminal status) finalize a run.

export type RunPhase =
  | "idle"          // no job for this session
  | "submitting"    // POST /api/chat in flight
  | "queued"        // accepted, job status queued
  | "running"       // job running (stream may or may not be attached)
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export type StoredEvent = {
  id: number;              // server-assigned per-job sequence (SSE id)
  kind: "line" | "done" | "timeout" | "ticket-expired";
  line?: unknown;          // CLI envelope event
  exitCode?: number | null;
  error?: string | null;
  sessionId?: string | null;
};

export type RunState = {
  jobId: string | null;
  phase: RunPhase;
  requestId: string | null;
  sessionId: string | null;
  events: StoredEvent[];          // append-only
  lastEventId: number;            // highest applied id (replay cursor)
  streamAttached: boolean;        // transport state — NOT run state
  transportLost: boolean;         // reconnects exhausted; awaiting job reconciliation — run NOT failed
  error: string | null;
  activity: string;
  reasoning: string;
  answer: string;
};

export function initialRun(): RunState {
  return {
    jobId: null, phase: "idle", requestId: null, sessionId: null,
    events: [], lastEventId: 0, streamAttached: false, transportLost: false,
    error: null, activity: "", reasoning: "", answer: "",
  };
}

const TERMINAL: RunPhase[] = ["succeeded", "failed", "cancelled", "timeout"];

export function isTerminal(phase: RunPhase): boolean {
  return TERMINAL.includes(phase);
}

type Action =
  | { type: "submit"; requestId: string }
  | { type: "accepted"; jobId: string; sessionId: string | null; replayed?: boolean }
  | { type: "submit-failed"; error: string }
  | { type: "stream-attached" }
  | { type: "stream-detached" }                // transport lost — run continues
  | { type: "stream-lost"; error: string }     // transport reconnect exhausted — run continues, awaits job reconciliation
  | { type: "events"; events: StoredEvent[] }  // batch (replay or live)
  | { type: "job-status"; status: RunPhase; timedOut?: boolean } // from /api/jobs
  | { type: "reset" };

function applyEvent(run: RunState, ev: StoredEvent): RunState {
  // idempotency: ignore already-applied ids
  if (ev.id && ev.id <= run.lastEventId) return run;
  const next: RunState = {
    ...run,
    events: [...run.events, ev],
    lastEventId: ev.id ?? run.lastEventId,
  };
  switch (ev.kind) {
    case "line": {
      const line = ev.line as { type?: string; sessionId?: string; payload?: Record<string, unknown> } | undefined;
      const p = (line?.payload || {}) as Record<string, unknown>;
      // CLI envelopes carry the sessionId — adopt it when a new chat's job
      // was accepted before the CLI had created the session
      if (line?.sessionId) next.sessionId = line.sessionId;
      if (line?.type === "model.streaming" && typeof p.delta === "string") {
        if (p.kind === "reasoning_delta") next.reasoning = run.reasoning + p.delta;
        else if (p.kind === "text_delta" || p.kind === undefined) next.answer = run.answer + p.delta;
      } else if (line?.type === "turn.completed") {
        const resp = p.response;
        if (typeof resp === "string" && resp && !run.answer) next.answer = resp;
        next.activity = "completed";
      } else if (line?.type === "turn.failed") {
        const err = p.error as { message?: string } | undefined;
        next.error = err?.message || "turn failed";
        next.activity = "error: " + next.error;
      } else if (p.type === "model_request_started") {
        next.activity = "thinking…";
      } else if (p.type === "model_request_failed") {
        next.activity = "model request failed";
      }
      return next;
    }
    case "done": {
      next.phase = ev.exitCode === 0 && !ev.error ? "succeeded" : "failed";
      if (ev.error) next.error = ev.error;
      if (!next.answer && !ev.error && next.activity === "") next.activity = "done";
      return next;
    }
    case "timeout":
      next.phase = "timeout";
      next.activity = "job timed out and was killed";
      return next;
    case "ticket-expired":
      // stream transport problem, not run state — controller reconnects
      return next;
    default:
      return next;
  }
}

export function runReducer(run: RunState, action: Action): RunState {
  switch (action.type) {
    case "submit":
      return { ...initialRun(), phase: "submitting", requestId: action.requestId };
    case "accepted":
      return {
        ...run,
        phase: "queued",
        jobId: action.jobId,
        sessionId: action.sessionId ?? run.sessionId,
      };
    case "submit-failed":
      return { ...run, phase: "failed", error: action.error, activity: "error: " + action.error };
    case "stream-attached":
      return { ...run, streamAttached: true, transportLost: false };
    case "stream-detached":
      // transport state only: a detached stream never finalizes a run
      return { ...run, streamAttached: false };
    case "stream-lost":
      // stream transport exhausted: keep existing output, run is NOT failed, await reconciliation
      return { ...run, streamAttached: false, transportLost: true, activity: "connection lost — work may still be running" };
    case "events": {
      let next = run;
      for (const ev of action.events) next = applyEvent(next, ev);
      if (!isTerminal(next.phase) && next.jobId) next.phase = "running";
      return next;
    }
    case "job-status": {
      // authoritative reconciliation: only move a non-terminal run, and only
      // onto the server's terminal state
      if (isTerminal(run.phase)) return run;
      if (TERMINAL.includes(action.status)) return { ...run, phase: action.status };
      if (run.phase === "queued" && action.status === "running") return { ...run, phase: "running" };
      return run;
    }
    case "reset":
      return initialRun();
    default:
      return run;
  }
}
