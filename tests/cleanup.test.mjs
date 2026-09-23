// Cleanup-module regressions (inv/cleanup-verify remediation + review fixes).
// Covers the scoped descendant lifecycle with REAL processes (plain child,
// own-session SIGTERM-ignoring child) plus identity/unknown/zombie/escalation
// edge cases via injectable probe/kill/delay. These tests FAIL against
// 7acfa87's behavior (sep child survives group-only signalling; no shutdown
// drain) AND against the pre-review candidate (unknown-after-capture falsely
// terminated; escalation not accelerable).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { probeProc, readStat, snapshotCohort, identityValid, stopCohort } from "../server/cleanup.js";

const alive = (pid) => { try { readFileSync(`/proc/${pid}/stat`); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = new URL("./fixtures/marker-fixture.cjs", import.meta.url).pathname;

const scratch = path.join(os.tmpdir(), "cleanup-unit");
before(() => { rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true }); });
after(() => { rmSync(scratch, { recursive: true, force: true }); });

// ignore-SIGTERM child in its OWN session (the reproduced resistant class).
// Normal tests attach an exit listener so node reaps; the zombie test needs
// a deferred-reap shape and manufactures the Z state via an injected probe.
const sepChild = () => {
  const marker = path.join(scratch, `m-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  const child = spawn("setsid", [process.execPath, FIXTURE, marker], {
    env: { ...process.env, FIXTURE_IGNORE_SIGTERM: "1" },
    stdio: "ignore",
  });
  child.once("exit", () => {}); // let node reap
  return { child, marker };
};
const waitStarted = async (marker) => {
  for (let i = 0; i < 100; i++) {
    try { return readFileSync(marker, "utf8").length > 0; } catch { await sleep(60); }
  }
  return false;
};

describe("readStat / probeProc / snapshotCohort / identityValid", () => {
  it("readStat returns identity fields for a live process", () => {
    const st = readStat(process.pid);
    assert.ok(st);
    assert.equal(st.pid, process.pid);
    assert.equal(st.ppid, process.ppid);
    assert.ok(st.starttime);
    assert.ok(st.state); // process state preserved (review P2: zombies)
    assert.ok(st.name.length > 0);
  });

  it("probeProc distinguishes absent from unknown; readStat collapses to null", () => {
    assert.equal(probeProc(999999999).status, "absent");
    assert.equal(readStat(999999999), null);
    // identity mismatch → not valid (observed-mismatch skip guarantee)
    const fakeMember = { pid: process.pid, starttime: "0", name: "x" };
    assert.equal(identityValid(fakeMember), false);
    assert.equal(identityValid(readStat(process.pid)), true);
  });

  it("snapshotCohort walks descendants but stops at non-descendants", async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "sep child never started");
      const cohort = snapshotCohort(child.pid);
      const pids = cohort.members.map((m) => m.pid);
      assert.ok(pids.includes(child.pid), "root included");
      const st = readStat(child.pid);
      assert.equal(pids.filter((p) => p === child.pid).length, 1);
      assert.ok(!pids.includes(process.pid));
      assert.equal(cohort.enumerationIncomplete, false);
      assert.ok(typeof st.starttime === "string");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });

  it("snapshotCohort probes the root explicitly; UNKNOWN entries flag incomplete enumeration (deterministic)", () => {
    // injected probe over the REAL /proc scan: our own pid is the root
    // (present, fabricated identity), the first other pid scanned reads
    // UNKNOWN — enumeration cannot claim completeness
    const probe = (pid) => {
      if (pid === process.pid) return { status: "present", stat: { pid, ppid: 1, pgid: pid, state: "S", name: "root", starttime: "100" } };
      return { status: "unknown", error: "EACCES" };
    };
    const cohort = snapshotCohort(process.pid, probe);
    assert.equal(cohort.members.length, 1);
    assert.equal(cohort.members[0].pid, process.pid);
    assert.equal(cohort.enumerationIncomplete, true);
    // and with an all-absent probe the root is simply not captured
    const empty = snapshotCohort(999999999, () => ({ status: "absent" }));
    assert.equal(empty.members.length, 0);
  });
});

describe("stopCohort", () => {
  it("terminates an own-session SIGTERM-IGNORING descendant (the reproduced class)", { timeout: 20000 }, async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      const handle = stopCohort(child.pid, { firstSignal: "SIGTERM", escalateMs: 800, verifyMs: 600 });
      const outcome = await handle.done;
      assert.equal(outcome.state, "terminated", JSON.stringify(outcome));
      // execution evidence, not just the outcome object: AFTER the
      // terminated verdict (and the escalation that produced it) the
      // heartbeat must not advance further. Beats written during the
      // graceful window before escalation are legitimate and excluded.
      const settledAt = readFileSync(marker, "utf8").trim().split("\n").length;
      await sleep(1100);
      const after = readFileSync(marker, "utf8").trim().split("\n").length;
      assert.equal(after, settledAt, "work continued after terminated verdict");
      assert.equal(alive(child.pid), false);
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });

  it("reports incomplete — never silently successful — when a member survives escalation", { timeout: 20000 }, async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      const fakeKill = (pid, signal) => {
        if (pid === child.pid) {
          const e = new Error("Operation not permitted");
          e.code = "EPERM";
          throw e;
        }
        process.kill(pid, signal);
      };
      const handle = stopCohort(child.pid, { firstSignal: "SIGTERM", escalateMs: 300, verifyMs: 300, kill: fakeKill });
      const outcome = await handle.done;
      assert.equal(outcome.state, "incomplete");
      assert.ok(outcome.survivors.some((s) => s.pid === child.pid && /EPERM/.test(s.why)));
      assert.equal(alive(child.pid), true, "test premise: member actually survived");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });

  it("P1: a captured member whose stat becomes UNKNOWN before escalation is INCOMPLETE, never terminated, and never signalled again", { timeout: 20000 }, async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      const before = readStat(child.pid);
      assert.ok(before, "premise: readable at capture time");
      // inject: the child's stat reads UNKNOWN from the escalation phase on
      // (phase 1 runs synchronously with capture — identity was still valid
      // there, so the initial TERM is legitimate, matching the reviewer's
      // own probe evidence signals_delivered:[SIGTERM])
      let unknown = false;
      const probe = (pid) => {
        if (unknown && pid === child.pid) return { status: "unknown", error: "EACCES" };
        return probeProc(pid);
      };
      const killed = [];
      const kill = (pid, signal) => { killed.push(`${pid}:${signal}`); };
      const handle = stopCohort(child.pid, { firstSignal: "SIGTERM", escalateMs: 400, verifyMs: 300, kill, probe });
      setImmediate(() => (unknown = true)); // flips before escalation fires
      const outcome = await handle.done;
      // the P1 defect reported 'terminated' here while the child was alive
      assert.equal(outcome.state, "incomplete", JSON.stringify(outcome));
      assert.ok(outcome.survivors.some((s) => s.pid === child.pid && /identity-unknown/.test(s.why)));
      // conservative signalling: once unknown, NOTHING more targets the pid —
      // the only legitimate signal is the capture-time TERM
      const childSignals = killed.filter((k) => k.startsWith(`${child.pid}:`));
      assert.deepEqual(childSignals, [`${child.pid}:SIGTERM`], `unexpected signals: ${killed}`);
      assert.equal(alive(child.pid), true, "test premise: member actually survived");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });

  it("identity guards drive signalling: a member MISMATCHED before escalation is never escalated", { timeout: 20000 }, async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      const before = readStat(child.pid);
      // inject: from the escalation phase on, the child's starttime reads
      // DIFFERENT (reuse) — capture-time identity was valid, so the initial
      // TERM is legitimate; escalation must skip the reused identity
      let mismatch = false;
      const probe = (pid) => {
        if (mismatch && pid === child.pid) return { status: "present", stat: { ...before, starttime: String(Number(before.starttime) + 5) } };
        return probeProc(pid);
      };
      const killed = [];
      const kill = (pid, signal) => { killed.push(`${pid}:${signal}`); };
      const handle = stopCohort(child.pid, { firstSignal: "SIGTERM", escalateMs: 400, verifyMs: 300, kill, probe });
      setImmediate(() => (mismatch = true));
      const outcome = await handle.done;
      const childSignals = killed.filter((k) => k.startsWith(`${child.pid}:`));
      assert.deepEqual(childSignals, [`${child.pid}:SIGTERM`], `reused identity was escalated: ${killed}`);
      assert.equal(outcome.state, "terminated"); // nothing unverifiable remains
      assert.equal(alive(child.pid), true, "premise: child untouched (probe was injected)");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });

  it("P2: a ZOMBIE captured member is execution-terminated (unreaped), not a running survivor", { timeout: 20000 }, async () => {
    // manufactured deterministically with an injected probe (a node parent
    // cannot reliably keep a real zombie): the member is PRESENT, identity
    // matches, but its kernel state is Z
    const fakePid = 999996;
    let postEscalation = false;
    const captured = { pid: fakePid, ppid: process.pid, pgid: fakePid, state: "S", name: "tool", starttime: "424242" };
    const probe = (pid) => {
      if (pid !== fakePid) return { status: "absent" };
      if (!postEscalation) return { status: "present", stat: captured };
      return { status: "present", stat: { ...captured, state: "Z" } };
    };
    const killed = [];
    const handle = stopCohort(fakePid, {
      firstSignal: "SIGTERM", escalateMs: 200, verifyMs: 200,
      probe, kill: (pid, signal) => { killed.push(`${pid}:${signal}`); },
      delay: () => Promise.resolve(), // no real waiting needed
    });
    postEscalation = true;
    const outcome = await handle.done;
    assert.equal(outcome.state, "terminated", JSON.stringify(outcome));
    assert.equal(outcome.survivors?.length ?? 0, 0, "a zombie is not a running survivor");
    assert.ok(outcome.unreaped?.some((u) => u.pid === fakePid), "reaping outstanding must be recorded");
    assert.match(outcome.note ?? "", /reaping/);
    void killed;
  });

  it("P2: escalateNow() accelerates the terminal signal — no abandonment on a shortened window", { timeout: 20000 }, async () => {
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      const handle = stopCohort(child.pid, { firstSignal: "SIGTERM", escalateMs: 30_000, verifyMs: 500 });
      await sleep(400); // member observed the TERM and ignored it
      const t0 = Date.now();
      handle.escalateNow(); // what a shortened shutdown window must do
      const outcome = await handle.done;
      const elapsed = Date.now() - t0;
      assert.equal(outcome.state, "terminated", JSON.stringify(outcome));
      assert.ok(elapsed < 10_000, `escalation was not accelerated (took ${elapsed}ms)`);
      assert.equal(alive(child.pid), false);
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });
});
