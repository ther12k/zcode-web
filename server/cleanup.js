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
//  - IDENTITY CHECKS ARE BEST-EFFORT: read → compare → signal-numeric-pid
//    is NOT atomic; a process can exit and its pid be reused between
//    revalidation and the signal (Linux documents this; pidfd signalling is
//    the stable-reference alternative). What the gate DOES guarantee: any
//    target whose identity MISMATCH is observed at revalidation is skipped.
//  - UNCERTAINTY IS NEVER SUCCESS: a captured member whose /proc record
//    becomes unreadable or malformed is UNKNOWN at verification — it
//    contributes to INCOMPLETE, never to terminated (review finding, P1).
//    A zombie (state Z) is execution-terminated with reaping outstanding —
//    recorded separately, not as a running survivor (review finding, P2).
//  - ESCALATION IS ACCELERABLE: escalateNow() forces the terminal signal on
//    the captured cohort immediately (identity-checked, idempotent), so a
//    shortened shutdown window escalates instead of abandoning (P2).
// Claim this can make: "the captured, identity-validated descendants were
// terminated on the tested stop paths; ownership coverage is best effort" —
// never "every descendant is guaranteed dead" or "no job-created process
// remains anywhere." Permission failures and unknown identity are recorded
// as INCOMPLETE cleanup, never success, and the target set is never widened
// beyond the captured cohort.

import { readdirSync, readFileSync } from "node:fs";

/**
 * Tri-state /proc lookup. Read/parse failures are UNKNOWN — deliberately
 * distinct from ABSENT: at verification time, absent means "terminated",
 * unknown means "unresolved" (review P1: collapsing these produced false
 * cleanup success for live processes whose stat became unreadable).
 */
export function probeProc(pid) {
  let raw;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (e) {
    return e?.code === "ENOENT" ? { status: "absent" } : { status: "unknown", error: e?.code ?? "error" };
  }
  const st = parseStat(raw, pid);
  return st ? { status: "present", stat: st } : { status: "unknown", error: "malformed" };
}

/** Parse a /proc/<pid>/stat record (comm may contain spaces — split at the
 *  last ')'). Returns null when malformed. */
export function parseStat(raw, pid) {
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  const name = raw.slice(raw.indexOf("(") + 1, close);
  const f = raw.slice(close + 2).split(" ");
  // f[0]=state, f[1]=ppid, f[2]=pgid, f[19]=starttime (22nd overall field)
  const state = f[0];
  const ppid = Number(f[1]);
  const pgid = Number(f[2]);
  const starttime = f[19];
  if (!state || !Number.isFinite(ppid) || !Number.isFinite(pgid) || !starttime) return null;
  return { pid, ppid, pgid, state, name, starttime };
}

/** Legacy convenience wrapper: stat record or null (unknown collapses to
 *  null). stopCohort itself uses probeProc — never this collapse. */
export function readStat(pid) {
  const r = probeProc(pid);
  return r.status === "present" ? r.stat : null;
}

/** Currently-attributable cohort: rootPid plus every /proc descendant.
 *  Best-effort: UNKNOWN entries make enumerationIncomplete=true (a skipped
 *  potential descendant is unresolved, not clean); ABSENT entries are
 *  processes that died during enumeration — skippable, not unresolved. */
export function snapshotCohort(rootPid, probe = probeProc) {
  if (!rootPid) return { members: [], enumerationIncomplete: false };
  const all = new Map();
  let enumerationIncomplete = false;
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const r = probe(Number(entry));
      if (r.status === "absent") continue;
      if (r.status === "unknown") {
        enumerationIncomplete = true;
        continue;
      }
      all.set(r.stat.pid, r.stat);
    }
  } catch {
    return { members: [], enumerationIncomplete: true };
  }
  // the root itself may not have appeared in the scan (racing /proc, or an
  // injected probe): probe it explicitly so capture cannot silently miss it
  if (!all.has(rootPid)) {
    const r = probe(rootPid);
    if (r.status === "present") all.set(r.stat.pid, r.stat);
    else if (r.status === "unknown") return { members: [], enumerationIncomplete: true };
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

/**
 * Identity gate for signalling. True only when the process is PRESENT and
 * its starttime matches the captured identity. Absent, reused, malformed,
 * or unreadable → false: an unvalidated target is never signalled. (The
 * check and the signal remain non-atomic — best effort by design.)
 */
export function identityValid(member, probe = probeProc) {
  const r = probe(member.pid);
  return r.status === "present" && r.stat.starttime === member.starttime;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared stop-lifecycle body for cancel / timeout / shutdown. MUST run BEFORE
 * the caller's group signal (capture precedes the first signal so the
 * parent-child edges still exist). Returns a handle whose `done` promise
 * settles with the final cleanup outcome — separate from the job's
 * execution outcome, which the caller owns.
 *
 * handle.escalateNow() — idempotent, safe at any time: shortens the
 * pre-escalation grace to zero so the terminal SIGKILL pass runs
 * immediately. Shutdown uses this when its window shrinks (review P2: a
 * shortened deadline must escalate the captured cohort, not abandon it to
 * a timer that process.exit() will never let fire).
 */
export function stopCohort(rootPid, opts = {}) {
  const {
    firstSignal = "SIGTERM",
    escalateMs = 5000,
    verifyMs = 1200,
    kill = (pid, signal) => process.kill(pid, signal),
    delay = sleep,
    probe = probeProc,
  } = opts;
  const { members, enumerationIncomplete } = snapshotCohort(rootPid, probe);
  const handle = {
    members,
    outcome: rootPid ? { state: "pending" } : { state: "none" },
  };
  if (!rootPid) {
    handle.done = Promise.resolve(handle.outcome);
    return handle;
  }
  let fireEscalation = () => {};
  const escalationGate = new Promise((r) => (fireEscalation = r));
  handle.escalateNow = () => {
    try {
      fireEscalation();
    } catch {}
  };
  const survivors = [];
  const unreaped = [];
  handle.done = (async () => {
    // 1) request termination of each cohort member INDIVIDUALLY (the group
    //    signal covers same-group members; this reaches own-session tools).
    //    Unvalidated identities (absent/reused/unknown) are never signalled.
    for (const m of members) {
      if (!identityValid(m, probe)) continue;
      try {
        kill(m.pid, firstSignal);
      } catch (e) {
        if (e?.code === "ESRCH") continue; // died between capture and signal
        survivors.push({ pid: m.pid, name: m.name, why: `first-signal ${e?.code ?? "error"}` });
      }
    }
    // 2) escalation after the grace — OR immediately when escalateNow() is
    //    called (shutdown with a shortened window)
    await Promise.race([delay(escalateMs), escalationGate]);
    for (const m of members) {
      if (!identityValid(m, probe)) continue;
      try {
        kill(m.pid, "SIGKILL");
      } catch (e) {
        if (e?.code === "ESRCH") continue;
        survivors.push({ pid: m.pid, name: m.name, why: `escalation ${e?.code ?? "error"}` });
      }
    }
    // 3) verification with the tri-state lookup: absent = terminated;
    //    unknown = UNRESOLVED (incomplete — never success, review P1);
    //    present+reused = different process, skip; present+Z = execution
    //    terminated, reaping outstanding (recorded, not a survivor, P2);
    //    present+same-identity+running = real survivor.
    await delay(verifyMs);
    for (const m of members) {
      const r = probe(m.pid);
      if (r.status === "absent") continue; // terminated, confirmed gone
      if (r.status === "unknown") {
        survivors.push({ pid: m.pid, name: m.name, why: `identity-unknown-after-escalation (${r.error})` });
        continue;
      }
      if (r.stat.starttime !== m.starttime) continue; // pid reuse: different proc
      if (r.stat.state === "Z") {
        unreaped.push({ pid: m.pid, name: m.name, why: "terminated; reaping outstanding" });
        continue;
      }
      survivors.push({ pid: m.pid, name: m.name, why: "still-alive-after-escalation" });
    }
    handle.outcome =
      survivors.length === 0 && !enumerationIncomplete
        ? {
            state: "terminated",
            members,
            ...(unreaped.length
              ? { unreaped, note: "zombie entries: execution terminated; reaping is the parent's concern" }
              : {}),
          }
        : {
            state: "incomplete",
            survivors,
            ...(unreaped.length ? { unreaped } : {}),
            ...(enumerationIncomplete
              ? { note: "proc enumeration had unreadable entries — treated as unresolved" }
              : {}),
          };
    return handle.outcome;
  })();
  return handle;
}
