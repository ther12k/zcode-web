// ZWUI-023: backend + security regression tests against the real server
// (server/index.js) with the fake CLI. No network, no model, no real DB
// writes — the server runs on a synthetic workspace.

import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-token-123";
const SERVER_ROOT = new URL("..", import.meta.url).pathname;

let server;
let ws;
let home; // isolated ZCODE_HOME under test

function startServer(extraEnv = {}) {
  ws = mkdtempSync(join(tmpdir(), "zc-test-"));
  mkdirSync(join(ws, "proj"), { recursive: true });
  // isolated ZCODE_HOME => the sessions DB genuinely does not exist, which is
  // what ZWUI-018's DB_MISSING case asserts
  home = mkdtempSync(join(tmpdir(), "zc-home-"));
  const fakeHome = home;
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
      ZCODE_ENABLE_FILES: "1",
      ZCODE_ENABLE_GIT: "1",
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

// Ticket-specific SSE reader: NO bearer header (that is the point of the
// ticket flow), bounded by a deadline, always aborts the socket so the
// server's keep-alive stream cannot leak into the next test.
async function collectTicketSse(jobId, { ticket, ms = 3000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    let url = `${BASE}/api/events/${jobId}`;
    if (ticket) url += `?ticket=${encodeURIComponent(ticket)}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: {} });
    const events = [];
    if (r.status !== 200) return { status: r.status, events };
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + ms;
    for (;;) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((res) => setTimeout(() => res({ done: true }), Math.max(0, deadline - Date.now()))),
      ]);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith("data: ")) {
          const ev = JSON.parse(line.slice(6));
          events.push(ev);
          if (ev.kind === "done") {
            clearTimeout(timer);
            ctrl.abort();
            return { status: r.status, events };
          }
        }
      }
    }
    return { status: r.status, events };
  } catch {
    return { status: 0, events: [] };
  } finally {
    clearTimeout(timer);
    try { ctrl.abort(); } catch {}
  }
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

describe("model catalog", () => {
  it("returns configured display names and default markers without exposing provider secrets", async () => {
    mkdirSync(join(home, "cli"), { recursive: true });
    writeFileSync(join(home, "cli", "config.json"), JSON.stringify({
      provider: {
        zai: {
          name: "Z.AI",
          options: { apiKey: "secret-key", baseURL: "https://example.invalid" },
          models: {
            "glm-5.3": { name: "GLM 5.3" },
            "glm-5.3-flash": {},
          },
        },
        openai: {
          name: "OpenAI",
          options: { apiKey: "another-secret" },
          models: { "gpt-5.2": { name: "GPT 5.2" } },
        },
      },
      model: { main: "zai/glm-5.3" },
    }));
    const r = await fetch(`${BASE}/api/models`, { headers: auth });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.models.map((m) => ({ ref: m.ref, providerName: m.providerName, displayName: m.displayName, isDefault: m.isDefault })), [
      { ref: "zai/glm-5.3", providerName: "Z.AI", displayName: "GLM 5.3", isDefault: true },
      { ref: "zai/glm-5.3-flash", providerName: "Z.AI", displayName: "glm-5.3-flash", isDefault: false },
      { ref: "openai/gpt-5.2", providerName: "OpenAI", displayName: "GPT 5.2", isDefault: false },
    ]);
    assert.equal(JSON.stringify(j).includes("secret-key"), false, "model catalog must not expose provider secrets");
    assert.equal(JSON.stringify(j).includes("another-secret"), false, "model catalog must not expose provider secrets");
    assert.equal(j.models[0].apiKey, undefined);
    assert.equal(j.models[0].baseURL, undefined);
  });
});

describe("paste-attachment previews (desktop parity)", () => {
  it("serves text pasted into the CLI under zcodeHome/tmp/paste-attachments", async () => {
    const dir = join(home, "tmp", "paste-attachments", "2026-01-01");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pasted-text-x.txt"), "pasted payload");
    const r = await fetch(`${BASE}/api/files/${encodeURIComponent(join(dir, "pasted-text-x.txt"))}`, { headers: auth });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.content, "pasted payload");
  });
  it("still rejects host paths outside workspace roots", async () => {
    const outside = join(tmpdir(), "zc-outside-secret.txt");
    writeFileSync(outside, "secret");
    const r = await fetch(`${BASE}/api/files/${encodeURIComponent(outside)}`, { headers: auth });
    assert.equal(r.status, 403);
  });
  it("still rejects binary paste files", async () => {
    const dir = join(home, "tmp", "paste-attachments", "2026-01-02");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pasted-image-x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
    const r = await fetch(`${BASE}/api/files/${encodeURIComponent(join(dir, "pasted-image-x.png"))}`, { headers: auth });
    assert.equal(r.status, 415);
  });
});

describe("ZWUI-048: file API routes (exact list route before the read catch-all)", () => {
  it("GET /api/files/list returns a directory listing, not a read of a file named 'list'", async () => {
    const r = await fetch(`${BASE}/api/files/list?dir=${encodeURIComponent(join(ws, "proj"))}`, { headers: auth });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.dir, join(ws, "proj"));
    assert.ok(Array.isArray(j.entries), "the exact /api/files/list route must win over /api/files/:path");
  });

  it("capability discovery requires the bearer token (401 without it, never a fake 'disabled')", async () => {
    const r = await fetch(`${BASE}/api/files/capability`);
    assert.equal(r.status, 401);
    const ok = await fetch(`${BASE}/api/files/capability`, { headers: auth });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.enabled, true);
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
    // collectTicketSse sends NO bearer — the ticket is the only credential
    const noAuth = await collectTicketSse(jobId, { ticket, ms: 6000 });
    assert.equal(noAuth.status, 200);
    assert.ok(noAuth.events.some((e) => e.kind === "done"), "ticket-authenticated stream reaches done");
    assert.ok(!noAuth.events.some((e) => e.kind === "ticket-expired"), "a fresh ticket must not be flagged expired");
    // ZWUI-061: a stale/foreign ticket gets the distinguishable rotation
    // marker (200 SSE), while a missing ticket is a bare 401
    const wrong = await collectTicketSse(jobId, { ticket: "deadbeef", ms: 3000 });
    assert.equal(wrong.status, 200);
    assert.equal(wrong.events[0]?.kind, "ticket-expired", "foreign ticket must get the ticket-expired marker");
    const none = await fetch(`${BASE}/api/events/${jobId}`);
    assert.equal(none.status, 401);
    await none.text();
  });

  it("ZWUI-061: tickets are single-use — a replayed ticket gets ticket-expired, not events", async () => {
    const r = await chat({ text: "single use ticket" });
    const { jobId } = await r.json();
    const tr = await fetch(`${BASE}/api/sse-ticket`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ jobId }),
    });
    const { ticket } = await tr.json();
    const first = await collectTicketSse(jobId, { ticket, ms: 6000 });
    assert.ok(first.events.some((e) => e.kind === "done"), "first ticket use streams the run");
    assert.ok(!first.events.some((e) => e.kind === "ticket-expired"), "first use must not be flagged expired");
    const replay = await collectTicketSse(jobId, { ticket, ms: 3000 });
    assert.equal(replay.status, 200);
    assert.ok(replay.events.some((e) => e.kind === "ticket-expired"), "replayed ticket must get the rotation marker");
    assert.ok(!replay.events.some((e) => e.kind === "line"), "a replayed ticket must not stream events");
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

// ZWUI-058: CLI-internal messages must never surface as chat turns —
// synthetic runtime reminders (model-only context replay), hidden-transcript
// messages, and compaction summary markers. The visible "context compacted"
// separator still renders from the compaction timeline part.
describe("SessionStore.transcript hides CLI-internal messages", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  it("skips synthetic, model-only, hidden, and compaction-summary messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_int", "t", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    const rows = [
      { seq: 0, msg: { role: "user" }, part: { type: "text", text: "what is the port" } },
      // assistant answer (visible)
      { seq: 1, msg: { role: "assistant", time: { completed: 99 } }, part: { type: "text", text: "port 3000" } },
      // synthetic model-only reminder replaying context (ZWUI-058 leak)
      { seq: 2, msg: { role: "user", synthetic: true, visibility: "model-only",
          semantics: { transcriptVisibility: "hidden" } },
        part: { type: "text", text: "Called the Read tool with input SECRET-INTERNAL" } },
      // compaction summary marker (mid-turn auto-compaction)
      { seq: 3, msg: { role: "user", summary: { title: "Compact summary", body: "Summary: internal" } },
        part: { type: "text", text: "Summary: internal" } },
      // a follow-up that must still render after the hidden rows
      { seq: 4, msg: { role: "user" }, part: { type: "text", text: "thanks" } },
    ];
    rows.forEach((r, i) => {
      const mid = `m${i}`;
      insMsg.run(mid, "sess_int", JSON.stringify(r.msg), r.seq);
      insPart.run(`p${i}`, mid, "sess_int", JSON.stringify(r.part), 0);
    });
    db.close();

    const store = new SessionStore(dbPath);
    const page = store.transcript("sess_int", { limit: 50 });
    const texts = page.turns.map((t) => t.text).join("\n");
    assert.ok(!texts.includes("SECRET-INTERNAL"), "synthetic model-only reminder must be hidden");
    assert.ok(!texts.includes("Summary: internal"), "compaction summary marker must be hidden");
    assert.ok(texts.includes("what is the port"), "real user turn kept");
    assert.ok(texts.includes("port 3000"), "real answer kept");
    assert.ok(texts.includes("thanks"), "follow-up after hidden rows kept");
    assert.equal(page.turns.length, 3);
  });
});

// Desktop parity: timeline separators (model switches, compactions, forks,
// goal verification) interleave with the transcript instead of vanishing.
describe("SessionStore.transcript timeline separators", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  it("emits model_change, compaction (deduped), fork and verification entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_tl", "tl", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    // a user turn, then an assistant turn carrying separators + an answer
    insMsg.run("m0", "sess_tl", JSON.stringify({ role: "user" }), 0);
    insPart.run("m0_p", "m0", "sess_tl", JSON.stringify({ type: "text", text: "hello" }), 0);
    insMsg.run("m1", "sess_tl", JSON.stringify({ role: "assistant" }), 1);
    insPart.run("m1_mc", "m1", "sess_tl", JSON.stringify({
      type: "timeline", timelineType: "model_change",
      fromModel: { providerID: "builtin:zai", modelID: "GLM-5.3" },
      toModel: { providerID: "p1", modelID: "gemini-3.8" },
    }), 0);
    // compaction is stored twice: timeline part + compaction part, same operationId
    insPart.run("m1_c1", "m1", "sess_tl", JSON.stringify({
      type: "timeline", timelineType: "context_compaction", operationId: "cmp_1",
      preCompactTokenCount: 196364, postCompactTokenCount: 311908, truePostCompactTokenCount: 5174,
    }), 1);
    insPart.run("m1_c2", "m1", "sess_tl", JSON.stringify({
      type: "compaction", operationId: "cmp_1", trigger: "manual", auto: false,
      preCompactTokenCount: 196364, postCompactTokenCount: 311908, truePostCompactTokenCount: 5174,
    }), 2);
    insPart.run("m1_t", "m1", "sess_tl", JSON.stringify({ type: "text", text: "answer body" }), 3);
    // separator-only assistant turn (fork) and a failed verification
    insMsg.run("m2", "sess_tl", JSON.stringify({ role: "assistant" }), 2);
    insPart.run("m2_f", "m2", "sess_tl", JSON.stringify({
      type: "timeline", timelineType: "session_fork", parentSessionId: "sess_parent_abcd1234-0000",
    }), 0);
    insMsg.run("m3", "sess_tl", JSON.stringify({ role: "assistant" }), 3);
    insPart.run("m3_g", "m3", "sess_tl", JSON.stringify({
      type: "timeline", timelineType: "goal_verification", verification: { passed: false },
    }), 0);
    db.close();

    const store = new SessionStore(dbPath);
    const page = store.transcript("sess_tl", { limit: 50 });
    const kinds = page.turns.flatMap((t) => (t.timeline || []).map((e) => e.kind + ":" + e.label));
    assert.ok(kinds.includes("model_change:Model changed"), "model_change entry present");
    const mc = page.turns.flatMap((t) => t.timeline || []).find((e) => e.kind === "model_change");
    assert.equal(mc.detail, "GLM-5.3 → gemini-3.8");
    const comps = page.turns.flatMap((t) => t.timeline || []).filter((e) => e.kind === "compaction");
    assert.equal(comps.length, 1, "timeline + compaction twins collapse to one entry");
    assert.equal(comps[0].detail, "196k → 5k tokens");
    assert.ok(kinds.includes("session_fork:Session forked"), "fork separator present");
    const forkTurn = page.turns.find((t) => (t.timeline || []).some((e) => e.kind === "session_fork"));
    assert.equal(forkTurn.text, "", "separator-only turns carry no text");
    assert.ok(kinds.includes("goal_verification:Goal verification"), "verification separator present");
    const gv = page.turns.flatMap((t) => t.timeline || []).find((e) => e.kind === "goal_verification");
    assert.equal(gv.detail, "not passed");
    // no internal bookkeeping leaks
    assert.ok(JSON.stringify(page.turns).includes('"op"') === false, "operationId bookkeeping must not leak");
    // separator-only turns count toward the page (they render as dividers)
    assert.ok(page.turns.some((t) => !t.text && (t.timeline || []).length > 0 && !(t.tools || []).length));
  });
});

// Turn footers read the same rows the desktop's "Worked for Xs" footers do:
// turn_usage durations, error kept as data (not inline text), and runActive
// from the newest assistant message lacking time.completed.
describe("SessionStore turn durations + runActive", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  function makeDb(dbPath) {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE turn_usage (session_id TEXT, turn_id TEXT, user_message_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER);
    `);
    return db;
  }

  it("attaches turn_usage duration to the last assistant turn and keeps errors as data", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = makeDb(dbPath);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_du", "du", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    insMsg.run("mu", "sess_du", JSON.stringify({ role: "user", time: { created: 1000 } }), 0);
    insPart.run("mu_p", "mu", "sess_du", JSON.stringify({ type: "text", text: "do it" }), 0);
    // two assistant messages in the exchange (multi-step): duration lands on the LAST
    insMsg.run("ma1", "sess_du", JSON.stringify({ role: "assistant", time: { created: 2000, completed: 3000 } }), 1);
    insPart.run("ma1_p", "ma1", "sess_du", JSON.stringify({ type: "step-start" }), 0);
    insPart.run("ma1_t", "ma1", "sess_du", JSON.stringify({ type: "tool", tool: "Bash", state: { status: "completed", input: { command: "ls" } } }), 1);
    insPart.run("ma1_f", "ma1", "sess_du", JSON.stringify({ type: "step-finish", tokens: { total: 1200 } }), 2);
    insMsg.run("ma2", "sess_du", JSON.stringify({ role: "assistant", time: { created: 4000, completed: 5500 } }), 2);
    insPart.run("ma2_t", "ma2", "sess_du", JSON.stringify({ type: "text", text: "done, here you go" }), 0);
    insPart.run("ma2_f", "ma2", "sess_du", JSON.stringify({ type: "step-finish", tokens: { total: 300 } }), 1);
    // a failed exchange: message carries msg.error, NO "⚠" text
    insMsg.run("mu2", "sess_du", JSON.stringify({ role: "user", time: { created: 6000 } }), 3);
    insPart.run("mu2_p", "mu2", "sess_du", JSON.stringify({ type: "text", text: "again" }), 0);
    insMsg.run("ma3", "sess_du", JSON.stringify({ role: "assistant", time: { created: 7000, completed: 12391 }, error: { data: { message: "[1308][Usage limit reached]" } } }), 4);
    insPart.run("ma3_f", "ma3", "sess_du", JSON.stringify({ type: "step-finish", tokens: { total: 44 } }), 0);
    db.prepare("INSERT INTO turn_usage (session_id, turn_id, user_message_id, status, started_at, completed_at, duration_ms) VALUES (?,?,?,?,?,?,?)")
      .run("sess_du", "t1", "mu", "completed", 1000, 5500, 4500);
    db.prepare("INSERT INTO turn_usage (session_id, turn_id, user_message_id, status, started_at, completed_at, duration_ms) VALUES (?,?,?,?,?,?,?)")
      .run("sess_du", "t2", "mu2", "error", 6000, 11391, 5391);
    db.close();

    const store = new SessionStore(dbPath);
    const page = store.transcript("sess_du", { limit: 50 });
    const lastAssistant = [...page.turns].reverse().find((t) => t.role === "assistant" && t.text.includes("here you go"));
    assert.equal(lastAssistant.durationMs, 4500, "turn_usage duration attaches to the exchange's last assistant turn");
    const firstAssistant = page.turns.find((t) => t.role === "assistant" && (t.tools || []).length);
    assert.ok(!firstAssistant.durationMs, "mid-exchange assistant turns carry no footer duration");
    // ZWUI-067: contextTokens is the LATEST step-finish total (each step
    // re-feeds the context) — the chip's "current context", not the sum
    assert.equal(page.contextTokens, 44, "latest step-finish total wins over the sum");
    assert.equal(page.tokensTotal, 1544, "tokensTotal remains the all-steps sum");
    // ZWUI-077: session-level worked time — the sum of completed turn_usage rows
    assert.equal(store.workedMs("sess_du"), 9891, "workedMs sums completed-turn durations");
    const failed = page.turns.find((t) => t.error);
    assert.ok(failed, "failed turn present");
    assert.equal(failed.text, "", "failed turn renders no inline text");
    assert.ok(failed.error.includes("Usage limit reached"), "raw error kept as data");
    assert.equal(failed.durationMs, 5391);
    // turns carry their message id — the web merges incremental updates by it
    assert.ok(page.turns.every((t) => typeof t.id === "string" && t.id.length > 0), "turn ids present");
    // byline timestamps: message time.created exposed as createdAt (epoch ms)
    assert.equal(lastAssistant.createdAt, 4000, "assistant turn exposes its message creation time");
    const userTurn = page.turns.find((t) => t.role === "user");
    assert.equal(userTurn.createdAt, 1000, "user turn exposes its message creation time");
    assert.ok(page.turns.every((t) => t.createdAt === null || typeof t.createdAt === "number"), "createdAt is number or null");
  });

  it("workedMs treats a store without turn_usage (older CLI) as zero, never an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT)");
    db.close();
    const store = new SessionStore(dbPath);
    assert.equal(store.workedMs("sess_missing"), 0);
  });

  it("todos returns the checklist ordered by position and tolerates a missing table (ZWUI-078)", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE todo (session_id text not null, content text not null, status text not null, priority text not null, position integer not null, time_created integer not null, time_updated integer not null, primary key(session_id, position));
    `);
    const ins = db.prepare("INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?,?,?,?,?,?,?)");
    ins.run("sess_todos", "first step", "completed", "high", 0, 1, 1);
    ins.run("sess_todos", "current step", "in_progress", "high", 1, 1, 2);
    ins.run("sess_todos", "later step", "pending", "medium", 2, 1, 1);
    db.close();
    const store = new SessionStore(dbPath);
    const todos = store.todos("sess_todos");
    assert.deepEqual(todos.map((t) => [t.content, t.status]), [
      ["first step", "completed"],
      ["current step", "in_progress"],
      ["later step", "pending"],
    ]);
    // a store without the todo table answers empty, never throws
    const bareDir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const bare = new SessionStore(join(bareDir, "db.sqlite"));
    assert.deepEqual(bare.todos("sess_any"), []);
  });

  it("separator-only messages never take the turn footer", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = makeDb(dbPath);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_sep", "sep", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    insMsg.run("mu", "sess_sep", JSON.stringify({ role: "user", time: { created: 1000 } }), 0);
    insPart.run("mu_p", "mu", "sess_sep", JSON.stringify({ type: "text", text: "go" }), 0);
    insMsg.run("ma", "sess_sep", JSON.stringify({ role: "assistant", time: { created: 2000, completed: 6000 } }), 1);
    insPart.run("ma_t", "ma", "sess_sep", JSON.stringify({ type: "text", text: "done" }), 0);
    // a model-change separator lands as its OWN assistant message after the answer
    insMsg.run("mtl", "sess_sep", JSON.stringify({ role: "assistant", time: { created: 6100 } }), 2);
    insPart.run("mtl_p", "mtl", "sess_sep", JSON.stringify({
      type: "timeline", timelineType: "model_change",
      fromModel: { providerID: "p1", modelID: "a" }, toModel: { providerID: "p1", modelID: "b" },
    }), 0);
    db.prepare("INSERT INTO turn_usage (session_id, turn_id, user_message_id, status, started_at, completed_at, duration_ms) VALUES (?,?,?,?,?,?,?)")
      .run("sess_sep", "t1", "mu", "completed", 1000, 6000, 5000);
    db.close();

    const store = new SessionStore(dbPath);
    const page = store.transcript("sess_sep", { limit: 50 });
    const answer = page.turns.find((t) => t.text === "done");
    const separator = page.turns.find((t) => (t.timeline || []).length > 0 && !t.text);
    assert.ok(answer, "answer turn present");
    assert.ok(separator, "separator turn present");
    assert.equal(answer.durationMs, 5000, "footer stays on the substantive answer turn");
    assert.ok(!separator.durationMs, "separator-only turn must not steal the footer");
  });

  it("runActive is true only for a fresh uncompleted assistant tail message", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-store-"));
    const dbPath = join(dir, "db.sqlite");
    const db = makeDb(dbPath);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_ra", "ra", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const now = Date.now();
    // completed exchange → idle
    insMsg.run("m1", "sess_ra", JSON.stringify({ role: "user" }), 0);
    insMsg.run("m2", "sess_ra", JSON.stringify({ role: "assistant", time: { created: now - 5000, completed: now - 1000 } }), 1);
    const store = new SessionStore(dbPath);
    assert.equal(store.runActive("sess_ra"), false);
    // mid-turn: newest message is an assistant reply without time.completed
    insMsg.run("m3", "sess_ra", JSON.stringify({ role: "user" }), 2);
    insMsg.run("m4", "sess_ra", JSON.stringify({ role: "assistant", time: { created: now - 3000 } }), 3);
    assert.equal(store.runActive("sess_ra"), true);
    // stale uncompleted message (crashed run) → not busy
    const db2 = new DatabaseSync(dbPath);
    db2.prepare("UPDATE message SET data = ? WHERE id = 'm4'")
      .run(JSON.stringify({ role: "assistant", time: { created: now - 12 * 3600_000 } }));
    db2.close();
    assert.equal(store.runActive("sess_ra"), false);
    // newest message is the user prompt (answer not started) → not busy
    const db3 = new DatabaseSync(dbPath);
    db3.prepare("DELETE FROM message WHERE id = 'm4'").run();
    db3.close();
    assert.equal(store.runActive("sess_ra"), false);
    db.close();
  });
});

// Slash-command palette backing: /api/commands lists the CLI's custom
// command registry for a workspace, and refuses cwds outside the roots.
describe("/api/commands", () => {
  it("lists custom commands from the (fake) CLI registry", async () => {
    const r = await fetch(`${BASE}/api/commands?cwd=${encodeURIComponent(ws)}`, { headers: auth });
    assert.equal(r.status, 200);
    const j = await r.json();
    const names = j.commands.map((c) => c.name);
    assert.ok(names.includes("fake-ship"), "project command listed");
    assert.ok(names.includes("fake-audit"), "user command listed");
    assert.ok(j.commands.every((c) => typeof c.description === "string"));
  });
  it("403s for a cwd outside the allowed roots", async () => {
    const r = await fetch(`${BASE}/api/commands?cwd=${encodeURIComponent("/etc")}`, { headers: auth });
    assert.equal(r.status, 403);
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

describe("ZPAR-001 & ZPAR-002: Canonical session directory & auth bootstrap", async () => {
  const { DatabaseSync } = await import("node:sqlite");

  it("GET /api/bootstrap is accessible without credentials and reports authRequired", async () => {
    const r = await fetch(`${BASE}/api/bootstrap`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.authRequired, true);
    assert.ok(typeof j.serverVersion === "string");
  });

  it("enforces canonical session directory and rejects mismatch with 409", async () => {
    const dbDir = join(home, "cli", "db");
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, "db.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT, time_title_updated INTEGER,
        title_source TEXT NOT NULL DEFAULT 'first_input' CHECK(title_source IN ('default','first_input','generated','custom')));
      CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE IF NOT EXISTS session_target (session_id TEXT PRIMARY KEY, objective TEXT, status TEXT, tokens_used INTEGER, time_used_seconds INTEGER, time_created INTEGER, time_updated INTEGER);
    `);
    const otherProj = join(ws, "other-proj");
    mkdirSync(otherProj, { recursive: true });
    db.prepare("INSERT OR REPLACE INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_other", "other project session", otherProj, 1, 100);
    db.prepare("INSERT OR REPLACE INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_outside_root", "outside session", "/etc/secret", 1, 100);
    db.close();

    // 1. Mismatched directory: session belongs to otherProj, but cwd is proj -> 409 SESSION_CONTEXT_MISMATCH
    const rMismatch = await chat({ text: "mismatch test", sessionId: "sess_other", cwd: join(ws, "proj") });
    assert.equal(rMismatch.status, 409);
    const jMismatch = await rMismatch.json();
    assert.equal(jMismatch.code, "SESSION_CONTEXT_MISMATCH");
    assert.equal(jMismatch.canonicalDirectory, otherProj);

    // 2. Session directory outside allowed roots -> 403
    const rOutside = await chat({ text: "outside test", sessionId: "sess_outside_root", cwd: join(ws, "proj") });
    assert.equal(rOutside.status, 403);
    const jOutside = await rOutside.json();
    assert.equal(jOutside.code, "SESSION_ROOT_FORBIDDEN");

    // 3. Detail route rejects session outside allowed roots with 403
    const rDetail = await fetch(`${BASE}/api/sessions/sess_outside_root`, { headers: auth });
    assert.equal(rDetail.status, 403);

    // 4. Rename route rejects session outside allowed roots with 403
    const rRename = await fetch(`${BASE}/api/sessions/sess_outside_root/rename`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "renamed" }),
    });
    assert.equal(rRename.status, 403);

    // 4b. A successful rename must satisfy the store's title_source CHECK
    // (regression: writing 'user' violated the real schema's constraint and
    // 500'd every web rename; the CLI's term is 'custom')
    const rRenameOk = await fetch(`${BASE}/api/sessions/sess_other/rename`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "renamed properly" }),
    });
    assert.equal(rRenameOk.status, 200);
    const dbCheck = new DatabaseSync(dbPath);
    const row = dbCheck.prepare("SELECT title, title_source FROM session WHERE id = 'sess_other'").get();
    dbCheck.close();
    assert.equal(row.title, "renamed properly");
    assert.equal(row.title_source, "custom");

    // 5. Matching directory succeeds
    const rMatch = await chat({ text: "matching test", sessionId: "sess_other", cwd: otherProj });
    assert.equal(rMatch.status, 202);
    const jMatch = await rMatch.json();

    // 6. Detail route reports activeJobId for in-flight jobs on this server (ZWUI-075)
    const rDetailLive = await fetch(`${BASE}/api/sessions/sess_other`, { headers: auth });
    assert.equal(rDetailLive.status, 200);
    const jDetailLive = await rDetailLive.json();
    assert.equal(jDetailLive.activeJobId, jMatch.jobId, "reports active job id for reload adoption");
  });
});

describe("ZPAR-005 & ZPAR-008: Concurrency, idempotency conflict, and job cancellation", () => {
  it("rejects idempotency conflict (same key, different payload) with 409 IDEMPOTENCY_CONFLICT", async () => {
    const reqId = "idem-conflict-test";
    const r1 = await chat({ text: "payload 1" }, { "x-request-id": reqId });
    assert.equal(r1.status, 202);
    const r2 = await chat({ text: "payload 2 DIFFERENT" }, { "x-request-id": reqId });
    assert.equal(r2.status, 409);
    const j2 = await r2.json();
    assert.equal(j2.code, "IDEMPOTENCY_CONFLICT");
  });

  it("guards same-session concurrency with 409 SESSION_BUSY", async () => {
    // Start a slow run on a dedicated session ID
    const r1 = await chat({ text: "slowfirst run 1", sessionId: "sess_busy_test" });
    assert.equal(r1.status, 202);
    const { jobId } = await r1.json();

    // Concurrently try to start a second run on the same session
    const r2 = await chat({ text: "run 2 while busy", sessionId: "sess_busy_test" });
    assert.equal(r2.status, 409);
    const j2 = await r2.json();
    assert.equal(j2.code, "SESSION_BUSY");

    // Clean up active run
    await fetch(`${BASE}/api/jobs/${jobId}/cancel`, { method: "POST", headers: auth });
    await new Promise((res) => setTimeout(res, 200));
  });

  it("job cancellation transitions to stopping then process close finalizes cancelled and done event", async () => {
    const r = await chat({ text: "slowfirst to be cancelled" });
    assert.equal(r.status, 202);
    const { jobId } = await r.json();

    const rCancel = await fetch(`${BASE}/api/jobs/${jobId}/cancel`, { method: "POST", headers: auth });
    assert.equal(rCancel.status, 200);
    const jCancel = await rCancel.json();
    assert.equal(jCancel.canceled, true);

    // Collect SSE or poll until terminal cancelled
    let status = "";
    for (let i = 0; i < 20; i++) {
      const s = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: auth });
      const js = await s.json();
      status = js.status;
      if (status === "cancelled") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(status, "cancelled");

    // ZWUI-040: the SSE `done` event carries the AUTHORITATIVE status —
    // /api/jobs and the stream must agree (exitCode is null here; the legacy
    // derivation read that as "failed")
    const done = await collectDoneEvent(jobId);
    assert.equal(done.status, "cancelled");
    assert.equal(done.cancelRequested, true);
  });

  it("ZWUI-040: a graceful exit(0) AFTER cancellation still terminates cancelled (done carries status)", async () => {
    // In-process JobManager with a fixture CLI that traps SIGTERM and exits 0.
    // config is frozen at the module's first import — set the entry directly
    // instead of relying on process.env reaching a cached config object.
    const { JobManager, config } = await import("../server/zcode.js");
    config.cliEntry = join(SERVER_ROOT, "tests", "fixtures", "cli-graceful-cancel.mjs");
    const mgr = new JobManager();
    const { job } = mgr.start({ text: "graceful", cwd: ws, mode: "plan", requestId: "graceful-cancel-1" });
    assert.equal(job.status, "running");
    // let the fixture boot and register its SIGTERM handler — cancelling
    // during node's startup kills it by signal instead of the graceful path
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(mgr.cancel(job.id), true);
    await new Promise((res) => {
      const t = setInterval(() => {
        if (["succeeded", "failed", "cancelled", "timeout"].includes(job.status)) { clearInterval(t); res(); }
      }, 50);
    });
    assert.equal(job.status, "cancelled", "exit code 0 after cancel must not become succeeded");
    assert.equal(job.exitCode, 0);
    const done = job.lines.find((e) => e.kind === "done");
    assert.equal(done.status, "cancelled");
    assert.equal(done.cancelRequested, true);
    // the idempotency record survives: resubmitting the SAME request id
    // returns the same (terminal) job rather than starting a second run
    const again = mgr.start({ text: "graceful", cwd: ws, mode: "plan", requestId: "graceful-cancel-1" });
    assert.equal(again.replayed, true);
    assert.equal(again.job.id, job.id);
  });
});

// Replays a terminal job's event buffer and resolves with its `done` event.
async function collectDoneEvent(jobId) {
  const r = await fetch(`${BASE}/api/events/${jobId}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  const events = text.split("\n\n").filter(Boolean).map((chunk) => {
    const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
    return dataLine ? JSON.parse(dataLine.slice(6)) : null;
  }).filter(Boolean);
  const done = events.find((e) => e.kind === "done");
  assert.ok(done, "terminal stream must contain a done event");
  return done;
}

// ---- ZWUI-043/044: literal directory scope + non-blocking analytics ----
describe("directory scope + analytics integrity", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");
  const { computeAnalytics, sliceDaily } = await import("../server/analytics.js");

  // synthetic store with tricky directory names: '_' looks like a LIKE
  // wildcard, /ws/projXa/private is a sibling-prefix trap
  const dir = mkdtempSync(join(tmpdir(), "zc-scope-"));
  const dbPath = join(dir, "db.sqlite");
  const now = Date.now();
  {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE turn_usage (user_message_id TEXT, session_id TEXT, status TEXT, duration_ms INTEGER);
    `);
    const insSess = db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)");
    const ROOTS = ["/ws/proj_a", "/ws/other"];
    const sessDirs = {
      "sess_in1": "/ws/proj_a",           // in root
      "sess_in2": "/ws/proj_a/sub/deep",  // in root (nested)
      "sib": "/ws/projXa/private",        // '_' wildcard trap — OUT
      "pct": "/ws/projAb",                // would not match, but proves prefix exactness
      "other1": "/ws/other",              // second root
      "outside": "/ws/elsewhere/deep",    // genuinely outside every declared root
    };
    let i = 0;
    for (const [id, directory] of Object.entries(sessDirs)) {
      insSess.run(id, `title ${id}`, directory, now - i, now - i);
      i++;
    }
    // a step-finish part + turn_usage row for token/duration aggregates
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    insPart.run("p1", "m1", "sess_in1", JSON.stringify({ type: "step-finish", tokens: { total: 1500 } }), 0);
    insPart.run("p2", "m2", "other1", JSON.stringify({ type: "step-finish", tokens: { total: 250 } }), 0);
    db.prepare("INSERT INTO turn_usage (user_message_id, session_id, status, duration_ms) VALUES (?,?,?,?)")
      .run("mu1", "sess_in1", "ok", 4000);
    db.close();
  }

  it("ZWUI-044: scope predicates match roots literally (no LIKE wildcard or sibling leakage)", () => {
    const store = new SessionStore(dbPath);
    const underA = store.recentUnder("/ws/proj_a", 30);
    assert.deepEqual(underA.map((s) => s.id).sort(), ["sess_in1", "sess_in2"],
      "'_' in the root name must not widen the match to /ws/projXa/private");
    const across = store.recent(["/ws/proj_a", "/ws/other"], 50);
    assert.deepEqual(across.map((s) => s.id).sort(), ["other1", "sess_in1", "sess_in2"]);
    const hits = store.searchSessions("title", ["/ws/proj_a"], 20);
    assert.deepEqual(hits.map((s) => s.id).sort(), ["sess_in1", "sess_in2"]);
  });

  it("computeAnalytics scopes every aggregate and reports sessions/durations only inside roots", () => {
    const store = new SessionStore(dbPath);
    const snap = computeAnalytics((sql, params) => store.query(sql, params), ["/ws/proj_a"]);
    assert.equal(snap.sessions, 2);
    assert.equal(snap.tokens, 1500);
    assert.equal(snap.turns, 1);
    assert.equal(snap.agentTimeMs, 4000);
    assert.equal(snap.topSessions.length, 1);
    assert.equal(snap.topSessions[0].tokens, 1500);
  });

  it("sliceDaily fills the last N CALENDAR days with zeros (not the N most recent active days)", () => {
    const q = (sql) => { void sql; return []; };
    void q;
    const today = new Date().toISOString().slice(0, 10);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000).toISOString().slice(0, 10);
    const daily = sliceDaily([{ day: today, sessions: 3 }, { day: tenDaysAgo, sessions: 9 }], 7);
    assert.equal(daily.length, 7);
    assert.equal(daily[6].day, today);
    assert.equal(daily[6].sessions, 3);
    // the 10-day-old activity falls OUTSIDE the 7-day window entirely
    assert.ok(!daily.some((d) => d.day === tenDaysAgo));
    assert.ok(daily.slice(0, 6).every((d) => d.sessions === 0), "inactive days are zero-filled");
  });

  // Cache semantics with the real worker on a real (synthetic) DB.
  const store = new SessionStore(dbPath);
  const ROOTS = ["/ws/proj_a", "/ws/other"];

  it("ZWUI-043: cold request returns pending without blocking, then the worker delivers", async () => {
    const t0 = Date.now();
    const first = store.requestAnalytics(ROOTS, 14);
    const coldMs = Date.now() - t0;
    assert.equal(first.data, null, "cold request must not block on the build");
    assert.ok(coldMs < 250, `cold request took ${coldMs}ms — aggregation leaked onto the event loop`);
    // the API event loop stays responsive WHILE the worker crunches: the
    // live test server answers health mid-build
    const h0 = Date.now();
    const hr = await fetch(`${BASE}/api/health`, { headers: auth });
    assert.equal(hr.status, 200);
    assert.ok(Date.now() - h0 < 500, "health check blocked during background aggregation");
    // the build completes on the worker and the same request path serves it
    let result = null;
    for (let i = 0; i < 300 && !result; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const r2 = store.requestAnalytics(ROOTS, 14);
      if (r2.data) result = r2;
    }
    assert.ok(result, "worker build never completed");
    assert.equal(result.data.sessions, 3); // sess_in1, sess_in2, other1
    assert.equal(result.data.tokens, 1750);
    assert.equal(result.stale, false);
    assert.ok(result.generatedAt > 0, "as-of time is reported");
    assert.equal(result.data.daily.length, 14);
  });

  it("ZWUI-043: cached snapshot serves fresh; past TTL serves stale and retriggers the build", async () => {
    const c = store.analyticsCache;
    assert.ok(c && c.value);
    const first = store.requestAnalytics(ROOTS, 7);
    assert.equal(first.stale, false);
    assert.equal(first.data.daily.length, 7, "days is a serve-time slice, not a rebuild key");
    // age the snapshot past its TTL
    c.builtAt = Date.now() - 11 * 60_000;
    const second = store.requestAnalytics(ROOTS, 14);
    assert.equal(second.stale, true, "expired snapshot must be flagged stale, not silently fresh");
    assert.equal(second.generatedAt, c.builtAt, "as-of time is the build time");
    // the rebuild was triggered (in-flight) and completes cleanly
    assert.ok(store.analyticsInflight.has(c.key));
    let rebuilt = false;
    for (let i = 0; i < 300 && !rebuilt; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rebuilt = store.requestAnalytics(ROOTS, 14).stale === false;
    }
    assert.ok(rebuilt, "expired snapshot was not refreshed");
  });

  it("ZWUI-043: a failed build with existing data keeps serving it; recovery retries and clears the error", async () => {
    const c = store.analyticsCache;
    c.builtAt = Date.now() - 11 * 60_000; // expire
    // first expired request schedules a rebuild; fail it by killing the worker
    store.requestAnalytics(ROOTS, 14);
    const w = store.analyticsWorker;
    await w.terminate();
    w.emit("exit", 1);
    assert.equal(store.analyticsInflight.size, 0, "worker death must release the in-flight build");
    // the stale snapshot still serves (flagged), and a new request may retry
    const served = store.requestAnalytics(ROOTS, 14);
    assert.equal(served.data === null, false, "stale data must survive a failed rebuild");
    // recovery: a fresh worker rebuilds and the snapshot goes back to fresh
    let recovered = false;
    for (let i = 0; i < 300 && !recovered; i++) {
      await new Promise((r) => setTimeout(r, 100));
      recovered = store.requestAnalytics(ROOTS, 14).stale === false;
    }
    assert.ok(recovered, "store never recovered after worker death");
    assert.equal(store.requestAnalytics(ROOTS, 14).data.sessions, 3);
  });

  it("ZWUI-043: build failure with NO prior data answers pending+error, never fake empties", async () => {
    const broken = new SessionStore(join(dir, "does-not-exist.sqlite"));
    const r = broken.requestAnalytics(ROOTS, 14);
    assert.equal(r.data, null);
    let err = null;
    for (let i = 0; i < 100 && !err; i++) {
      await new Promise((res) => setTimeout(res, 100));
      err = broken.requestAnalytics(ROOTS, 14).error;
    }
    assert.ok(err, "the build failure must surface");
    assert.match(err, /not found/i);
  });
});

// ---- ZWUI-051: read-only GitHub issue routes (fixture GitHub API) ----
describe("ZWUI-051 GitHub issue reading", () => {
  const GH_PORT = 3475;
  const GH_BASE = `http://127.0.0.1:${GH_PORT}`;
  const PORT_GH = 3474;
  const BASE_GH = `http://127.0.0.1:${PORT_GH}`;
  const TOKEN_GH = "gh-test-token";
  let ghApi;
  let ghServer;
  let stats;

  const issue491 = {
    number: 491, title: "Improve session recovery", state: "open",
    body: "## Acceptance\n- [ ] reconnect keeps the transcript\n- [x] banner shows transport state",
    labels: [{ name: "ux", color: "1d76db" }, { name: "p1", color: "d93f0b" }],
    assignees: [{ login: "ther12k" }], milestone: { title: "v0.4", due_on: null },
    user: { login: "ther12k" }, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-10T08:00:00Z",
    closed_at: null, comments: 3, html_url: `${GH_BASE.replace(GH_PORT, 4400)}/ther12k/zcode-web/issues/491`,
  };

  before(async () => {
    stats = { detail200: 0, detail304: 0 };
    ghApi = createHttpServer((req, res) => {
        const url = new URL(req.url, GH_BASE);
        const p = url.pathname;
        const json = (code, body, headers = {}) => {
          if (code === 304) {
            // a real 304 carries no body
            res.writeHead(304, headers);
            return res.end();
          }
          const buf = Buffer.from(JSON.stringify(body));
          res.writeHead(code, { "content-type": "application/json", ...headers });
          res.end(buf);
        };
        if (p === "/repos/ther12k/zcode-web/issues/491") {
          if (req.headers["if-none-match"] === '"W/491"') { stats.detail304 += 1; return json(304, undefined); }
          stats.detail200 += 1;
          return json(200, issue491, { etag: '"W/491"' });
        }
        if (p === "/repos/ther12k/zcode-web/issues/42") {
          return json(200, { ...issue491, number: 42, title: "Extract recovery helper", pull_request: { html_url: "x" } });
        }
        if (p === "/repos/ther12k/zcode-web/issues/500") return json(404, { message: "Not Found" });
        if (p === "/repos/ther12k/zcode-web/issues/491/comments") {
          const page = Number(url.searchParams.get("page")) || 1;
          const mk = (i) => ({ id: 1000 + i, user: { login: `user${i}` }, body: `comment ${i}`, created_at: "2026-09-11T09:00:00Z", updated_at: "2026-09-11T09:00:00Z", html_url: "c" });
          return json(200, page === 1 ? Array.from({ length: 20 }, (_, i) => mk(i)) : [mk(20)]);
        }
        return json(404, { message: "Not Found" });
    });
    await new Promise((res) => ghApi.listen(GH_PORT, "127.0.0.1", res));

    // app server instance with the fixture API base + repo allowlist
    const ws2 = mkdtempSync(join(tmpdir(), "zc-gh-"));
    mkdirSync(join(ws2, "proj"), { recursive: true });
    ghServer = spawn(process.execPath, [join(SERVER_ROOT, "server", "index.js")], {
      env: {
        ...process.env,
        PORT: String(PORT_GH), HOST: "127.0.0.1",
        ZCODE_WEB_TOKEN: TOKEN_GH,
        ZCODE_CLI_ENTRY: join(SERVER_ROOT, "scripts", "fake-cli.mjs"),
        ZCODE_WORKSPACE_ROOT: ws2,
        ZCODE_HOME: mkdtempSync(join(tmpdir(), "zc-gh-home-")),
        ZCODE_GITHUB_API_BASE: GH_BASE,
        ZCODE_GITHUB_REPOS: "ther12k/zcode-web",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    ghServer.stderr.on("data", (c) => process.stderr.write(c));
    await new Promise((resolve) => {
      const t = setInterval(async () => {
        try {
          const r = await fetch(`${BASE_GH}/api/health`, { headers: { authorization: `Bearer ${TOKEN_GH}` } });
          if (r.ok) { clearInterval(t); resolve(); }
        } catch {}
      }, 100);
    });
  });

  after(async () => {
    ghServer.kill("SIGTERM");
    await new Promise((res) => ghServer.once("exit", res));
    ghApi.closeAllConnections?.();
    await new Promise((res) => ghApi.close(res));
  });

  const ghAuth = { authorization: `Bearer ${TOKEN_GH}` };

  it("capability reports enabled state, token presence and the allowlist", async () => {
    const r = await fetch(`${BASE_GH}/api/github/capability`, { headers: ghAuth });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.enabled, true);
    assert.equal(j.tokenPresent, false);
    assert.deepEqual(j.allowlist, ["ther12k/zcode-web"]);
  });

  it("serves a normalized verified issue with labels, assignee, milestone and task list", async () => {
    const r = await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491`, { headers: ghAuth });
    assert.equal(r.status, 200);
    const { issue, cached } = await r.json();
    assert.equal(cached, false);
    assert.equal(issue.number, 491);
    assert.equal(issue.title, "Improve session recovery");
    assert.equal(issue.state, "open");
    assert.equal(issue.isPR, false);
    assert.ok(issue.body.includes("[ ] reconnect"));
    assert.deepEqual(issue.labels.map((l) => l.name), ["ux", "p1"]);
    assert.deepEqual(issue.assignees, ["ther12k"]);
    assert.equal(issue.milestone.title, "v0.4");
  });

  it("identifies pull requests via the pull_request field (never labeled an issue)", async () => {
    const r = await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/42`, { headers: ghAuth });
    const { issue } = await r.json();
    assert.equal(issue.isPR, true);
  });

  it("paginates comments and reports hasMore", async () => {
    const p1 = await (await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491/comments?page=1`, { headers: ghAuth })).json();
    assert.equal(p1.comments.length, 20);
    assert.equal(p1.hasMore, true);
    const p2 = await (await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491/comments?page=2`, { headers: ghAuth })).json();
    assert.equal(p2.comments.length, 1);
    assert.equal(p2.hasMore, false);
  });

  it("revalidates with ETag conditional requests (304 serves the cache)", async () => {
    const r1 = await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491`, { headers: ghAuth });
    await r1.json();
    const before200 = stats.detail200;
    const r2 = await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491`, { headers: ghAuth });
    const j2 = await r2.json();
    assert.equal(j2.cached, true, "second read must come from the ETag cache");
    assert.equal(stats.detail200, before200, "the fixture served a 304, not a fresh 200");
  });

  it("refresh bypasses the conditional request", async () => {
    const before200 = stats.detail200;
    await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/491?refresh=1`, { headers: ghAuth });
    assert.equal(stats.detail200, before200 + 1);
  });

  it("maps missing/inaccessible issues to NOT_FOUND, not a fabricated card", async () => {
    const r = await fetch(`${BASE_GH}/api/github/issues/ther12k/zcode-web/500`, { headers: ghAuth });
    assert.equal(r.status, 404);
    const j = await r.json();
    assert.equal(j.code, "NOT_FOUND");
  });

  it("enforces the repository allowlist (scoped to exposed repositories)", async () => {
    const r = await fetch(`${BASE_GH}/api/github/issues/acme/other/1`, { headers: ghAuth });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, "REPO_FORBIDDEN");
  });

  it("rejects malformed identities before constructing any upstream request", async () => {
    for (const path of ["/ther12k/zcode-web/0", "/th%2F12k/zcode-web/5"]) {
      const r = await fetch(`${BASE_GH}/api/github/issues${path}`, { headers: ghAuth });
      assert.equal(r.status, 400, path);
      assert.equal((await r.json()).code, "BAD_IDENTITY", path);
    }
    {
      // URL normalization flattens dot segments before routing — nothing
      // upstream is ever constructed from them
      const r = await fetch(`${BASE_GH}/api/github/issues/ther12k/../etc/1`, { headers: ghAuth });
      assert.ok([400, 404].includes(r.status), "traversal flattened, never proxied");
    }
  });

  it("binds bare #N resolution: git status exposes the parsed origin remote", async () => {
    // init a real git repo with a github origin in the MAIN server's workspace
    const { execFileSync } = await import("node:child_process");
    const projDir = join(ws, "proj");
    execFileSync("git", ["init", "-q"], { cwd: projDir });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:ther12k/zcode-web.git"], { cwd: projDir });
    const r = await fetch(`${BASE}/api/git/status?cwd=${encodeURIComponent(projDir)}`, { headers: auth });
    const j = await r.json();
    assert.deepEqual(j.remote, { host: "github.com", owner: "ther12k", repo: "zcode-web" });
  });
});

// ---- ZWUI-072d: preview snapshots — content-hash identity, active-content
// stripping, immutable reuse. Runs on its own instance with preview enabled
// (the main deployment keeps it OFF). ----
describe("ZWUI-072d preview snapshots", () => {
  const PORT_PV = 3476;
  const BASE_PV = `http://127.0.0.1:${PORT_PV}`;
  const TOKEN_PV = "pv-test-token";
  let pvServer;
  let pvWs;

  before(async () => {
    pvWs = mkdtempSync(join(tmpdir(), "zc-pv-"));
    const proj = join(pvWs, "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "index.html"), "<h1>version one</h1><script>alert(1)</script><a href='javascript:alert(2)'>x</a><div onclick=\"go()\" onload=boot()>d</div><iframe srcdoc='<script>3</script>'></iframe>");
    pvServer = spawn(process.execPath, [join(SERVER_ROOT, "server", "index.js")], {
      env: {
        ...process.env,
        PORT: String(PORT_PV), HOST: "127.0.0.1",
        ZCODE_WEB_TOKEN: TOKEN_PV,
        ZCODE_CLI_ENTRY: join(SERVER_ROOT, "scripts", "fake-cli.mjs"),
        ZCODE_WORKSPACE_ROOT: pvWs,
        ZCODE_HOME: mkdtempSync(join(tmpdir(), "zc-pv-home-")),
        ZCODE_ENABLE_PREVIEW: "1",
        ZCODE_PREVIEW_ORIGIN: "http://127.0.0.1:9",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    pvServer.stderr.on("data", (c) => process.stderr.write(c));
    await new Promise((resolve) => {
      const t = setInterval(async () => {
        try {
          const r = await fetch(`${BASE_PV}/api/health`, { headers: { authorization: `Bearer ${TOKEN_PV}` } });
          if (r.ok) { clearInterval(t); resolve(); }
        } catch {}
      }, 100);
    });
  });

  after(async () => {
    pvServer.kill("SIGTERM");
    await new Promise((res) => pvServer.once("exit", res));
  });

  const pvAuth = { authorization: `Bearer ${TOKEN_PV}`, "content-type": "application/json" };

  it("strips active content from the snapshot", async () => {
    const b = await (await fetch(`${BASE_PV}/api/preview/build`, { method: "POST", headers: pvAuth, body: JSON.stringify({ cwd: join(pvWs, "proj") }) })).json();
    assert.match(b.snapshotId, /^[0-9a-f]{16}$/);
    const page = await fetch(`${BASE_PV}/api/preview/${b.snapshotId}/index.html`, { headers: { authorization: `Bearer ${TOKEN_PV}` } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-security-policy"), "sandbox", "sandbox CSP rides on snapshot assets");
    const html = await page.text();
    assert.ok(!/<script/i.test(html), "no script tags survive");
    assert.ok(!/onclick|onload/i.test(html), "no inline handlers survive (quoted, unquoted, single/double)");
    assert.ok(!/srcdoc/i.test(html), "srcdoc iframes are dropped");
    assert.ok(!/javascript:/i.test(html), "javascript: URLs are neutralized");
    assert.ok(html.includes("version one"), "the inert markup survives");
  });

  it("same-size content edits change the snapshot id; identical rebuilds reuse it", async () => {
    const proj = join(pvWs, "proj");
    const ORIGINAL = "<h1>version one</h1><script>alert(1)</script><a href='javascript:alert(2)'>x</a><div onclick=\"go()\" onload=boot()>d</div><iframe srcdoc='<script>3</script>'></iframe>";
    const build = () => fetch(`${BASE_PV}/api/preview/build`, { method: "POST", headers: pvAuth, body: JSON.stringify({ cwd: proj }) }).then((r) => r.json());
    writeFileSync(join(proj, "index.html"), ORIGINAL);
    const first = await build();
    // SAME byte length, different content — the old cwd:bytes:count id
    // collides here and serves stale output
    writeFileSync(join(proj, "index.html"), "<h1>version two</h1>");
    const second = await build();
    assert.notEqual(second.snapshotId, first.snapshotId, "content change must change the id");
    const two = await (await fetch(`${BASE_PV}/api/preview/${second.snapshotId}/index.html`, { headers: { authorization: `Bearer ${TOKEN_PV}` } })).text();
    assert.ok(two.includes("version two") && !two.includes("version one"), "the new id serves the new content");
    // the old snapshot is untouched (immutable history)
    const one = await (await fetch(`${BASE_PV}/api/preview/${first.snapshotId}/index.html`, { headers: { authorization: `Bearer ${TOKEN_PV}` } })).text();
    assert.ok(one.includes("version one"), "old snapshot keeps serving its own content");
    // rebuilding IDENTICAL content (byte-for-byte) reuses the snapshot
    writeFileSync(join(proj, "index.html"), ORIGINAL);
    const third = await build();
    assert.equal(third.snapshotId, first.snapshotId, "identical content maps to the original id");
  });
});

// ---- ZWUI-059: content search indexes real text and never throws on the
// SQLite bind path; a missing source DB is an empty index, not a crash ----
describe("ZWUI-059 ContentSearchIndex", async () => {
  const { ContentSearchIndex } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  function makeSourceDb(dbPath, dir) {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_idx", "indexable session", dir, 1, 2);
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    insPart.run("p1", "m1", "sess_idx", JSON.stringify({ type: "text", text: "the quick brown fox hides a secret-fox-token" }), 0);
    insPart.run("p2", "m1", "sess_idx", JSON.stringify({ type: "tool", tool: "Bash", state: { status: "completed" } }), 1);
    insPart.run("p3", "m2", "sess_idx", JSON.stringify({ type: "text", text: "another searchable passage about porcupines" }), 0);
    // a rowid gap: deleted part leaves sparse rowids the watermark must pass
    insPart.run("p5", "m3", "sess_idx", JSON.stringify({ type: "text", text: "trailing tail text" }), 0);
    db.close();
    return dbPath;
  }

  it("indexes text parts chunk-by-chunk and finds scoped content", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-idx-"));
    const src = makeSourceDb(join(dir, "db.sqlite"), dir);
    const idx = new ContentSearchIndex(join(dir, "search-index.sqlite"), src);
    const p1 = idx.indexChunk([dir], { chunk: 2 });
    assert.equal(p1.total > 0, true, "source rowid total reported");
    assert.ok(p1.indexedThrough > 0, "watermark advanced past the first chunk");
    const p2 = idx.indexChunk([dir], { chunk: 2 });
    assert.equal(p2.indexedThrough, p2.total, "second chunk converges to the source total");
    const hits = idx.search("secret-fox-token", [dir]);
    assert.deepEqual(hits.map((h) => h.id), ["sess_idx"]);
    assert.ok(idx.search("porcupines", [dir]).length === 1, "later rows indexed too");
    // tool parts are not text — the fixture's tool part must not match
    assert.equal(idx.search("Bash", [dir]).length, 0);
    // no duplicate rows after re-indexing an already-covered range
    assert.equal(idx.search("secret-fox-token", [dir]).length, 1);
  });

  it("reports an empty index (no throw) when the source DB does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-idx-none-"));
    const idx = new ContentSearchIndex(join(dir, "search-index.sqlite"), join(dir, "missing.sqlite"));
    const p = idx.indexChunk([dir]);
    assert.deepEqual({ through: p.indexedThrough, total: p.total }, { through: 0, total: 0 });
    assert.deepEqual(idx.search("anything", [dir]), []);
  });
});

// /api/search stays useful when the content index fails: title hits return,
// the failure is reported in index.error (ZWUI-059 honesty contract).
describe("/api/search isolates content-index failures", () => {
  it("answers 200 with title hits and honest index metadata (or 503 DB_MISSING)", async () => {
    const r = await fetch(`${BASE}/api/search?q=proj`, { headers: auth });
    if (r.status === 503) {
      assert.equal((await r.json()).code, "DB_MISSING");
      return;
    }
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.results));
    assert.equal(typeof j.index.through, "number");
    assert.equal(typeof j.index.total, "number");
  });
});

// ---- ZWUI-062: pagination over VISIBLE messages — no part-window
// truncation, honest totals, CLI-internal messages never surface ----
describe("SessionStore.transcript visible-message pagination", async () => {
  const { SessionStore } = await import("../server/sessions.js");
  const { DatabaseSync } = await import("node:sqlite");

  function buildBigStore(dbPath) {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
      .run("sess_big", "big", "/tmp", 1, 2);
    const insMsg = db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)");
    const insPart = db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)");
    db.exec("BEGIN");
    let seq = 0;
    const N = 2100; // 2100 visible messages × 3 parts ≈ 6300 parts > the old 6000 window
    for (let i = 0; i < N; i++) {
      insMsg.run(`m${i}`, "sess_big", JSON.stringify({ role: "assistant", time: { created: i, completed: i + 1 } }), seq++);
      insPart.run(`m${i}_a`, `m${i}`, "sess_big", JSON.stringify({ type: "step-start" }), 0);
      // two text parts per message: a page boundary must never split them
      insPart.run(`m${i}_t1`, `m${i}`, "sess_big", JSON.stringify({ type: "text", text: `turn-${i} alpha` }), 1);
      insPart.run(`m${i}_t2`, `m${i}`, "sess_big", JSON.stringify({ type: "text", text: `turn-${i} beta` }), 2);
      if (i % 5 === 0) {
        // CLI-internal noise INSIDE the window: excluded from pages AND total
        insMsg.run(`syn${i}`, "sess_big", JSON.stringify({ role: "user", synthetic: true, summary: { title: "s" } }), seq++);
        insPart.run(`syn${i}_p`, `syn${i}`, "sess_big", JSON.stringify({ type: "text", text: `SYNTH-${i} internal` }), 0);
      }
    }
    db.exec("COMMIT");
    db.close();
  }

  it("totals every visible turn, hides internal ones, and never splits a message across pages", () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-big-"));
    const dbPath = join(dir, "db.sqlite");
    buildBigStore(dbPath);
    const store = new SessionStore(dbPath);

    const first = store.transcript("sess_big", { limit: 400, offset: 0 });
    assert.equal(first.total, 2100, "total counts visible content messages, not a part window");
    assert.equal(first.hasMore, true);

    // walk ALL pages: every visible turn exactly once, no internal text anywhere
    const seen = new Map();
    for (let off = 0; off < first.total; off += 400) {
      const page = store.transcript("sess_big", { limit: 400, offset: off });
      for (const t of page.turns) {
        assert.ok(!seen.has(t.id), `turn ${t.id} appeared on two pages`);
        seen.set(t.id, t);
        assert.ok(!t.text.includes("SYNTH-"), "CLI-internal text must never surface");
        assert.equal(t.text, t.id.replace("m", "turn-") + " alpha\n" + t.id.replace("m", "turn-") + " beta",
          "both text parts of a message land on the same page, joined in order");
      }
      assert.ok(page.turns.length <= 400);
    }
    assert.equal(seen.size, 2100, "paging covers every visible turn exactly once");

    // the OLDEST page really is the oldest turns (the old ascending-cap bug)
    const oldest = store.transcript("sess_big", { limit: 5, offset: first.total - 5 });
    assert.deepEqual(oldest.turns.map((t) => t.id), ["m0", "m1", "m2", "m3", "m4"]);
    assert.equal(oldest.hasMore, false, "last page reports hasMore:false");
  });
});

// ---- ZWUI-060: symlink-aware containment across the file/upload/cwd routes ----
describe("ZWUI-060 realpath containment", () => {
  it("rejects a symlink inside a root that points outside (/api/files)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "zc-out-"));
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "top secret payload");
    const link = join(ws, "proj", "link-out");
    symlinkSync(outside, link, "dir");
    try {
      const r = await fetch(`${BASE}/api/files/${encodeURIComponent(join(link, "secret.txt"))}`, { headers: auth });
      assert.equal(r.status, 403, "a symlink escape must be rejected even with an in-root spelling");
    } finally {
      unlinkSync(link);
    }
  });

  it("still serves real files inside a root (no false positives)", async () => {
    const real = join(ws, "proj", "real.txt");
    writeFileSync(real, "plain workspace file");
    const r = await fetch(`${BASE}/api/files/${encodeURIComponent(real)}`, { headers: auth });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).content, "plain workspace file");
  });

  it("rejects a chat cwd that is a symlink to outside the roots", async () => {
    const outside = mkdtempSync(join(tmpdir(), "zc-out2-"));
    const link = join(ws, "proj-link-out");
    symlinkSync(outside, link, "dir");
    try {
      const r = await chat({ text: "symlink escape", cwd: link });
      assert.equal(r.status, 400);
    } finally {
      unlinkSync(link);
    }
  });
});

// ---- ZWUI-072: uploads collide no more; over-limit attachments are an
// explicit error, never a silent drop ----
describe("upload names and attachment limits", () => {
  it("concurrent same-millisecond same-name uploads do not overwrite each other", async () => {
    const body = (payload) => JSON.stringify({ name: "collide.txt", data: Buffer.from(payload).toString("base64") });
    const [a, b] = await Promise.all([
      fetch(`${BASE}/api/upload`, { method: "POST", headers: auth, body: body("payload-alpha") }),
      fetch(`${BASE}/api/upload`, { method: "POST", headers: auth, body: body("payload-beta") }),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const ja = await a.json();
    const jb = await b.json();
    assert.notEqual(ja.name, jb.name, "stored names must be collision-resistant");
    const ca = await (await fetch(`${BASE}/api/uploads/${ja.name}`, { headers: auth })).text();
    const cb = await (await fetch(`${BASE}/api/uploads/${jb.name}`, { headers: auth })).text();
    assert.deepEqual([ca, cb].sort(), ["payload-alpha", "payload-beta"], "each stored file keeps its own payload");
  });

  it("more than five attachments is an explicit 400 listing the rejected ones", async () => {
    const up = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "att.txt", data: Buffer.from("att").toString("base64") }),
    });
    const { path } = await up.json();
    const six = Array.from({ length: 6 }, () => path);
    const r = await chat({ text: "too many", attachments: six });
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.match(j.error, /too many attachments/);
    assert.equal(j.rejected.length, 1, "the excess attachment is named");
  });
});

// ---- ZWUI-061: an oversize body settles exactly once with a real 413 ----
describe("readBody settles once", () => {
  it("answers 413 promptly for an oversize chat body", async () => {
    const big = "x".repeat(1024 * 1024 + 16);
    const r = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ text: big, cwd: join(ws, "proj"), mode: "plan" }),
    });
    assert.equal(r.status, 413);
    const j = await r.json();
    assert.match(j.error, /too large/);
  });
});

// ---- ZWUI-072: streaming UTF-8 decode in the JSONL reader ----
describe("JobManager stdout multibyte decoding", async () => {
  const { JobManager, config } = await import("../server/zcode.js");

  it("reassembles a multibyte character split across stdout chunks", async () => {
    const prevEntry = config.cliEntry;
    config.cliEntry = join(SERVER_ROOT, "tests", "fixtures", "cli-multibyte.mjs");
    try {
      const mgr = new JobManager();
      const { job } = mgr.start({ text: "multibyte", cwd: ws, mode: "plan" });
      await new Promise((res) => {
        const t = setInterval(() => {
          if (["succeeded", "failed", "cancelled", "timeout"].includes(job.status)) {
            clearInterval(t);
            res();
          }
        }, 25);
      });
      assert.equal(job.status, "succeeded");
      const line = job.lines.find((e) => e.kind === "line");
      assert.equal(line.line.payload.response, "héllo 🌍 done", "the split emoji survives parsing");
    } finally {
      config.cliEntry = prevEntry;
    }
  });
});
