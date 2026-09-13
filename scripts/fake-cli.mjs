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
// a "slowfirst" token in the prompt delays the FIRST envelope (not just the
// answer delta): lets tests exercise the submit→first-event window
const firstDelay = /\bslowfirst\b/i.test(prompt) ? 5000 : 0;

// `skills list --json`: deterministic registry for the /api/skills endpoint
if (args[0] === "skills" && args[1] === "list") {
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(),
    diagnostics: [],
    skills: [
      { name: "fake-review", description: "Review this project and explain its structure.", directory: "/tmp/skills/fake-review", path: "/tmp/skills/fake-review/SKILL.md", rootPath: "/tmp/skills/fake-review", scope: "user/zcode", source: "user" },
      { name: "fake-deploy", description: "Deploy the project to the staging environment.", directory: "/tmp/skills/fake-deploy", path: "/tmp/skills/fake-deploy/SKILL.md", rootPath: "/tmp/skills/fake-deploy", scope: "user/agents", source: "user" },
      { name: "fake-design", description: "Refine the project's look and feel.", directory: "/tmp/skills/fake-design", path: "/tmp/skills/fake-design/SKILL.md", rootPath: "/tmp/skills/fake-design", scope: "system/plugin", source: "plugin" },
    ],
  }));
  process.exit(0);
}

// `commands list --json`: deterministic custom-command registry for
// /api/commands (the composer's "/" palette)
if (args[0] === "commands" && args[1] === "list") {
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(),
    diagnostics: [],
    totalDiscovered: 2,
    commands: [
      { name: "fake-ship", description: "Ship the current branch to staging.", path: "/tmp/.zcode/commands/fake-ship.md", rootPath: "/tmp/.zcode/commands", scope: "project", source: "zcode" },
      { name: "fake-audit", description: "Audit dependencies for known issues.", path: "/tmp/.zcode/commands/fake-audit.md", rootPath: "/tmp/.zcode/commands", scope: "user", source: "zcode" },
    ],
  }));
  process.exit(0);
}

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

const timer = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (firstDelay) await timer(firstDelay);
  emit("session.titleUpdated", { previousTitle: "", source: "first_input", title: prompt.slice(0, 40) });
  emit("turn.started", { turnNumber: 0, input: prompt });
  emit("session.updated", { model: "fake/model", modelRef: { providerId: "fake", modelId: "model" }, toolCount: 0 });
  emit("session.updated", { type: "model_request_started" });
  emit("model.streaming", { assistantMessageId: "m1", delta: "", done: false, kind: "start" });
  emit("model.streaming", { assistantMessageId: "m1", delta: "", done: false, kind: "reasoning_delta" });
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
