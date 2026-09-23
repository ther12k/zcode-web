// Scoped descendant cleanup for owned CLI jobs.
//
// Why this exists (inv/cleanup-verify, 2026-09-22): the CLI's prompt-mode
// tools run as their OWN session leaders (pgid = sid = own pid), so no
// process-GROUP signal — the SIGTERM escalation or the timeout SIGKILL — can
// reach them. Ordinary tools only die because the CLI TERMs them directly; a
// tool that ignores SIGTERM in its own session survives every group signal
// the server sends. This module adds a scoped, identity-checked fallback:
//
//   stopCohort(rootPid) → capture descendants BEFORE the first signal,
//   request individual termination, later SIGKILL identity-validated
//   survivors, then verify and report honestly.
//
// Honest boundaries (by design):
//  - SNAPSHOT SCOPE: a periodic /proc snapshot can miss processes created
//    after enumeration, or already outside the job descendant tree when
//    captured (e.g. a shell-setsid tool orphaned to systemd at creation) —
//    stop-time enumeration cannot attribute those.
//  - IDENTITY CHECKS ARE BEST-EFFORT: read-stat → compare → signal-numeric-
//    pid is NOT atomic; a process can exit and its pid be reused between
//    revalidation and the signal (Linux documents this; pidfd signalling is
//    the stable-reference alternative). What the gate DOES guarantee: any
//    target whose identity MISMATCH is observed at revalidation is skipped.
// Claim this can make: "the captured, identity-validated descendants were
// terminated on the tested stop paths; ownership coverage is best effort" —
// never "every descendant is guaranteed dead" or "no job-created process
// remains anywhere." Unreadable identity and permission failures are
// recorded as INCOMPLETE cleanup, never success, and the target set is never
// widened beyond the captured cohort.

import { readdirSync, readFileSync } from "node:fs";

/** Parse /proc/<pid>/stat defensively (comm may contain spaces — split at the
 *  last ')'). Returns null when unreadable/malformed: unreadable identity is
 *  UNKNOWN, never "dead". starttime = field 22 (detects pid reuse). */
export function readStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close < 0) return null;
    const name = raw.slice(raw.indexOf("(") + 1, close);
    const f = raw.slice(close + 2).split(" ");
    // f[0]=state, f[1]=ppid, f[2]=pgid, f[19]=starttime (22nd overall field)
    const ppid = Number(f[1]);
    const pgid = Number(f[2]);
    const starttime = f[19];
    if (!Number.isFinite(ppid) || !Number.isFinite(pgid) || !starttime) return null;
    return { pid, ppid, pgid, name, starttime };
  } catch {
    return null;
  }
}

/** Currently-attributable cohort: rootPid plus every /proc descendant.
 *  Best-effort: unreadable entries make enumerationIncomplete=true (a
 *  skipped potential descendant is unresolved, not clean). */
export function snapshotCohort(rootPid) {
  if (!rootPid) return { members: [], enumerationIncomplete: false };
  const all = new Map();
  let enumerationIncomplete = false;
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const st = readStat(Number(entry));
      if (!st) {
        enumerationIncomplete = true;
        continue;
      }
      all.set(st.pid, st);
    }
  } catch {
    return { members: [], enumerationIncomplete: true };
  }
  const root = all.get(rootPid);
  const members = root ? [root] : [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length) {
    const cur = queue.shift();
    for (const st of all.values()) {
      if (st.ppid === cur && !seen.has(st.pid)) {
        seen.add(st.pid);
        members.push(st);
        queue.push(st.pid);
      }
    }
  }
  return { members, enumerationIncomplete };
}

/** True only when pid is alive AND starttime matches the captured identity.
 *  Pid reuse (mismatch) or unreadable → false: NEVER signal in that case. */
export function identityValid(member) {
  const st = readStat(member.pid);
  return st !== null && st.starttime === member.starttime;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared stop-lifecycle body for cancel / timeout / shutdown. MUST run BEFORE
 * the caller's group signal (capture precedes the first signal so the
 * parent-child edges still exist). Returns a handle whose `done` promise
 * settles with the final cleanup outcome — separate from the job's
 * execution outcome, which the caller owns.
 */
export function stopCohort(rootPid, opts = {}) {
  const {
    firstSignal = "SIGTERM",
    escalateMs = 5000,
    verifyMs = 1200,
    kill = (pid, signal) => process.kill(pid, signal),
    delay = sleep,
  } = opts;
  const { members, enumerationIncomplete } = snapshotCohort(rootPid);
  const handle = {
    members,
    outcome: rootPid ? { state: "pending" } : { state: "none" },
  };
  if (!rootPid) {
    handle.done = Promise.resolve(handle.outcome);
    return handle;
  }
  const survivors = [];
  handle.done = (async () => {
    // 1) request termination of each cohort member INDIVIDUALLY (the group
    //    signal covers same-group members; this reaches own-session tools)
    for (const m of members) {
      if (!identityValid(m)) continue; // gone or pid reuse — nothing to ask
      try {
        kill(m.pid, firstSignal);
      } catch (e) {
        if (e?.code === "ESRCH") continue; // died between capture and signal
        survivors.push({ pid: m.pid, name: m.name, why: `first-signal ${e?.code ?? "error"}` });
      }
    }
    // 2) escalation: targeted SIGKILL against identity-validated members
    await delay(escalateMs);
    for (const m of members) {
      if (!identityValid(m)) continue;
      try {
        kill(m.pid, "SIGKILL");
      } catch (e) {
        if (e?.code === "ESRCH") continue;
        survivors.push({ pid: m.pid, name: m.name, why: `escalation ${e?.code ?? "error"}` });
      }
    }
    // 3) verification: every captured member must be dead or identity-invalid
    await delay(verifyMs);
    for (const m of members) {
      const st = readStat(m.pid);
      if (st === null) continue; // gone
      if (st.starttime !== m.starttime) continue; // pid reuse: different proc
      survivors.push({ pid: m.pid, name: m.name, why: "still-alive-after-escalation" });
    }
    handle.outcome =
      survivors.length === 0 && !enumerationIncomplete
        ? { state: "terminated", members }
        : {
            state: "incomplete",
            survivors,
            ...(enumerationIncomplete
              ? { note: "proc enumeration had unreadable entries — treated as unresolved" }
              : {}),
          };
    return handle.outcome;
  })();
  return handle;
}
