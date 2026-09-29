// Agent-bridge tests (Path 2): protocol client against a fake agent-server,
// legacy→v4 provider translation, and JobManager's agent engine end-to-end —
// including the load-bearing property: NATIVE cancel (session/stop) ends the
// turn while the HOST and SESSION stay alive for the next message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const FIXTURE = join(ROOT, "tests", "fixtures", "fake-agent-server.mjs");

// env must be in place BEFORE zcode.js reads it at module init
const home = mkdtempSync(join(tmpdir(), "zc-agent-test-"));
mkdirSync(join(home, "provider"), { recursive: true });
writeFileSync(join(home, "provider", "zcode-builtin.json"), "{}");
const scenarioFile = join(home, "scenario");
writeFileSync(scenarioFile, "plain");
process.env.ZCODE_HOME = home;
process.env.ZCODE_CLI_ENTRY = FIXTURE; // client spawns [node, FIXTURE, "agent-server"]
process.env.ZCODE_CLI_NODE = process.execPath;
process.env.ZCODE_BRIDGE_ENGINE = "agent";
process.env.ZCODE_JOB_TIMEOUT_MS = String(30_000);
process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(home, "provider", "zcode-builtin.json");
// the fake re-reads this file per turn, letting tests flip behavior mid-run
process.env.FAKE_SCENARIO_FILE = scenarioFile;

const { JobManager, config } = await import("../server/zcode.js");
const { translateLegacyProviders, resolveBuiltinProviderPath } = await import("../server/agent-host.mjs");
const { ProtocolClient } = await import("../server/protocol-client.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeoutMs = 10_000, what = "condition") => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${what}`);
};

function newManager() {
  return new JobManager();
}

async function disposeManager(mgr) {
  await mgr.agentHosts?.shutdownAll(1500);
}

// ---------------------------------------------------------------------------

test("default engine stays prompt when ZCODE_BRIDGE_ENGINE is unset", () => {
  const childEnv = { ...process.env };
  delete childEnv.ZCODE_BRIDGE_ENGINE;
  const out = execFileSync(process.execPath, [
    "--input-type=module", "-e",
    'const { config } = await import("./server/zcode.js"); process.stdout.write(config.bridgeEngine)',
  ], { cwd: ROOT, env: childEnv }).toString();
  assert.equal(out, "prompt");
});

test("translateLegacyProviders maps kinds, models, defaults, and reasoning", () => {
  const legacy = {
    model: { main: "builtin:mockprov/m1" },
    provider: {
      mockprov: {
        name: "Mock Prov",
        kind: "openai-compatible",
        options: { apiKey: "k", baseURL: "http://x/v1" },
        models: {
          m1: { name: "M1" },
          m2: { reasoning: { enabled: true, variants: ["low", "high"] } },
        },
      },
      weird: { kind: " exotic ", options: {} },
    },
  };
  const { doc, skipped } = translateLegacyProviders(legacy);
  assert.equal(doc.schemaVersion, 1);
  const rule = doc.config.providerConfigRules.providerRules[0];
  assert.equal(rule.providerId, "mockprov");
  assert.equal(rule.config.api.type, "openai-chat-completions");
  assert.equal(rule.config.api.baseUrl, "http://x/v1");
  assert.deepEqual(rule.config.personalModelIds, ["m1", "m2"]);
  assert.deepEqual(doc.config.modelConfigRules.providerModelRules, [
    { providerId: "mockprov", modelId: "m2", config: { optionSpecs: { reasoningLevel: { values: ["low", "high"], map: "{}" } } } },
  ]);
  assert.deepEqual(doc.config.defaultModelSelection, { providerId: "mockprov", modelId: "m1" });
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /weird/);
});

test("resolveBuiltinProviderPath honors the env override", () => {
  assert.equal(resolveBuiltinProviderPath("/nonexistent/cli.cjs"), join(home, "provider", "zcode-builtin.json"));
});

test("ProtocolClient correlates requests and routes notifications", async () => {
  const notifications = [];
  const client = new ProtocolClient({
    command: process.execPath,
    args: [FIXTURE, "agent-server"],
    cwd: ROOT,
    env: { ...process.env, FAKE_SCENARIO: "plain" },
    onNotification: (n) => notifications.push(n),
  });
  try {
    const caps = await client.request("runtime/capabilities", {});
    assert.equal(caps.protocol.name, "ZCode Protocol");
    const created = await client.request("session/create", { workspace: { workspacePath: "/tmp", workspaceKey: "/tmp" }, mode: "build" });
    assert.match(created.sessionId, /^sess_fake_\d+$/);
    // the fake never sends server requests; unknown methods error cleanly
    await assert.rejects(() => client.request("no/such-method", {}), /method not found/);
  } finally {
    await client.dispose(1500);
  }
});

test("agent engine: plain turn succeeds with the SSE line/done contract", async () => {
  writeFileSync(scenarioFile, "plain");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "hello", sessionId: null, cwd: ROOT, mode: "build", model: null });
    assert.equal(job.status, "running");
    const done = await waitFor(
      () => job.lines.find((l) => l.kind === "done"),
      15_000,
      "done event",
    );
    assert.equal(done.status, "succeeded");
    assert.equal(done.resultType, "success");
    assert.equal(job.lines[job.lines.length - 1].kind, "done", "done must be the last event");
    const types = job.lines.filter((l) => l.kind === "line").map((l) => l.line.type);
    assert.deepEqual(types, [
      "session.created",
      "session.titleUpdated",
      "turn.started",
      "session.updated",
      "model.streaming",
      "model.streaming",
      "model.streaming",
      "turn.completed",
    ]);
    assert.ok(job.sessionId, "job adopts the protocol sessionId");
    assert.equal(mgr.agentHosts.hosts.size, 1, "one host per cwd");
  } finally {
    await disposeManager(mgr);
  }
});

test("agent engine: NATIVE cancel ends the turn and the host+session survive", async () => {
  writeFileSync(scenarioFile, "hold");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "long task", sessionId: null, cwd: ROOT, mode: "build", model: null });
    await waitFor(() => job.lines.some((l) => l.line?.type === "turn.started"), 15_000, "turn.started");
    const host = job.agent.host;
    const hostPid = host.client.proc.pid;
    const sessionId = job.sessionId;

    assert.equal(mgr.cancel(job.id), true);
    assert.equal(job.status, "stopping");
    const done = await waitFor(() => job.lines.find((l) => l.kind === "done"), 10_000, "done after cancel");
    assert.equal(done.status, "cancelled");
    assert.equal(done.resultType, "cancelled");
    assert.equal(done.killSignal, null, "no process kill involved");
    const cancelledLine = job.lines.find((l) => l.line?.type === "turn.completed");
    assert.equal(cancelledLine.line.payload.resultType, "cancelled");

    // THE property the prompt engine cannot have: same host process, same
    // session, next message just works
    assert.equal(host.client.exited, false, "host survives cancel");
    writeFileSync(scenarioFile, "plain");
    const { job: job2 } = mgr.start({ text: "follow-up", sessionId, cwd: ROOT, mode: "build", model: null });
    const done2 = await waitFor(() => job2.lines.find((l) => l.kind === "done"), 15_000, "follow-up done");
    assert.equal(done2.status, "succeeded");
    assert.equal(job2.sessionId, sessionId, "follow-up resumes the same session");
    assert.equal(mgr.agentHosts.hosts.get(ROOT)?.client.proc.pid, hostPid, "still the same host process");
  } finally {
    await disposeManager(mgr);
  }
});

test("agent engine: turn failure surfaces as a failed job with the CLI's error", async () => {
  writeFileSync(scenarioFile, "fail");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "boom", sessionId: null, cwd: ROOT, mode: "build", model: null });
    const done = await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "done");
    assert.equal(done.status, "failed");
    assert.match(done.error, /fake model failure/);
  } finally {
    await disposeManager(mgr);
  }
});

test("agent engine: host crash fails active jobs and the next job respawns", async () => {
  writeFileSync(scenarioFile, "crash");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "crashy", sessionId: null, cwd: ROOT, mode: "build", model: null });
    const done = await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "done after crash");
    assert.equal(done.status, "failed");
    assert.match(done.error, /agent-server exited/);

    // registry clears the dead entry; the next start spawns a fresh host
    writeFileSync(scenarioFile, "plain");
    const { job: job2 } = mgr.start({ text: "after crash", sessionId: null, cwd: ROOT, mode: "build", model: null });
    const done2 = await waitFor(() => job2.lines.find((l) => l.kind === "done"), 15_000, "post-crash done");
    assert.equal(done2.status, "succeeded");
  } finally {
    await disposeManager(mgr);
  }
});

test("agent engine: resume path uses session/resume and model selection rides on send", async () => {
  writeFileSync(scenarioFile, "plain");
  const logFile = join(home, "frames.log");
  const mgr = new JobManager();
  // point this manager's hosts at a frame log via env inheritance: the fake
  // reads FAKE_LOG from its environment, which the host passes through
  process.env.FAKE_LOG = logFile;
  try {
    const { job } = mgr.start({ text: "first", sessionId: null, cwd: ROOT, mode: "build", model: "mockprov/m1" });
    const done = await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "first done");
    assert.equal(done.status, "succeeded");

    const { job: job2 } = mgr.start({ text: "second", sessionId: job.sessionId, cwd: ROOT, mode: "build", model: "mockprov/m1", reasoningLevel: "high" });
    await waitFor(() => job2.lines.find((l) => l.kind === "done"), 15_000, "second done");

    const frames = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const methods = frames.map((f) => f.method);
    assert.ok(methods.includes("session/resume"), "follow-up goes through session/resume");
    const send = frames.filter((f) => f.method === "session/send").pop();
    // an explicit user choice rides on the model selection (agent engine)
    assert.deepEqual(send.params.modelSelection, { providerId: "mockprov", modelId: "m1", options: { reasoningLevel: "high" } });
    // the workflow tool cluster is fail-closed: the host must opt in on BOTH
    // create and resume, or the model never sees the workflow tools
    const create = frames.find((f) => f.method === "session/create");
    assert.equal(create.params.dynamicWorkflowEnabled, true, "session/create carries dynamicWorkflowEnabled");
    const resume = frames.filter((f) => f.method === "session/resume").pop();
    assert.equal(resume.params.dynamicWorkflowEnabled, true, "session/resume carries dynamicWorkflowEnabled");
  } finally {
    delete process.env.FAKE_LOG;
    await disposeManager(mgr);
  }
});

test("agent engine: compact goes through strict resume + session/compact, busy sessions 409", async () => {
  writeFileSync(scenarioFile, "plain");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "first", sessionId: null, cwd: ROOT, mode: "build", model: null });
    await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "first done");
    const sessionId = job.sessionId;

    // compact after the turn: strict resume + the protocol call
    const r = await mgr.compactSession({ sessionId, cwd: ROOT, instructions: "keep decisions" });
    assert.equal(r.engine, "agent");
    assert.equal(r.result.compact.state, "accepted", "protocol compact is async fire-and-forget");

    // unknown session id must NOT silently create a fresh session
    await assert.rejects(
      () => mgr.compactSession({ sessionId: "sess_unknown_000000000000000000000000", cwd: ROOT }),
      /unknown session/,
    );
    assert.equal(mgr.agentHosts.hosts.get(ROOT).sessions.has("sess_unknown_000000000000000000000000"), false,
      "no phantom session created by a failed compact");

    // busy session is rejected before any protocol call
    writeFileSync(scenarioFile, "hold");
    const { job: held } = mgr.start({ text: "hold", sessionId, cwd: ROOT, mode: "build", model: null });
    await waitFor(() => held.lines.some((l) => l.line?.type === "turn.started"), 15_000, "held turn started");
    await assert.rejects(
      () => mgr.compactSession({ sessionId, cwd: ROOT }),
      (e) => e.status === 409 && e.code === "SESSION_BUSY",
    );
    mgr.cancel(held.id);
    await waitFor(() => held.lines.find((l) => l.kind === "done"), 10_000, "held settled");
  } finally {
    await disposeManager(mgr);
  }
});

test("agent engine: fork goes through strict resume + session/fork with message target, busy and CLI-side guards", async () => {
  writeFileSync(scenarioFile, "plain");
  const logFile = join(home, "fork-frames.log");
  process.env.FAKE_LOG = logFile;
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "first", sessionId: null, cwd: ROOT, mode: "build", model: null });
    await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "first done");
    const sessionId = job.sessionId;

    // fork at a message boundary: strict resume + the protocol call, and the
    // message target rides on the frame verbatim
    const r = await mgr.forkSession({ sessionId, cwd: ROOT, messageId: "msg_boundary_1" });
    assert.equal(r.engine, "agent");
    assert.ok(r.result.forkedSessionId, "fork reports the child session id");
    assert.equal(r.result.parentSessionId, sessionId);
    const forkFrame = readFileSync(logFile, "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l)).filter((f) => f.method === "session/fork").pop();
    assert.deepEqual(forkFrame.params, { sessionId, target: { kind: "message", messageId: "msg_boundary_1" } });

    // the CLI's own active-turn guard maps to the same busy verdict even when
    // OUR job table never saw the run — a raw session/send (hold scenario)
    // through the host's client leaves the turn active only inside the fake
    writeFileSync(scenarioFile, "hold");
    const host = mgr.agentHosts.hosts.get(ROOT);
    await host.client.request("session/send", { sessionId, content: "held elsewhere" });
    await assert.rejects(
      () => mgr.forkSession({ sessionId, cwd: ROOT }),
      (e) => e.status === 409 && e.code === "SESSION_BUSY" && /cannot fork/i.test(e.message),
    );
    await host.client.request("session/stop", { sessionId });
    writeFileSync(scenarioFile, "plain");

    // unknown session id must NOT silently create a fresh session
    await assert.rejects(
      () => mgr.forkSession({ sessionId: "sess_unknown_000000000000000000000000", cwd: ROOT }),
      /unknown session/,
    );
    assert.equal(mgr.agentHosts.hosts.get(ROOT).sessions.has("sess_unknown_000000000000000000000000"), false,
      "no phantom session created by a failed fork");

    // the forked session is resumable through the same host (follow-up chat)
    const { job: follow } = mgr.start({ text: "in the fork", sessionId: r.result.forkedSessionId, cwd: ROOT, mode: "build", model: null });
    const done = await waitFor(() => follow.lines.find((l) => l.kind === "done"), 15_000, "fork follow-up done");
    assert.equal(done.status, "succeeded");
  } finally {
    delete process.env.FAKE_LOG;
    await disposeManager(mgr);
  }
});

test("agent engine: workflow artifact read faces (runs, artifacts, data, chunked content)", async () => {
  writeFileSync(scenarioFile, "plain");
  const mgr = newManager();
  try {
    const { job } = mgr.start({ text: "first", sessionId: null, cwd: ROOT, mode: "build", model: null });
    await waitFor(() => job.lines.find((l) => l.kind === "done"), 15_000, "first done");
    const sessionId = job.sessionId;

    // runs list from the journal read face
    const runs = await mgr.workflowRuns({ sessionId, cwd: ROOT });
    assert.equal(runs.engine, "agent");
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].status, "completed");
    const runId = runs.runs[0].runId;

    // artifacts: primary markdown (2 versions) + table with spec
    const arts = await mgr.workflowRunArtifacts({ sessionId, cwd: ROOT, runId });
    assert.equal(arts.artifacts.length, 2);
    const md = arts.artifacts.find((a) => a.id === "summary");
    const table = arts.artifacts.find((a) => a.id === "latency");
    assert.equal(md.primary, true);
    assert.equal(md.versions.length, 2);
    assert.deepEqual(table.spec.columns.map((c) => c.field), ["step", "ms"]);

    // board report items (key-dedup happens client-side; raw items here)
    const data = await mgr.workflowArtifactData({ sessionId, cwd: ROOT, runId, artifactId: "latency" });
    assert.equal(data.items.length, 3);
    assert.deepEqual(data.items[0].item, { step: "fetch", ms: 120 });

    // content bytes assembled across chunks (force 2 chunks with tiny limits
    // via direct host call at 16-byte chunks)
    const host = mgr.agentHosts.hosts.get(ROOT);
    const full = await host.readWorkflowArtifact(sessionId, runId, "summary", 2);
    assert.equal(full.data.toString("utf8"), `# Fixture deliverable\n\nversion 2 for ${sessionId}`);
    assert.equal(full.mediaType, "text/markdown");
    // and the manager-level wrapper returns the same
    const viaMgr = await mgr.readWorkflowArtifact({ sessionId, cwd: ROOT, runId, artifactId: "summary", version: 2 });
    assert.equal(viaMgr.data.length, full.data.length);

    // reads never create phantom sessions
    await assert.rejects(
      () => mgr.workflowRuns({ sessionId: "sess_unknown_000000000000000000000000", cwd: ROOT }),
      /unknown session/,
    );

    // a missing artifact version maps the CLI's journal fault to 404, not 500
    await assert.rejects(
      () => mgr.readWorkflowArtifact({ sessionId, cwd: ROOT, runId, artifactId: "nope", version: 1 }),
      (e) => e.status === 404 && e.code === "ARTIFACT_NOT_FOUND" && /fault\.workflowRunArtifactRead\.notFound/.test(e.message),
    );

    // prompt-engine managers refuse with 501 (no agent hosts)
    const promptMgr = new JobManager();
    // JobManager reads the engine at construction; simulate by deleting hosts
    promptMgr.agentHosts = null;
    await assert.rejects(
      () => promptMgr.workflowRuns({ sessionId, cwd: ROOT }),
      (e) => e.status === 501 && e.code === "ENGINE_UNSUPPORTED",
    );
  } finally {
    await disposeManager(mgr);
  }
});
