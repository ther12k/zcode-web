// ZWUI-050: job-keyed run manager — the single owner of run state, streams
// and reconciliation polls.
//
// The kit's most important implementation rule, applied: a panel SUBSCRIBES to
// a run; it never owns one merely by being visible. State lives here, in a
// module-level external store (useSyncExternalStore), keyed by conversation —
// so switching projects (which remounts ChatPanel), opening another session,
// or starting a new chat all leave running jobs intact and resumable. The
// reducer (ZWUI-016) stays pure and unchanged; this module only schedules
// actions onto the right entry and owns transports.
//
// Identity rules preserved:
//  - every async step re-validates ownership after each await
//  - acceptance rekeys `new:<nonce>` entries to their created session (with
//    an alias so a mounted panel does not lose its run mid-navigation)
//  - terminal runs are retained briefly for status/replay, then evicted

import type { ApiClient } from "../api/client";
import type { StoredEvent, RunState } from "./run";
import { runReducer, initialRun, isTerminal } from "./run";
import { StreamController } from "./stream";
import { randomUUID } from "../lib/uuid";
import type { Submission } from "../lib/submission";

export type RunKey = string;

export type SubmitCallbacks = {
  /** acceptance (including replayed idempotent adoption) — view concerns live here */
  onAccepted?: (accepted: { jobId: string; sessionId: string | null; replayed?: boolean }, submission: Submission) => void;
  /** the POST itself failed — delivery is ambiguous, the run may exist */
  onFailed?: (message: string, submission: Submission) => void;
};

type RunEntry = {
  run: RunState;
  client: ApiClient | null;
  controller: StreamController | null;
  poll: ReturnType<typeof setInterval> | null;
  pollStop: ReturnType<typeof setTimeout> | null;
  request: Submission | null;
  listeners: Set<() => void>;
  gcTimer: ReturnType<typeof setTimeout> | null;
  /** the entry already moved to (and aliases under) its session key */
  rekeyed: boolean;
  /** alias keys that still map to this entry while subscribers hold them */
  aliases: Set<RunKey>;
};

const entries = new Map<RunKey, RunEntry>();
// ZWUI-067: app-wide run-count subscribers (statusbar "N running")
const globalListeners = new Set<() => void>();
const MAX_ENTRIES = 40;
const TERMINAL_RETENTION_MS = 30 * 60_000;
// the live event list mirrors the server's bounded replay buffer
const MAX_EVENTS = 4000;

function entry(key: RunKey): RunEntry {
  let e = entries.get(key);
  if (!e) {
    e = {
      run: initialRun(),
      client: null, controller: null, poll: null, pollStop: null,
      request: null, listeners: new Set(), gcTimer: null, rekeyed: false,
      aliases: new Set(),
    };
    entries.set(key, e);
    evictIfNeeded();
  }
  return e;
}

function evictIfNeeded() {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [key, e] of entries) {
    if (entries.size <= MAX_ENTRIES) break;
    if (!isTerminal(e.run.phase) || e.listeners.size > 0) continue;
    destroy(key, e);
  }
}

function destroy(key: RunKey, e: RunEntry) {
  e.controller?.close();
  if (e.poll) clearInterval(e.poll);
  if (e.pollStop) clearTimeout(e.pollStop);
  if (e.gcTimer) clearTimeout(e.gcTimer);
  entries.delete(key);
  // ZWUI-072: alias keys pointed at this very entry — leaving them in the
  // map leaked (and let a later destroy() through an alias yank the live key)
  for (const alias of e.aliases) entries.delete(alias);
  e.aliases.clear();
}

function notify(e: RunEntry) {
  for (const cb of e.listeners) {
    try { cb(); } catch { /* a dead subscriber must not break the run */ }
  }
  for (const cb of globalListeners) {
    try { cb(); } catch { /* same */ }
  }
}

function dispatch(key: RunKey, e: RunEntry, action: Parameters<typeof runReducer>[1]) {
  const before = e.run;
  const after = runReducer(before, action);
  if (after === before) return;
  // bounded event store — drop the oldest events past the replay window
  if (after.events.length > MAX_EVENTS) {
    e.run = { ...after, events: after.events.slice(-MAX_EVENTS) };
  } else {
    e.run = after;
  }
  if (isTerminal(e.run.phase)) scheduleEviction(key, e);
  maybeRekey(key, e);
  notify(e);
}

// A run born under `new:<nonce>` learns its session from the stream
// envelopes (the acceptance response has none yet). Move the entry to its
// session key — keeping the old key as an alias so a mounted panel's
// subscription stays valid until the URL catches up.
function maybeRekey(key: RunKey, e: RunEntry) {
  const sid = e.run.sessionId;
  if (!sid || e.rekeyed) return;
  const sep = key.indexOf("::");
  const target = sep >= 0 ? `${key.slice(0, sep)}::${sid}` : sid;
  e.rekeyed = true;
  if (target !== key) rekeyRun(key, target);
}

function scheduleEviction(key: RunKey, e: RunEntry) {
  if (e.gcTimer) return;
  e.gcTimer = setTimeout(() => {
    e.gcTimer = null;
    if (e.listeners.size === 0) destroy(key, e);
  }, TERMINAL_RETENTION_MS);
}

// ---- transport ownership (moved out of the panel) ----

function stopPolling(e: RunEntry) {
  if (e.poll) { clearInterval(e.poll); e.poll = null; }
  if (e.pollStop) { clearTimeout(e.pollStop); e.pollStop = null; }
}

function startTransport(key: RunKey, e: RunEntry, jobId: string) {
  const client = e.client!;
  e.controller?.close();
  const controller = new StreamController(client, jobId, {
    onEvents: (events: StoredEvent[]) => {
      if (e.run.jobId === jobId) dispatch(key, e, { type: "events", events });
    },
    onAttached: () => { if (e.run.jobId === jobId) dispatch(key, e, { type: "stream-attached" }); },
    onDetached: () => { if (e.run.jobId === jobId) dispatch(key, e, { type: "stream-detached" }); },
    onFatal: (message) => { if (e.run.jobId === jobId) dispatch(key, e, { type: "stream-lost", error: message }); },
  });
  e.controller = controller;
  controller.start();
  // reconciliation poll: finalizes truthfully if the stream dies
  stopPolling(e);
  e.poll = setInterval(async () => {
    if (e.run.jobId !== jobId) { stopPolling(e); return; }
    try {
      const st = await client.job(jobId);
      // the view may have moved on while the request was in flight —
      // identity is re-checked after every await, and the action carries
      // the job id so the reducer rejects stale applications regardless
      if (e.run.jobId !== jobId) return;
      dispatch(key, e, { type: "job-status", jobId, status: st.status as never });
      if (["succeeded", "failed", "cancelled", "timeout"].includes(st.status)) stopPolling(e);
    } catch { /* transient */ }
  }, POLL_MS);
  e.pollStop = setTimeout(stopPolling, 17 * 60_000, e);
}

// ---- public API ----

const RUN_POLL_MS = 5000;
/** Test hook — the reconciliation cadence is data-independent. */
export function __setPollIntervalForTests(ms: number) {
  POLL_MS = ms;
}
let POLL_MS = RUN_POLL_MS;

export function subscribeRun(key: RunKey, onChange: () => void): () => void {
  const e = entry(key);
  e.listeners.add(onChange);
  return () => {
    e.listeners.delete(onChange);
    // ZWUI-072: once nobody listens through this entry, its alias keys stop
    // resolving it — otherwise a rekeyed conversation leaks two map slots
    if (e.listeners.size === 0 && e.aliases.size > 0) {
      for (const alias of e.aliases) {
        if (entries.get(alias) === e) entries.delete(alias);
      }
      e.aliases.clear();
    }
  };
}

export function getRun(key: RunKey): RunState {
  return entry(key).run;
}

export function isRunBusy(key: RunKey): boolean {
  const { run } = entry(key);
  return run.phase !== "idle" && !isTerminal(run.phase);
}

// ZWUI-067: how many runs are live across ALL conversations (background runs
// included) — the statusbar count must reflect reality, not just the open one.
export function activeRunCount(): number {
  let n = 0;
  for (const e of entries.values()) {
    if (e.run.phase !== "idle" && !isTerminal(e.run.phase)) n++;
  }
  return n;
}

/** Subscribe to app-wide run-count changes (useSyncExternalStore). */
export function subscribeRuns(onChange: () => void): () => void {
  globalListeners.add(onChange);
  return () => globalListeners.delete(onChange);
}

/** The last submission attempt for this conversation — the retry source of truth. */
export function lastSubmission(key: RunKey): Submission | null {
  return entry(key).request;
}

export function cancelRun(key: RunKey) {
  const e = entry(key);
  if (!e.run.jobId || !e.client) return;
  void e.client.cancel(e.run.jobId).catch(() => { /* the poll/stream will report */ });
}

/**
 * Submit an immutable submission snapshot. `key` is the conversation the run
 * belongs to (`new:<nonce>` for a fresh chat — rekeyed on acceptance).
 */
export async function submitRun(key: RunKey, submission: Submission, client: ApiClient, callbacks: SubmitCallbacks = {}): Promise<void> {
  const e = entry(key);
  if (isRunBusy(key)) return;
  e.client = client;
  e.request = submission;
  dispatch(key, e, { type: "submit", requestId: submission.requestId, text: submission.text });
  // stop any previous stream attached to THIS conversation entry
  e.controller?.close();
  e.controller = null;
  try {
    const accepted = await client.chat({
      text: submission.text || "Analyze the attached file(s).",
      sessionId: submission.sessionId,
      cwd: submission.cwd,
      mode: submission.mode,
      model: submission.model || undefined,
      attachments: submission.attachments.length
        ? submission.attachments.map((a) => (typeof a === "string" ? a : a.uploadRef))
        : undefined,
      requestId: submission.requestId,
    });
    // the run's record always adopts its job — even if its panel navigated
    // away; only VIEW concerns (navigation) are the caller's business
    dispatch(key, e, { type: "accepted", jobId: accepted.jobId, sessionId: accepted.sessionId ?? submission.sessionId });
    callbacks.onAccepted?.(accepted, submission);
    startTransport(key, e, accepted.jobId);
  } catch (err) {
    dispatch(key, e, { type: "submit-failed", error: err instanceof Error ? err.message : String(err) });
    callbacks.onFailed?.(err instanceof Error ? err.message : String(err), submission);
  }
}

/** Ambiguous delivery: the SAME request id and exact payload — one CLI run. */
export function retryDelivery(key: RunKey, callbacks: SubmitCallbacks = {}): void {
  const e = entry(key);
  const req = e.request;
  if (!req || !e.client || req.requestId !== e.run.requestId) return;
  void submitRun(key, req, e.client, callbacks);
}

/** Deliberate new execution after a terminal failure: new identity, same payload. */
export function retryFailedRun(key: RunKey, callbacks: SubmitCallbacks = {}): void {
  const e = entry(key);
  const req = e.request;
  if (!req || !e.client) return;
  void submitRun(key, { ...req, requestId: randomUUID() }, e.client, callbacks);
}

/**
 * Acceptance-time rekey: a run born under `new:<nonce>` now belongs to its
 * session. The old key keeps ALIASING the entry so a mounted panel's
 * subscription stays valid until the URL catches up.
 */
export function rekeyRun(fromKey: RunKey, toKey: RunKey) {
  const e = entries.get(fromKey);
  if (!e || fromKey === toKey) return;
  const existing = entries.get(toKey);
  // adopt the session slot only when it holds nothing live
  if (!existing || (isTerminal(existing.run.phase) && existing.listeners.size === 0)) {
    if (existing) destroy(toKey, existing);
    entries.set(toKey, e);
    // ZWUI-072: the old key aliases the entry only while someone still
    // subscribes through it — with no listeners it would just leak
    if (e.listeners.size === 0) entries.delete(fromKey);
    else e.aliases.add(fromKey);
  }
}

/** Detach a view from a run WITHOUT stopping it (New chat / view switch). */
export function releaseView(key: RunKey) {
  const e = entries.get(key);
  if (!e) return;
  e.controller?.close();
  e.controller = null;
}

/**
 * ZWUI-075: Adopt an existing server-side in-flight job for a session.
 * Called when a reloaded or newly-opened browser view discovers via
 * /api/sessions/:id that the server is actively running a job for this
 * session. Reconnects to SSE with Last-Event-ID = 0 (replays stream from
 * the server's ring buffer), adopting the live run without an empty submit.
 */
export function adoptRunningJob(key: RunKey, jobId: string, sessionId: string, client: ApiClient) {
  const e = entry(key);
  // this conversation already owns this job — attached or finished, adoption
  // is done (re-attaching a terminal job would only replay a dead stream)
  if (e.run.jobId === jobId) return;
  // a submission POST is in flight for this conversation — it will attach its
  // own job; adopting now would race it and poison the replay cursor
  if (e.run.phase === "submitting") return;
  // another active job is locally known — do not clobber it
  if (e.run.jobId && !isTerminal(e.run.phase)) return;

  e.client = client;
  // A terminal local entry refers to an EARLIER job for this session. Reset
  // its reducer identity before adopting the server's live job; otherwise
  // events for the new job are rejected by the reducer's job-id guard and
  // the reloaded view stays idle forever.
  if (e.run.jobId) dispatch(key, e, { type: "reset" });
  dispatch(key, e, { type: "accepted", jobId, sessionId });
  startTransport(key, e, jobId);
}
