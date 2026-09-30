#!/usr/bin/env node
// Fake ZCode Protocol agent-server for tests. Implements the subset the
// zcode-web agent bridge speaks (see server/protocol-client.mjs and
// server/agent-host.mjs):
//   runtime/capabilities, session/create, session/resume, session/setMode,
//   session/send, session/stop, session/compact, session/fork, session/close
//   v4/conversation/workflowRuns|workflowRunArtifacts|workflowRunArtifactData|Read
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
// id -> toolName, for server-initiated requests awaiting answers
const permAnswerIds = new Map();
let pendingPermCounter = 0;
// frameId -> { sessionId, toolName }: emitted permission requests whose
// answers the current turn is waiting on
const pendingPermAnswers = new Map();
const bashPermOpts = {
  risk: "high",
  input: { command: "npm test", args: ["--quiet"] },
  options: [
    { optionId: "allowOnce", kind: "allow", name: "Allow once", description: "run this one command", response: { decision: "allow", reason: "approved once" } },
    { optionId: "allowAlways", kind: "allow_always", name: "Always allow", response: { decision: "allow", permissionUpdates: [{ type: "addRules", behavior: "allow", rules: [{ toolName: "Bash" }] }] } },
    { optionId: "rejectOnce", kind: "deny", name: "Deny", response: { decision: "deny", reason: "denied by user" } },
  ],
};

/** Complete an awaitPerms turn once its last permission answer landed; the
 *  final decision is embedded in the response for end-to-end asserts. */
const finishPermTurn = (sessionId) => {
  const s = sessions.get(sessionId);
  if (!s || !s.turnActive || !s.awaitPerms) return;
  s.turnActive = false;
  sessionEvent(sessionId, "model.streaming", { assistantMessageId: "m1", delta: "", done: true, kind: "finish" });
  sessionEvent(sessionId, "turn.completed", { response: `perm:${s.lastPermDecision}`, usage: { totalTokens: 10 }, toolCallCount: 0, resultType: "success" });
};

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
  s.lastContent = String(content);
  s.awaitPerms = false;
  // permission round-trip probe: a send whose content asks for "wf-confirm"
  // makes the fake escalate the workflow run confirmations (plus one foreign
  // tool) as server-initiated requests in the REAL wire shape (toolName, not
  // the internal kind); "perm-hold" escalates a single Bash call with the
  // full option list. Like the real broker, the turn now WAITS for every
  // emitted request to be answered — the host's answers come back as
  // ordinary response frames and are logged as __permAnswer pseudo-frames;
  // the LAST decision is embedded in the turn response so tests can assert
  // end-to-end propagation.
  const emitPerm = (toolName, opts = {}) => {
    const id = 9000 + pendingPermCounter;
    emit({
      id,
      method: "interaction/requestPermission",
      params: {
        requestId: `perm_${id}`,
        sessionId,
        turnId: `turn_${id}`,
        toolCallId: `call_${id}`,
        toolName,
        reason: `probe:${toolName}`,
        riskLevel: opts.risk || "low",
        input: opts.input || {},
        options: opts.options || [],
      },
    });
    permAnswerIds.set(id, { sessionId, toolName });
    pendingPermAnswers.set(id, { sessionId, toolName });
    pendingPermCounter += 1;
  };
  if (/wf-confirm/.test(String(content))) {
    for (const toolName of ["CreateWorkflow", "AmendWorkflow", "ResumeWorkflowRun", "Bash"]) {
      emitPerm(toolName, toolName === "Bash" ? bashPermOpts : {});
    }
    s.awaitPerms = true;
  } else if (/perm-hold/.test(String(content))) {
    emitPerm("Bash", bashPermOpts);
    s.awaitPerms = true;
  }
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
    if (s.awaitPerms) return; // the answer path finishes this turn
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
  "session/compact": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    const s = sessions.get(params.sessionId);
    if (s.turnActive) {
      return { __error: { code: -32030, message: "Cannot compact while a prompt is running" } };
    }
    return {
      response: params.instructions ? `compacted with: ${params.instructions}` : "compacted",
      snapshot: { protocol: { name: "ZCode Protocol", version: 1 } },
      compact: { state: "accepted" },
    };
  },
  "session/fork": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    const s = sessions.get(params.sessionId);
    if (s.turnActive) {
      return { __error: { code: -32030, message: "Cannot fork while a prompt is running" } };
    }
    const forkedSessionId = `sess_fake_fork_${++sessionCounter}`;
    sessions.set(forkedSessionId, { turnActive: false, mode: s.mode });
    return {
      forkedSessionId,
      parentSessionId: params.sessionId,
      ...(params.target?.messageId ? { targetMessageId: params.target.messageId } : {}),
      response: "session forked",
      snapshot: { protocol: { name: "ZCode Protocol", version: 1 } },
    };
  },
  "session/close": (params) => {
    sessions.delete(params.sessionId);
    return { closed: true };
  },
  // v4 conversation read faces for workflow artifacts (journal-backed).
  // Deterministic fixture: ONE completed run per session with two artifacts —
  // a primary markdown file (2 versions) and a latency table fed by reports.
  "v4/conversation/workflowRuns": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    return {
      runs: [{
        runId: `dwf_${params.sessionId}`,
        label: "fixture run",
        updatedAt: Date.now(),
        status: "completed",
        resumable: false,
      }],
    };
  },
  "v4/conversation/workflowRunArtifacts": (params) => {
    if (!sessions.has(params.sessionId)) {
      return { __error: { code: -32001, message: `unknown session ${params.sessionId}` } };
    }
    const markdownBytes = Buffer.from(`# Fixture deliverable\n\nversion 2 for ${params.sessionId}`).length;
    return {
      artifacts: [
        {
          id: "summary",
          kind: "markdown",
          title: "Summary document",
          version: 2,
          versions: [
            { version: 1, bytes: 30, publishedAt: 1 },
            { version: 2, bytes: markdownBytes, publishedAt: 2, primary: true },
          ],
          itemCount: 0,
          primary: true,
        },
        {
          id: "latency",
          kind: "table",
          title: "Latency by step",
          version: 1,
          versions: [{ version: 1, publishedAt: 3 }],
          spec: { columns: [{ field: "step", label: "Step" }, { field: "ms", label: "Latency", unit: "ms" }], key: "step" },
          itemCount: 3,
        },
      ],
    };
  },
  "v4/conversation/workflowRunArtifactData": (params) => {
    const items = [
      { sequence: 1, siteId: "report#1", ordinal: 0, item: { step: "fetch", ms: 120 } },
      { sequence: 2, siteId: "report#2", ordinal: 1, item: { step: "parse", ms: 45 } },
      { sequence: 3, siteId: "report#3", ordinal: 2, item: { step: "fetch", ms: 98 } },
    ];
    const after = typeof params.afterSequence === "number" ? params.afterSequence : -1;
    const page = items.filter((i) => i.sequence > after);
    return { items: page, hasMore: false };
  },
  "v4/conversation/workflowRunArtifactRead": (params) => {
    if (params.artifactId !== "summary") {
      // the real CLI's structured journal fault (verified live in prod)
      return { __error: { code: -32603, message: `fault.workflowRunArtifactRead.notFound: ${params.runId}/${params.artifactId}@${params.version}` } };
    }
    const body = params.version >= 2
      ? `# Fixture deliverable\n\nversion ${params.version} for ${params.sessionId}`
      : "version 1 body";
    const buf = Buffer.from(body, "utf8");
    const offset = params.offset || 0;
    const end = Math.min(offset + (params.limit || buf.length), buf.length);
    const slice = buf.subarray(offset, end);
    return {
      dataBase64: slice.toString("base64"),
      mediaType: "text/markdown",
      totalBytes: buf.length,
      nextOffset: end < buf.length ? end : null,
    };
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
    // response frames (no method) carry the host's answers to our
    // server-initiated permission requests — log them as pseudo-frames, and
    // when the awaiting turn's LAST pending request is answered, finish it
    if (frame.id === undefined || !frame.method) {
      if (frame.id !== undefined && permAnswerIds.has(frame.id) && frame.result) {
        const target = permAnswerIds.get(frame.id);
        permAnswerIds.delete(frame.id);
        log({ method: "__permAnswer", params: { toolName: target.toolName, ...frame.result } });
        const pending = pendingPermAnswers.get(frame.id);
        pendingPermAnswers.delete(frame.id);
        if (pending) {
          const s = sessions.get(pending.sessionId);
          if (s) {
            s.lastPermDecision = String(frame.result?.decision || "deny");
            if ([...pendingPermAnswers.values()].every((p) => p.sessionId !== pending.sessionId)) {
              finishPermTurn(pending.sessionId);
            }
          }
        }
      }
      continue;
    }
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
