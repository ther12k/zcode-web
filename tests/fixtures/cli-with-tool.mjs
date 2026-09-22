#!/usr/bin/env node
// Fake CLI for cleanup regressions: spawns a "tool" that is an OWN-SESSION,
// SIGTERM-IGNORING process (the reproduced resistant class), then keeps the
// turn open until killed. The --prompt argument carries the marker file path
// (per-job markers without global env). Emits minimal stream-json events so
// the job registers. SIGTERM terminates this leader cooperatively — like the
// real CLI, whose prompt process dies on TERM while its tool may not.
const args = process.argv;
const i = args.indexOf("--prompt");
const marker = i >= 0 ? args[i + 1] : "";
import { spawn } from "node:child_process";
import path from "node:path";
const child = spawn("setsid", [process.execPath, path.join(path.dirname(new URL(import.meta.url).pathname), "marker-fixture.cjs"), marker], {
  env: { ...process.env, FIXTURE_IGNORE_SIGTERM: "1" },
  stdio: "ignore",
});
let seq = 0;
const emit = (type, payload = {}) =>
  process.stdout.write(JSON.stringify({ eventId: `t-${++seq}`, payload, seq, sessionId: "sess_cleanup_fixture_000000000000", timestamp: Date.now(), type }) + "\n");
emit("session.titleUpdated", { previousTitle: "", source: "first_input", title: "cleanup fixture" });
emit("turn.started", { turnNumber: 0, input: "run tool" });
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1 << 30); // hold the turn open
