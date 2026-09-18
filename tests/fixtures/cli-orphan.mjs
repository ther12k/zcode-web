#!/usr/bin/env node
// ZWUI-086 fixture: a CLI that spawns a tool subprocess which IGNORES
// SIGTERM, then keeps the turn open. Cancellation must clean up the whole
// process group, not just this (cooperative) leader. The child's pid is
// written to $ORPHAN_PID_FILE so the test can assert its eventual death.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const promptIdx = args.indexOf("--prompt");
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : "";

const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
  stdio: "ignore",
});
if (process.env.ORPHAN_PID_FILE) writeFileSync(process.env.ORPHAN_PID_FILE, String(child.pid));

let seq = 0;
const emit = (type, payload = {}) => {
  seq += 1;
  process.stdout.write(JSON.stringify({ eventId: `orphan-${seq}`, payload, seq, sessionId: "sess_orphan_e2e_0000000000000000000000", timestamp: Date.now(), type }) + "\n");
};
const timer = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  emit("session.titleUpdated", { previousTitle: "", source: "first_input", title: prompt.slice(0, 40) });
  emit("turn.started", { turnNumber: 0, input: prompt });
  // no signal handler here: the leader dies on SIGTERM by default, the
  // orphaned tool child (same process group) is the leak under test
  await timer(30_000);
  emit("model.streaming", { assistantMessageId: "m1", delta: "", done: true, kind: "finish" });
  emit("turn.completed", { response: "done", usage: { totalTokens: 1 }, toolCallCount: 1 });
})();
