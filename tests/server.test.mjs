// ZWUI-023: backend + security regression tests against the real server
// (server/index.js) with the fake CLI. No network, no model, no real DB
// writes — the server runs on a synthetic workspace.

import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-token-123";
const SERVER_ROOT = new URL("..", import.meta.url).pathname;

let server;
let ws;

function startServer(extraEnv = {}) {
  ws = mkdtempSync(join(tmpdir(), "zc-test-"));
  mkdirSync(join(ws, "proj"), { recursive: true });
  // isolated ZCODE_HOME => the sessions DB genuinely does not exist, which is
  // what ZWUI-018's DB_MISSING case asserts
  const fakeHome = mkdtempSync(join(tmpdir(), "zc-home-"));
  server = spawn(process.execPath, [join(SERVER_ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      ZCODE_WEB_TOKEN: TOKEN,
      ZCODE_CLI_ENTRY: join(SERVER_ROOT, "scripts", "fake-cli.mjs"),
      ZCODE_WORKSPACE_ROOT: ws,
      ZCODE_HOME: fakeHome,
      ZCODE_JOB_TIMEOUT_MS: "15000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (c) => process.stderr.write(c));
  // wait for listen
  return new Promise((resolve) => {
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
        if (r.ok) {
          clearInterval(t);
          resolve();
        }
      } catch {}
    }, 100);
  });
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function chat(body, headers = {}) {
  return fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { ...auth, ...headers },
    body: JSON.stringify({ cwd: join(ws, "proj"), mode: "plan", ...body }),
  });
}

async function collectSse(jobId, { lastEventId, ms = 4000, ticket } = {}) {
  let url = `${BASE}/api/events/${jobId}`;
  const q = [];
  if (lastEventId) q.push(`lastEventId=${lastEventId}`);
  if (ticket) q.push(`ticket=${ticket}`);
  if (q.length) url += `?${q.join("&")}`;
  const r = await fetch(url, {
    headers: lastEventId ? { authorization: `Bearer ${TOKEN}`, "last-event-id": String(lastEventId) } : { authorization: `Bearer ${TOKEN}` },
  });
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  const ids = [];
  let buf = "";
  const deadline = Date.now() + ms;
  let currentId = null;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((res) => setTimeout(() => res({ done: true }), deadline - Date.now())),
    ]);
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith("id: ")) currentId = Number(line.slice(4));
      if (line.startsWith("data: ")) {
        const ev = JSON.parse(line.slice(6));
        if (ev.id) ids.push(ev.id);
        events.push(ev);
        if (ev.kind === "done") return { events, ids, res: r };
      }
    }
  }
  return { events, ids, res: r };
}

before(async () => {
  await startServer();
});

after(() => {
  server?.kill();
});

describe("auth", () => {
  it("401s without a bearer token", async () => {
    const r = await fetch(`${BASE}/api/config`);
    assert.equal(r.status, 401);
  });
  it("rejects a wrong token", async () => {
    const r = await fetch(`${BASE}/api/config`, { headers: { authorization: "Bearer nope" } });
    assert.equal(r.status, 401);
  });
  it("SSE rejects the legacy ?token= mechanism", async () => {
    const r = await fetch(`${BASE}/api/events/00000000-0000-0000-0000-000000000000?token=${TOKEN}`);
    assert.equal(r.status, 401);
  });
});

describe("T04 safe content path", () => {
  it("serves the SPA shell on deep links", async () => {
    const r = await fetch(`${BASE}/w/demo`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('<div id="root">'));
  });
  it("blocks path traversal on uploaded media", async () => {
    const r = await fetch(`${BASE}/api/uploads/..%2F..%2Fserver%2Findex.js`, { headers: auth });
    assert.equal(r.status, 404);
  });
  it("rejects malformed base64 uploads", async () => {
    const r = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "x.png", data: "!!!not-base64###" }),
    });
    assert.equal(r.status, 400);
  });
  it("rejects attachment paths outside the uploads dir", async () => {
    const r = await chat({ text: "x", attachments: ["/etc/passwd"] });
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.match(j.error, /uploaded via \/api\/upload/);
  });
});

describe("ZWUI-007 job status + idempotent submission", () => {
  it("same X-Request-Id returns the same job (replayed:true)", async () => {
    const r1 = await chat({ text: "idem" }, { "x-request-id": "req-1" });
    assert.equal(r1.status, 202);
    const j1 = await r1.json();
    const r2 = await chat({ text: "idem" }, { "x-request-id": "req-1" });
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.equal(j1.jobId, j2.jobId);
    assert.equal(j2.replayed, true);
  });

  it("GET /api/jobs/:id exposes the immutable status machine", async () => {
    const r = await chat({ text: "status" });
    const { jobId } = await r.json();
    const s = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: auth });
    const j = await s.json();
    assert.equal(j.jobId, jobId);
    assert.ok(["queued", "running", "succeeded", "failed", "cancelled", "timeout"].includes(j.status));
    assert.equal(typeof j.createdAt, "number");
    // terminal snapshot is stable across polls
    await new Promise((res) => setTimeout(res, 1500));
    const s2 = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: auth });
    const j2 = await s2.json();
    assert.equal(j2.status, "succeeded");
  });
});

describe("ZWUI-008 SSE v2", () => {
  it("streams the fake CLI run to completion with numbered events", async () => {
    const r = await chat({ text: "hello stream" });
    const { jobId } = await r.json();
    const { events, ids } = await collectSse(jobId);
    assert.ok(ids.length >= 5, "expected several numbered events");
    assert.deepEqual(ids, ids.slice().sort((a, b) => a - b).filter((v, i, a) => a.indexOf(v) === i));
    const done = events.find((e) => e.kind === "done");
    assert.ok(done, "stream ends with done");
    assert.equal(done.exitCode, 0);
    const line = events.find((e) => e.kind === "line" && e.line?.type === "turn.completed");
    assert.match(line.line.payload.response, /echo:hello stream/);
  });

  it("replays from Last-Event-ID without duplicating events", async () => {
    const r = await chat({ text: "replay me" });
    const { jobId } = await r.json();
    await collectSse(jobId, { ms: 3000 });
    const { events, ids } = await collectSse(jobId, { lastEventId: 2, ms: 3000 });
    assert.ok(ids.every((id) => id > 2), "replay starts after the cursor");
    assert.ok(events.some((e) => e.kind === "done"), "done re-delivered on terminal stream");
  });

  it("issues job-scoped tickets; tickets authenticate SSE without bearer", async () => {
    const r = await chat({ text: "ticket" });
    const { jobId } = await r.json();
    const tr = await fetch(`${BASE}/api/sse-ticket`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ jobId }),
    });
    const { ticket } = await tr.json();
    const noAuth = await fetch(`${BASE}/api/events/${jobId}?ticket=${ticket}`);
    assert.equal(noAuth.status, 200);
    const wrong = await fetch(`${BASE}/api/events/${jobId}?ticket=deadbeef`);
    assert.equal(wrong.status, 401);
  });
});

describe("ZWUI-018 history error surfacing", () => {
  it("503 DB_MISSING when the database does not exist", async () => {
    const r = await fetch(`${BASE}/api/sessions?cwd=${encodeURIComponent(join(ws, "proj"))}`, { headers: auth });
    assert.equal(r.status, 503);
    const j = await r.json();
    assert.equal(j.code, "DB_MISSING");
  });
});

describe("FAKE_MODE=fail run", () => {
  it("streams turn.failed and the job terminates failed", async () => {
    // a second server with the failing fake CLI (isolated port + home)
    const PORT2 = PORT + 1;
    const ws2 = mkdtempSync(join(tmpdir(), "zc-fail-"));
    const failing = spawn(process.execPath, [join(SERVER_ROOT, "server", "index.js")], {
      env: {
        ...process.env,
        PORT: String(PORT2),
        HOST: "127.0.0.1",
        ZCODE_WEB_TOKEN: TOKEN,
        ZCODE_CLI_ENTRY: join(SERVER_ROOT, "scripts", "fake-cli.mjs"),
        FAKE_MODE: "fail",
        ZCODE_WORKSPACE_ROOT: ws2,
        ZCODE_HOME: mkdtempSync(join(tmpdir(), "zc-home-")),
      },
      stdio: "ignore",
    });
    try {
      const base2 = `http://127.0.0.1:${PORT2}`;
      await new Promise((resolve, reject) => {
        const t = setInterval(async () => {
          try {
            const r = await fetch(`${base2}/api/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
            if (r.ok) { clearInterval(t); resolve(); }
          } catch {}
        }, 100);
        setTimeout(() => reject(new Error("server2 boot timeout")), 8000);
      });
      const r = await fetch(`${base2}/api/chat`, {
        method: "POST",
        headers: { ...auth },
        body: JSON.stringify({ text: "doomed", cwd: ws2, mode: "plan" }),
      });
      const { jobId } = await r.json();
      const events = [];
      const res = await fetch(`${base2}/api/events/${jobId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise((res2) => setTimeout(() => res2({ done: true }), deadline - Date.now())),
        ]);
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.startsWith("data: ")) {
            const ev = JSON.parse(line.slice(6));
            events.push(ev);
            if (ev.kind === "done") {
              assert.notEqual(ev.exitCode, 0);
              assert.ok(events.some((e) => e.kind === "line" && e.line?.type === "turn.failed"));
              failing.kill();
              return;
            }
          }
        }
      }
      assert.fail("did not reach done");
    } finally {
      failing.kill();
    }
  });
});

// ZWUI-018 regression: the transcript part-window must keep the NEWEST parts
// (hourly-automation sessions exceed 2000 parts; the old ascending LIMIT
// silently hid the latest turns — the ones the desktop shows), and reasoning
// parts must never bleed into the rendered answer.
describe("SessionStore.transcript newest-parts window", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  it("returns the newest turns of a session past 2000 parts and excludes reasoning", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_t", "t", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    db.exec("BEGIN");
    const N = 800; // 800 messages × 3 parts = 2400 parts > the old 2000 cutoff
    for (let i = 0; i < N; i++) {
      const mid = `msg_${i}`;
      insMsg.run(mid, "sess_t", JSON.stringify({ role: "assistant" }), i);
      insPart.run(`p_${i}_a`, mid, "sess_t", JSON.stringify({ type: "step-start" }), 0);
      insPart.run(`p_${i}_t`, mid, "sess_t", JSON.stringify({ type: "text", text: `turn-${i} body` }), 1);
      insPart.run(`p_${i}_r`, mid, "sess_t", JSON.stringify({ type: "reasoning", text: `secret-reasoning-${i}` }), 2);
    }
    // the newest message carries the gate table exactly like the desktop shows
    const last = `msg_${N}`;
    insMsg.run(last, "sess_t", JSON.stringify({ role: "assistant" }), N);
    insPart.run(`p_${N}_t`, last, "sess_t", JSON.stringify({
      type: "text",
      text: "| Gate | Status |\n| --- | --- |\n| Full verify gate | Green in CI |",
    }), 0);
    insPart.run(`p_${N}_r`, last, "sess_t", JSON.stringify({ type: "reasoning", text: "secret-reasoning-final" }), 1);
    db.exec("COMMIT");
    db.close();

    const store = new SessionStore(dbPath);
    const page = store.transcript("sess_t", { limit: 5, offset: 0 });
    const newest = page.turns[page.turns.length - 1];
    assert.ok(newest.text.includes("| Gate | Status |"), "newest turn (past the old 2000-part cutoff) must be present");
    assert.ok(newest.text.includes("Full verify gate"), "table body preserved verbatim");
    assert.ok(!page.turns.some((t) => t.text.includes("secret-reasoning")), "reasoning parts must not bleed into answers");
    assert.ok(page.total >= N, `expected >= ${N} turns, got ${page.total}`);
    // pagination from newest still works
    const older = store.transcript("sess_t", { limit: 5, offset: 5 });
    assert.notEqual(older.turns[older.turns.length - 1].text, newest.text);
  });
});

// Search-dialog empty state: recent() merges across all allowed roots.
describe("SessionStore.recent across roots", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  it("returns latest sessions across roots, newest first, bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store2-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
    `);
    const ins = db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)");
    ins.run("sess_a1", "root A newest", "/home/x/Workspace/a", 1, 500);
    ins.run("sess_a2", "root A older", "/home/x/Workspace/a", 1, 100);
    ins.run("sess_b1", "root B newest", "/home/x/.zcode/workspace/b", 1, 900);
    ins.run("sess_subagent_agent_1234", "subagent noise", "/home/x/Workspace/a", 1, 999);
    db.close();

    const store = new SessionStore(dbPath);
    const rows = store.recent(["/home/x/Workspace", "/home/x/.zcode/workspace"], 50);
    assert.equal(rows.length, 3, "subagent sessions excluded");
    assert.equal(rows[0].id, "sess_b1", "globally newest first");
    assert.equal(rows[1].id, "sess_a1");
    assert.equal(rows[2].id, "sess_a2");
    const capped = store.recent(["/home/x/Workspace", "/home/x/.zcode/workspace"], 1);
    assert.equal(capped.length, 1);
    assert.equal(capped[0].id, "sess_b1");
  });
});
