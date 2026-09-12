#!/usr/bin/env node
// ZWUI-023: fake CLI for backend/security regression tests.
// Emulates zcode.cjs stream-json output without any network or model access.
// Selected via ZCODE_CLI_ENTRY when tests start the server.
//
// Behavior contract (mirrors docs/baseline/sse-samples.jsonl):
//   - prints a titleUpdated event, turn.started, model_request_started,
//     a couple of model.streaming deltas, turn.completed
//   - env FAKE_MODE selects failure paths: "fail" (turn.failed + exit 1),
//     "slow" (streams for N ms then completes; N = FAKE_DELAY_MS)
//   - echoes the prompt text into an assistant delta (asserts --prompt and
//     --attach pass-through)

const args = process.argv.slice(2);
const promptIdx = args.indexOf("--prompt");
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : "";
const mode = process.env.FAKE_MODE || "ok";
const delay = Number(process.env.FAKE_DELAY_MS || 0);

let seq = 0;
function emit(type, payload = {}) {
  seq += 1;
  process.stdout.write(
    JSON.stringify({
      eventId: `fake-${seq}`,
      payload,
      seq,
      sessionId: "sess_fake0000000000000000000000000000",
      timestamp: Date.now(),
      traceId: "fake-trace",
      turnId: "turn_fake",
      type,
    }) + "\n"
  );
}

emit("session.titleUpdated", { previousTitle: "", source: "first_input", title: prompt.slice(0, 40) });
emit("turn.started", { turnNumber: 0, input: prompt });
emit("session.updated", { model: "fake/model", modelRef: { providerId: "fake", modelId: "model" }, toolCount: 0 });
emit("session.updated", { type: "model_request_started" });
emit("model.streaming", { assistantMessageId: "m1", delta: "", done: false, kind: "start" });
emit("model.streaming", { assistantMessageId: "m1", delta: "", done: false, kind: "reasoning_delta" });

const timer = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (delay) await timer(delay);
  emit("model.streaming", { assistantMessageId: "m1", delta: `echo:${prompt}`, done: false, kind: "text_delta" });
  if (mode === "fail") {
    emit("session.updated", { type: "model_request_failed" });
    emit("turn.failed", { error: { type: "unknown_error", message: "fake failure" }, turnPhase: "processing_input" });
    process.exit(1);
  }
  emit("model.streaming", { assistantMessageId: "m1", delta: "", done: true, kind: "finish" });
  emit("turn.completed", { response: `echo:${prompt}`, usage: { totalTokens: 10 }, toolCallCount: 0 });
  process.exit(0);
})();
