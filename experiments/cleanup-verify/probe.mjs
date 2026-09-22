// Cleanup verification — does OUR production-equivalent invocation actually
// stop tool execution? (bounded investigation; reviewer-directed)
//
// Per case: boot the REAL server (server/index.js @ 7acfa87) on a disposable
// profile via the reviewed allowlist builder (no ambient credential env —
// the ACP experiment proved ANTHROPIC_* shadows ZCODE_API_KEY), with the real
// CLI binary and a per-case ZCODE_JOB_TIMEOUT_MS. Drive it exactly like the
// web UI does (default model from /api/models → /api/chat), trigger each
// action only after the tool's start marker EXISTS, and measure two INDEPENDENT
// outcomes: (1) job settlement (API status) and (2) execution termination
// (heartbeat counter stops advancing + pid dead, re-checked). Harness cleanup
// is recorded separately and never counts as success.
//
// Scenarios (fixture: ordinary = plain child; sep = `setsid` + ignores
// SIGTERM — own session, unreachable by any group signal):
//   A cancel-fresh   (ordinary + sep)   POST /api/jobs/:id/cancel
//   B cancel-resumed (ordinary)         same, on a --resume turn
//   C job-timeout    (ordinary + sep)   ZCODE_JOB_TIMEOUT_MS=25000
//   D server-shutdown (ordinary + sep)  SIGTERM to the SERVER mid-tool
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { buildChildEnv } from "./child-env.mjs";

const ROOT = new URL(".", import.meta.url).pathname; // experiments/cleanup-verify/
const WORKTREE = path.resolve(ROOT, "../..");        // zcode-web-cleanup root
const RUNROOT = path.join(os.tmpdir(), "cleanup-verify") + "/";
const CLI = "/home/ther12k/Workspace/ZCode/zcode-web/cli/zcode.cjs"; // production-bundled binary (sha recorded)
const FIXTURE = ROOT + "fixtures/marker-fixture.cjs";
const OUT = ROOT + "results/";
mkdirSync(OUT, { recursive: true });

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procInfo = (pid) => { try { const s = readFileSync(`/proc/${pid}/stat`, "utf8").split(" "); return { pid: +s[0], ppid: +s[3], pgid: +s[4], sid: +s[5], state: s[2] }; } catch { return null; } };
const alive = (pid) => { try { readFileSync(`/proc/${pid}/stat`); return true; } catch { return false; } };
const markerSeq = (f) => { try { const ls = readFileSync(f, "utf8").trim().split("\n").filter(Boolean); return ls.length ? Number(ls.at(-1).split(" ")[1]) || 0 : 0; } catch { return 0; } };
const markerStart = (f) => { try { return readFileSync(f, "utf8").split("\n")[0]; } catch { return null; } };
const fixturePid = (f) => Number((markerStart(f) ?? "").split(" ")[2]) || null;
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const log = (trace, ev) => { trace.push({ t: Date.now(), ev }); };

// verified-clean start: no leftover fixtures from earlier rounds
for (const d of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
  try { if (/marker-fixture/.test(readFileSync(`/proc/${d}/cmdline`, "utf8"))) { console.error("REFUSING: leftover fixture pid", d); process.exit(2); } } catch {}
}

// ---------- per-case profile (disposable; real credential copy, never committed) ----------
const mkProfile = (tag) => {
  const root = RUNROOT + tag + "-root";
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root + "/.zcode/cli", { recursive: true });
  cpSync(os.homedir() + "/.zcode/v2", root + "/.zcode/v2", { recursive: true });
  cpSync(os.homedir() + "/.zcode/cli/config.json", root + "/.zcode/cli/config.json");
  for (const d of [".tmp", ".config", ".cache", ".local/state", ".local/share"]) mkdirSync(path.join(root, d), { recursive: true });
  const ws = RUNROOT + tag + "-ws";
  rmSync(ws, { recursive: true, force: true }); mkdirSync(ws, { recursive: true });
  return { root, ws };
};

// ---------- boot the real server ----------
const bootServer = async (tag, { timeoutMs = 15 * 60_000 } = {}) => {
  const { root, ws } = mkProfile(tag);
  const port = await freePort();
  const token = "cleanup-verify-token";
  const env = buildChildEnv({
    parentEnv: process.env,
    profileDir: root,
    explicitEnv: {
      ZCODE_CLI_ENTRY: CLI,
      ZCODE_CLI_NODE: process.execPath,
      ZCODE_WEB_TOKEN: token,
      ZCODE_JOB_TIMEOUT_MS: String(timeoutMs),
      ZCODE_MAX_JOBS: "2",
      ZCODE_ALLOWED_MODES: "plan,build,edit,yolo",
      PORT: String(port),
    },
  });
  const proc = spawn(process.execPath, [WORKTREE + "/server/index.js"], { env, stdio: ["ignore", "pipe", "pipe"], cwd: WORKTREE });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr += c));
  const api = async (p, opts = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { ...opts, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(opts.headers ?? {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await api("/api/health").then((r) => r.status === 200).catch(() => false)) break;
    await sleep(300);
  }
  return { proc, api, ws, root, port, stderrOf: () => stderr, env };
};

// CLI child of the server (the job's process-group leader)
const cliChildOf = (serverPid) => { // returns {pid,name}|null
  for (const d of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      const st = readFileSync(`/proc/${d}/stat`, "utf8");
      const m = st.match(/^\d+ \((.*)\) \w+ (-?\d+)/);
      if (m && +m[2] === serverPid) {
        const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8");
        if (cmd.includes("zcode.cjs") && cmd.includes("--prompt")) return { pid: +d, name: m[1] };
      }
    } catch {}
  }
  return null;
};

// execution-termination evidence: counter stops AND pid gone (re-checked)
const terminated = async (trace, pid, marker) => {
  const a = markerSeq(marker);
  await sleep(2500);
  const b = markerSeq(marker);
  const stopped = a === b;
  await sleep(1200);
  const c = markerSeq(marker);
  return { stoppedAdvancing: stopped && b === c, lastSeq: c, pidDead: pid ? !alive(pid) : null, census: pid ? procInfo(pid) : null };
};

// ---------- one chat turn that starts the fixture, with trigger ----------
const runToolTurn = async (api, ws, marker, { sep = false, sessionId = null } = {}) => {
  const launch = sep
    ? `FIXTURE_IGNORE_SIGTERM=1 setsid node ${FIXTURE} ${marker}`
    : `node ${FIXTURE} ${marker}`;
  const text = `Run this exact shell command now and then wait without killing it: ${launch} . Reply only after it is running.`;
  const models = await api("/api/models");
  const def = (models.body?.models ?? []).find((m) => m.isDefault) ?? models.body?.models?.[0];
  const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ text, cwd: ws, mode: "yolo", ...(def?.ref ? { model: def.ref } : {}), ...(sessionId ? { sessionId } : {}) }) });
  if (r.status !== 200 && r.status !== 202) return { error: "chat " + r.status + " " + JSON.stringify(r.body).slice(0, 120) };
  const jobId = r.body.jobId;
  // wait for the fixture start marker (observable trigger — never a sleep)
  const dl = Date.now() + 150000;
  while (Date.now() < dl && markerSeq(marker) === 0) await sleep(250);
  return { jobId, started: markerSeq(marker) > 0, sessionId: r.body.sessionId ?? sessionId };
};

const waitTerminal = async (api, jobId, capMs = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    const j = await api(`/api/jobs/${jobId}`).catch(() => null);
    if (j?.body && ["succeeded", "failed", "cancelled", "timeout"].includes(j.body.status))
      return { status: j.body.status, ms: Date.now() - t0, sessionId: j.body.sessionId ?? null };
    await sleep(300);
  }
  return { status: "NO-TERMINAL", ms: capMs };
};

// ---------- scenario runner ----------
const runCase = async (tag, kind, { sep = false, timeoutMs = 15 * 60_000 } = {}) => {
  const trace = [];
  const srv = await bootServer(tag, { timeoutMs });
  const marker = srv.ws + "/marker.log";
  const out = { tag, kind, sep, startedAt: new Date().toISOString() };
  try {
    // B: establish a session first
    let sessionId = null;
    if (kind === "cancel-resumed") {
      const models = await srv.api("/api/models");
      const def = (models.body?.models ?? []).find((m) => m.isDefault) ?? models.body?.models?.[0];
      const warm = await srv.api("/api/chat", { method: "POST", body: JSON.stringify({ text: "Reply with exactly: WARM-OK", cwd: srv.ws, mode: "yolo", ...(def?.ref ? { model: def.ref } : {}) }) });
      const w = await waitTerminal(srv.api, warm.body.jobId, 120000);
      sessionId = w.sessionId;
      out.warmTurn = w;
      log(trace, `warm turn settled ${w.status} sessionId=${sessionId ? "yes" : "no"}`);
    }
    const turn = await runToolTurn(srv.api, srv.ws, marker, { sep, sessionId });
    if (turn.error || !turn.started) {
      out.verdict = "UNVERIFIED";
      out.reason = turn.error ?? "tool never started (no marker) — trigger unreached";
      return out;
    }
    out.jobId = turn.jobId;
    const fx = fixturePid(marker);
    const cliChild = cliChildOf(srv.proc.pid); const cliPid = cliChild?.pid ?? null;
    out.identities = {
      fixture: { markerStart: markerStart(marker), info: procInfo(fx) },
      cli: cliPid ? procInfo(cliPid) : null,
      fixtureInCliGroup: cliPid && fx ? procInfo(fx)?.pgid === procInfo(cliPid)?.pgid : null,
      fixtureOwnSession: fx ? procInfo(fx)?.sid === fx : null,
    };
    log(trace, `fixture pid ${fx} pgid=${out.identities.fixture.info?.pgid} sid=${out.identities.fixture.info?.sid}; cli pid ${cliPid} pgid=${out.identities.cli?.pgid}; sameGroup=${out.identities.fixtureInCliGroup}`);
    await sleep(400); // let the turn settle into its tool wait

    const t0 = Date.now();
    if (kind === "cancel-fresh" || kind === "cancel-resumed") {
      const r = await srv.api(`/api/jobs/${turn.jobId}/cancel`, { method: "POST" });
      log(trace, `cancel POST -> ${r.status}`);
      out.cancelHttp = r.status;
    } else if (kind === "server-shutdown") {
      log(trace, "SIGTERM -> server");
      srv.proc.kill("SIGTERM");
      const exited = await new Promise((r) => { const to = setTimeout(() => r(false), 10000); srv.proc.once("exit", () => { clearTimeout(to); r(true); }); });
      log(trace, `server exited=${exited}`);
      out.serverExited = exited;
      // job settlement is unobservable after server death — record that honestly
      out.settlement = { status: "SERVER-EXITED", ms: Date.now() - t0 };
      out.execution = await terminated(trace, fx, marker);
      out.cliAfterShutdown = cliPid ? { dead: !alive(cliPid), info: procInfo(cliPid) } : null;
      log(trace, `execution stopped=${out.execution.stoppedAdvancing} fixtureDead=${out.execution.pidDead} cliDead=${out.cliAfterShutdown?.dead}`);
      out.verdict = out.execution.stoppedAdvancing && out.execution.pidDead
        ? "PASS(shutdown stopped owned tool work)"
        : "FAIL(graceful shutdown left owned tool work running)";
      out.trace = trace.map((x) => `${new Date(x.t).toISOString().slice(14, 23)} ${x.ev}`);
      return out;
    }
    // timeout case: no action — wait for the configured deadline to fire
    out.settlement = await waitTerminal(srv.api, turn.jobId, kind === "job-timeout" ? 120000 : 60000);
    log(trace, `job settled: ${out.settlement.status} (+${out.settlement.ms}ms)`);
    out.execution = await terminated(trace, fx, marker);
    out.cliAfter = cliPid ? { dead: !alive(cliPid) } : null;
    log(trace, `execution stopped=${out.execution.stoppedAdvancing} fixtureDead=${out.execution.pidDead} cliDead=${out.cliAfter?.dead}`);
    if (kind === "cancel-resumed") out.sessionRetained = out.settlement.sessionId === sessionId;
    out.verdict = out.settlement.status === "NO-TERMINAL"
      ? "UNVERIFIED(job never settled)"
      : out.execution.stoppedAdvancing && out.execution.pidDead ? "PASS" : `FAIL(settled ${out.settlement.status} but execution continues: stopped=${out.execution.stoppedAdvancing} dead=${out.execution.pidDead})`;
    out.trace = trace.map((x) => `${new Date(x.t).toISOString().slice(14, 23)} ${x.ev}`);
    return out;
  } finally {
    // HARNESS cleanup — never counts toward any verdict
    log(trace, "harness cleanup begin");
    try { srv.proc.kill("SIGKILL"); } catch {}
    const fx = fixturePid(marker);
    if (fx && alive(fx)) { try { process.kill(fx, "SIGKILL"); log(trace, `harness killed fixture ${fx}`); } catch {} }
    const cliC = cliChildOf(srv.proc.pid);
    if (cliC && alive(cliC.pid)) { try { process.kill(-cliC.pid, "SIGKILL"); log(trace, `harness killed cli group ${cliC.pid}`); } catch {} }
    out.harnessCleanup = "performed (excluded from verdict)";
    out.stderrTail = srv.stderrOf().slice(-300);
  }
};

const CASE_TABLE = [
      ["A-cancel-fresh", "cancel-fresh", { sep: false }],
      ["A-cancel-fresh-sep", "cancel-fresh", { sep: true }],
      ["B-cancel-resumed", "cancel-resumed", { sep: false }],
      ["C-timeout", "job-timeout", { sep: false, timeoutMs: 25000 }],
      ["C-timeout-long", "job-timeout", { sep: false, timeoutMs: 60000 }],
      ["C-timeout-sep", "job-timeout", { sep: true, timeoutMs: 25000 }],
      ["D-shutdown", "server-shutdown", { sep: false }],
      ["D-shutdown-sep", "server-shutdown", { sep: true }],
    ];
const CASES = process.env.CASES
  ? process.env.CASES.split(",").map((tag) => CASE_TABLE.find((c) => c[0] === tag)).filter(Boolean)
  : [
      ["A-cancel-fresh", "cancel-fresh", { sep: false }],
      ["A-cancel-fresh-sep", "cancel-fresh", { sep: true }],
      ["B-cancel-resumed", "cancel-resumed", { sep: false }],
      ["C-timeout", "job-timeout", { sep: false, timeoutMs: 25000 }],
      ["C-timeout-sep", "job-timeout", { sep: true, timeoutMs: 25000 }],
      ["D-shutdown", "server-shutdown", { sep: false }],
      ["D-shutdown-sep", "server-shutdown", { sep: true }],
    ];

const results = {
  identity: {
    serverCommit: "7acfa87 (inv/cleanup-verify worktree)",
    cli: CLI, cliSha: sha(CLI).slice(0, 16),
    node: process.version,
    harness: "real server/index.js + real CLI, disposable profile, allowlist env builder",
  },
  cases: {},
};
for (const [tag, kind, opts] of CASES) {
  console.error(`>> ${tag}`);
  results.cases[tag] = await runCase(tag, kind, opts);
  console.error(`<< ${tag}: ${results.cases[tag].verdict}`);
  writeFileSync(OUT + "cleanup-verify.json", JSON.stringify(results, null, 1));
  await sleep(800);
}
writeFileSync(OUT + "cleanup-verify.json", JSON.stringify(results, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(results.cases).map(([k, v]) => [k, v.verdict])), null, 1));
process.exit(0);
