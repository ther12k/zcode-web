#!/usr/bin/env node
// Fake ZCode Protocol agent-server for tests. Implements the subset the
// zcode-web agent bridge speaks (see server/protocol-client.mjs and
// server/agent-host.mjs):
//   runtime/capabilities, session/create, session/resume, session/setMode,
//   session/send, session/stop, session/close
// plus the server-initiated requests a host MUST answer
// (session/requestRuntimePreferences).
//
// Scenarios via FAKE_SCENARIO env:
//   plain        turn runs briefly, then turn.completed (resultType success)
//   hold         turn runs until session/stop → turn.completed (cancelled)
//   fail         turn.failed immediately
//   crash        process exits(1) right after session/send
// Every received request frame is appended (JSON per line) to the file in
// FAKE_LOG so tests can assert exactly what the bridge sent.
import { appendFileSync } from "node:fs";

// Scenario source: FAKE_SCENARIO_FILE (re-read per turn — lets a test change
// behavior between spawns, e.g. crash-then-plain) or FAKE_SCENARIO env.
import { readFileSync } from "node:fs";
const readScenario = () => {
  if (process.env.FAKE_SCENARIO_FILE) {
    try { return readFileSync(process.env.FAKE_SCENARIO_FILE, "utf8").trim() || "plain"; } catch { return "plain"; }
  }
  return process.env.FAKE_SCENARIO || "plain";
};
const LOG = process.env.FAKE_LOG;
const log = (frame) => { if (LOG) { try { appendFileSync(LOG, JSON.stringify(frame) + "\n"); } catch {} } };

let buf = "";
const emit = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const evSeq = { n: 0 };
let sessionCounter = 0;
const sessions = new Map(); // sessionId -> { turnActive, scenario, mode }
let turnTimer = null;

const sessionEvent = (sessionId, type, payload = {}) =>
  emit({
    method: "session/event",
    params: {
      eventId: `ev-${++evSeq.n}`,
      payload,
      seq: evSeq.n,
      sessionId,
      timestamp: Date.now(),
      type,
    },
  });

const runTurn = (sessionId, content) => {
  const s = sessions.get(sessionId);
  const scenario = readScenario();
  s.turnActive = true;
  // UI-compatible stream (same envelope/payload shapes the prompt engine's
  // stream-json and the protocol session events share)
  sessionEvent(sessionId, "session.titleUpdated", { previousTitle: "", source: "first_input", title: String(content).slice(0, 40) });
  sessionEvent(sessionId, "turn.started", { turnNumber: 1, input: content });
  sessionEvent(sessionId, "session.updated", { model: "fake/model", modelRef: { providerId: "fake", modelId: "model" }, toolCount: 0 });
  sessionEvent(sessionId, "model.streaming", { assistantMessageId: "m1", delta: "", done: false, kind: "start" });
  if (scenario === "fail") {
    s.turnActive = false;
    sessionEvent(sessionId, "session.updated", { type: "model_request_failed" });
    sessionEvent(sessionId, "turn.failed", { error: { type: "unknown_error", message: "fake model failure" }, turnPhase: "processing_input" });
    return;
  }
  if (scenario === "crash") {
    process.exit(1);
  }
  if (scenario === "plain") {
    sessionEvent(sessionId, "model.streaming", { assistantMessageId: "m1", delta: `echo:${content}`, done: false, kind: "text_delta" });
    turnTimer = setTimeout(() => {
      s.turnActive = false;
      sessionEvent(sessionId, "model.streaming", { assistantMessageId: "m1", delta: "", done: true, kind: "finish" });
      sessionEvent(sessionId, "turn.completed", { response: `echo:${content}`, usage: { totalTokens: 10 }, toolCallCount: 0, resultType: "success" });
    }, 300);
    turnTimer.unref();
  }
  // "hold": streaming started, nothing until session/stop
};

const handlers = {
  "runtime/capabilities": () => ({ protocol: { name: "ZCode Protocol", version: 1 } }),
  "session/create": (params) => {
    const sessionId = `sess_fake_${++sessionCounter}`;
    sessions.set(sessionId, { turnActive: false, mode: params?.mode ?? "build" });
    sessionEvent(sessionId, "session.created", {});
    return { sessionId };
  },
  "session/resume": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    sessionEvent(params.sessionId, "session.resumed", {});
    return { sessionId: params.sessionId };
  },
  "session/setMode": (params) => {
    const s = sessions.get(params.sessionId);
    if (s) s.mode = params.mode;
    return {};
  },
  "session/subscribe": (params) => ({ sessionId: params.sessionId, eventSeq: 0, events: [] }),
  "session/read": (params) => ({ sessionId: params.sessionId, projection: { model: { available: [] } } }),
  "session/send": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    runTurn(params.sessionId, params.content);
    return { accepted: true, sessionId: params.sessionId, stateRevision: 1 };
  },
  "session/stop": (params) => {
    const s = sessions.get(params.sessionId);
    if (s?.turnActive) {
      if (turnTimer) clearTimeout(turnTimer);
      s.turnActive = false;
      sessionEvent(params.sessionId, "turn.completed", { response: "", resultType: "cancelled" });
    }
    return {};
  },
  "session/close": (params) => {
    sessions.delete(params.sessionId);
    return { closed: true };
  },
};

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    if (frame.id === undefined || !frame.method) continue;
    log(frame);
    const handler = handlers[frame.method];
    if (!handler) {
      emit({ id: frame.id, error: { code: -32601, message: `method not found: ${frame.method}` } });
      continue;
    }
    const result = handler(frame.params ?? {});
    if (result && result.__error) {
      emit({ id: frame.id, error: result.__error });
    } else {
      emit({ id: frame.id, result: result ?? {} });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
// stay alive; the client kills the process group on dispose
setInterval(() => {}, 1 << 30);
