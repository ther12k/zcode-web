#!/usr/bin/env node
// Fixture CLI for ZWUI-040: a run that handles SIGTERM gracefully and exits
// with code 0 AFTER being cancelled. The job must still terminate as
// "cancelled" — the cancellation contract must not derive status from the
// process exit code.
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  setTimeout(() => process.exit(0), 120);
});
const envelope = {
  eventId: "g1", payload: {}, seq: 1,
  sessionId: "sess_graceful_cancel_fixture",
  timestamp: Date.now(), traceId: "fixture", turnId: "turn_g", type: "turn.started",
};
process.stdout.write(JSON.stringify(envelope) + "\n");
setInterval(() => {
  if (stopping) return; // no further output; just wait for the deferred exit
}, 100);
