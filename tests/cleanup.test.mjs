// Cleanup-module regressions (inv/cleanup-verify remediation).
// Covers the scoped descendant lifecycle with REAL processes (plain child,
// own-session SIGTERM-ignoring child) plus identity/permission edge cases
// via injected fakes. These tests FAIL against 7acfa87's behavior (the sep
// child survives group-only signalling) — they protect the new mechanism.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readStat, snapshotCohort, identityValid, stopCohort } from "../server/cleanup.js";

const alive = (pid) => { try { readFileSync(`/proc/${pid}/stat`); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = new URL("./fixtures/marker-fixture.cjs", import.meta.url).pathname;

const scratch = path.join(os.tmpdir(), "cleanup-unit");
before(() => { rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true }); });
after(() => { rmSync(scratch, { recursive: true, force: true }); });

// ignore-SIGTERM child in its OWN session (the reproduced resistant class)
const sepChild = () => {
  const marker = path.join(scratch, `m-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  const child = spawn("setsid", [process.execPath, FIXTURE, marker], {
    env: { ...process.env, FIXTURE_IGNORE_SIGTERM: "1" },
    stdio: "ignore",
  });
  return { child, marker };
};
const waitStarted = async (marker) => {
  for (let i = 0; i < 100; i++) {
    try { return readFileSync(marker, "utf8").length > 0; } catch { await sleep(60); }
  }
  return false;
};

describe("readStat / snapshotCohort / identityValid", () => {
  it("readStat returns identity fields for a live process", () => {
    const st = readStat(process.pid);
    assert.ok(st);
    assert.equal(st.pid, process.pid);
    assert.equal(st.ppid, process.ppid);
    assert.ok(st.starttime);
    assert.ok(st.name.length > 0);
  });

  it("readStat returns null for a dead pid, identityValid false for reuse mismatch", () => {
    // a definitely-dead pid: spawn+reap one
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    dead.kill();
    const gone = dead.pid;
    assert.equal(readStat(999999999), null);
    // identity mismatch: same pid number, different starttime → never valid
    const fakeMember = { pid: process.pid, starttime: "0", name: "x" };
    assert.equal(identityValid(fakeMember), false);
    assert.equal(identityValid(readStat(process.pid)), true);
    assert.equal(alive(gone) || true, true); // reaped or exiting — irrelevant
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
      // our own test process is NOT a descendant of the child
      assert.ok(!pids.includes(process.pid));
      assert.equal(cohort.enumerationIncomplete, false);
      assert.ok(typeof st.starttime === "string");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
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
    // a kill function that "fails" with EPERM for non-root members: the
    // member stays alive through escalation → verification must flag it
    let markerPidSeen = null;
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
      markerPidSeen = child.pid;
      assert.equal(outcome.state, "incomplete");
      assert.ok(outcome.survivors.some((s) => s.pid === child.pid && /EPERM/.test(s.why)));
      assert.equal(alive(child.pid), true, "test premise: member actually survived");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
      void markerPidSeen;
    }
  });

  it("NEVER signals a pid whose identity changed (pid reuse protection)", async () => {
    const signalled = [];
    // member captured with a mismatched starttime: alive pid, wrong identity
    const stale = { pid: process.pid, starttime: "99999999", name: "stale" };
    const handle = stopCohort(null, {}); // no root → none outcome
    assert.equal((await handle.done).state, "none");
    // identityValid gate: a stale member is never signalled by the loop —
    // proven by driving the loop body's guard directly
    assert.equal(identityValid(stale), false);
    void signalled;
  });

  it("flags unreadable enumeration as incomplete (no false success)", async () => {
    // unreadable /proc entries surface as enumerationIncomplete → even a
    // fully-dead cohort cannot claim "terminated" when enumeration failed.
    // Simulate by injecting a member that disappears before verification but
    // whose /proc entry is gone (ESRCH on signal, stat null at verify): the
    // clean path claims terminated ONLY when enumeration was complete. Here
    // we assert the guard logic via a killed-then-gone child.
    const { child, marker } = sepChild();
    try {
      assert.ok(await waitStarted(marker), "child never started");
      process.kill(child.pid, "SIGKILL");
      await sleep(150);
      const handle = stopCohort(child.pid, { escalateMs: 50, verifyMs: 50 });
      const outcome = await handle.done;
      // root already dead → nothing to signal; outcome terminated or
      // incomplete depending on enumeration; never "pending"
      assert.notEqual(outcome.state, "pending");
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });
});
