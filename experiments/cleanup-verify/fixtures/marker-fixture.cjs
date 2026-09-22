#!/usr/bin/env node
// Matrix tool fixture: long-running harmless command with identity telemetry.
// Marker lines (append-only):
//   start  <seq> <pid> ppid=<ppid> pgid=<pgid> sid=<sid> opts=<flags>
//   beat   <seq> <pid>
//   end    <seq> <pid>            (clean finish — cancellation must prevent it)
//   sigterm-ignored <pid>         (only when FIXTURE_IGNORE_SIGTERM=1)
// Variants (env):
//   FIXTURE_IGNORE_SIGTERM=1  install a no-op SIGTERM handler (the
//                             leader-exit / escalation probe shape)
//   FIXTURE_NEW_SESSION=1     request a new session; the HARNESS must launch
//                             this file via `setsid` — a separate cleanup case
//                             (kill(-parentPgid) can never reach it). The flag
//                             only LABELS the marker; it does not setsid here.
// Usage: marker-fixture.cjs <markerFile>
const { appendFileSync, readFileSync } = require("node:fs");

const markerFile = process.argv[2];
const BEAT_MS = Number(process.env.FIXTURE_BEAT_MS || 500);
if (!markerFile) { console.error("marker-fixture: need markerFile"); process.exit(2); }

const stat = readFileSync("/proc/self/stat", "utf8").split(" ");
const pid = stat[0], ppid = stat[3], pgid = stat[4], sid = stat[5];
const opts = [
  process.env.FIXTURE_IGNORE_SIGTERM === "1" ? "ignores-sigterm" : "",
  process.env.FIXTURE_NEW_SESSION === "1" ? "own-session" : "",
].filter(Boolean).join(",") || "plain";
if (process.env.FIXTURE_IGNORE_SIGTERM === "1")
  process.on("SIGTERM", () => { try { appendFileSync(markerFile, `sigterm-ignored ${process.pid}\n`); } catch {} });

let seq = 0;
const mark = (kind) => { try { appendFileSync(markerFile, `${kind} ${++seq} ${pid}\n`); } catch {} };
try { appendFileSync(markerFile, `start ${++seq} ${pid} ppid=${ppid} pgid=${pgid} sid=${sid} opts=${opts}\n`); } catch {}
const timer = setInterval(() => mark("beat"), BEAT_MS);
// run "forever" (until killed); default variant dies on SIGTERM without an end
setTimeout(() => {}, 1 << 30);
process.on("exit", () => { clearInterval(timer); });
