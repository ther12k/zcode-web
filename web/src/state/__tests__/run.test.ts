// ZWUI-016 reducer tests: state ownership rules are enforced by construction.
import { describe, it, expect } from "vitest";
import { runReducer, initialRun, isTerminal } from "../run";

const line = (n: number, type: string, payload: Record<string, unknown> = {}) => ({
  id: n, kind: "line" as const, line: { type, payload },
});
const withJob = () => {
  let r = runReducer(initialRun(), { type: "submit", requestId: "r1" });
  return runReducer(r, { type: "accepted", jobId: "j1", sessionId: null });
};

describe("run reducer", () => {
  it("submit → accepted → running", () => {
    let r = runReducer(initialRun(), { type: "submit", requestId: "r1" });
    expect(r.phase).toBe("submitting");
    r = runReducer(r, { type: "accepted", jobId: "j1", sessionId: null });
    expect(r.phase).toBe("queued");
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    expect(r.phase).toBe("running");
  });

  it("the sent prompt echoes until the transcript commits it", () => {
    let r = runReducer(initialRun(), { type: "submit", requestId: "r1", text: "fix the login bug" });
    // echo is live immediately, before any event arrives
    expect(r.submittedText).toBe("fix the login bug");
    expect(r.submittedAt).toBeGreaterThan(0);
    r = runReducer(r, { type: "accepted", jobId: "j1", sessionId: "sess_echo" });
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    expect(r.submittedText).toBe("fix the login bug");
    // terminal without the committed turn in history: echo stays (UI decides via createdAt)
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "succeeded" });
    expect(r.submittedText).toBe("fix the login bug");
    // reset (detach/new chat) clears the echo
    r = runReducer(r, { type: "reset" });
    expect(r.submittedText).toBe("");
    expect(r.submittedAt).toBe(0);
  });

  it("text deltas accumulate into answer; reasoning separately", () => {
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [
        line(1, "model.streaming", { kind: "reasoning_delta", delta: "think " }),
        line(2, "model.streaming", { kind: "reasoning_delta", delta: "more" }),
        line(3, "model.streaming", { kind: "text_delta", delta: "ans" }),
        line(4, "model.streaming", { kind: "text_delta", delta: "wer" }),
      ],
    });
    expect(r.reasoning).toBe("think more");
    expect(r.answer).toBe("answer");
  });

  it("ignores duplicate/out-of-order event ids (idempotent store)", () => {
    let r = withJob();
    r = runReducer(r, { type: "events", events: [line(2, "turn.started")] });
    const before = r.events.length;
    r = runReducer(r, { type: "events", events: [line(1, "session.titleUpdated", { title: "old" })] });
    expect(r.events.length).toBe(before); // stale event dropped
  });

  it("stream detach does NOT finalize the run (disconnect ≠ completion)", () => {
    let r = withJob();
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    r = runReducer(r, { type: "stream-detached" });
    expect(isTerminal(r.phase)).toBe(false);
    expect(r.streamAttached).toBe(false);
  });

  it("stream-lost keeps existing output and awaits job-status reconciliation", () => {
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [
        line(1, "turn.started"),
        line(2, "model.streaming", { kind: "text_delta", delta: "partial answer" }),
      ],
    });
    r = runReducer(r, { type: "stream-attached" });
    expect(r.streamAttached).toBe(true);
    r = runReducer(r, { type: "stream-lost", error: "stream lost after repeated reconnects" });
    expect(isTerminal(r.phase)).toBe(false);
    expect(r.phase).toBe("running");
    expect(r.answer).toBe("partial answer");
    expect(r.streamAttached).toBe(false);
    // the detached-transport flag drives the "work may still be running" UI
    expect(r.transportLost).toBe(true);
    // reconciliation sets the true terminal state
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "succeeded" });
    expect(r.phase).toBe("succeeded");
    expect(r.answer).toBe("partial answer");
  });

  it("a reconnect after transport loss clears transportLost", () => {
    let r = withJob();
    r = runReducer(r, { type: "stream-lost", error: "stream lost" });
    expect(r.transportLost).toBe(true);
    r = runReducer(r, { type: "stream-attached" });
    expect(r.transportLost).toBe(false);
    expect(r.streamAttached).toBe(true);
  });

  it("stream-detached (single reconnect) does not set transportLost", () => {
    let r = withJob();
    r = runReducer(r, { type: "stream-attached" });
    r = runReducer(r, { type: "stream-detached" });
    expect(r.streamAttached).toBe(false);
    expect(r.transportLost).toBe(false);
  });

  it("only done/timeout events or terminal job-status finalize", () => {
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [
        { id: 1, kind: "line", line: { type: "turn.failed", payload: { error: { message: "quota" } } } },
      ],
    });
    // turn.failed alone: error shown, but phase comes from done/status
    expect(isTerminal(r.phase)).toBe(false);
    r = runReducer(r, {
      type: "events",
      events: [{ id: 2, kind: "done", exitCode: 1, error: null }],
    });
    expect(r.phase).toBe("failed");
  });

  it("ZWUI-040: an authoritative done status wins over exitCode derivation", () => {
    // a cancelled run closes with exitCode null — the legacy derivation read
    // that as "failed"
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [{ id: 1, kind: "done", exitCode: null, error: null, status: "cancelled", cancelRequested: true }],
    });
    expect(r.phase).toBe("cancelled");
    expect(r.error).toBeNull();

    // a graceful exit(0) after cancellation is still cancelled — never a
    // false "succeeded"
    r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [{ id: 1, kind: "done", exitCode: 0, error: null, status: "cancelled", cancelRequested: true }],
    });
    expect(r.phase).toBe("cancelled");

    // a kill signal after timeout is timeout, not a plain failure
    r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [{ id: 1, kind: "done", exitCode: null, error: null, status: "timeout", timedOut: true }],
    });
    expect(r.phase).toBe("timeout");
  });

  it("done without an authoritative status still derives from exitCode (pre-contract server)", () => {
    let r = withJob();
    r = runReducer(r, { type: "events", events: [{ id: 1, kind: "done", exitCode: 0, error: null }] });
    expect(r.phase).toBe("succeeded");
    r = withJob();
    r = runReducer(r, { type: "events", events: [{ id: 1, kind: "done", exitCode: null, error: null }] });
    expect(r.phase).toBe("failed");
  });

  it("terminal states are immutable — late events cannot resurrect a run", () => {
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [{ id: 1, kind: "done", exitCode: 0, error: null }],
    });
    expect(r.phase).toBe("succeeded");
    r = runReducer(r, { type: "events", events: [line(2, "turn.started")] });
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "running" });
    expect(r.phase).toBe("succeeded");
  });

  it("turn.completed backfills answer when no text streamed", () => {
    let r = withJob();
    r = runReducer(r, {
      type: "events",
      events: [line(1, "turn.completed", { response: "final answer" })],
    });
    expect(r.answer).toBe("final answer");
  });

  it("job-status reconciles queued→running but never invents success", () => {
    let r = withJob();
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "running" });
    expect(r.phase).toBe("running");
    // a hypothetical "tests passed" badge is NOT derivable from process exit:
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "succeeded" });
    expect(r.answer).toBe(""); // no invented content
  });

  it("ZWUI-042: a late status response for ANOTHER job never applies", () => {
    // A's status request was in flight when the user switched to B; when it
    // lands, the run attached to the view is B's — it must stay untouched
    let r = withJob(); // this run is job j1
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    r = runReducer(r, { type: "job-status", jobId: "j-other", status: "succeeded" });
    expect(r.phase).toBe("running");
    r = runReducer(r, { type: "job-status", jobId: "j-other", status: "failed" });
    expect(r.phase).toBe("running");
  });

  it("job-status without an attached job is ignored", () => {
    let r = runReducer(initialRun(), { type: "submit", requestId: "r1" });
    r = runReducer(r, { type: "job-status", jobId: "j1", status: "succeeded" });
    expect(r.phase).toBe("submitting");
  });

  it("submit-failed marks delivery ambiguity; accepted/submit clears it", () => {
    let r = withJob();
    r = runReducer(r, { type: "submit", requestId: "r2", text: "hello" });
    r = runReducer(r, { type: "submit-failed", error: "network dropped" });
    expect(r.phase).toBe("failed");
    expect(r.submitFailed).toBe(true);
    expect(r.submittedText).toBe("hello"); // echo retained for retry UX
    // a successful submit of the next prompt starts clean
    r = runReducer(r, { type: "submit", requestId: "r3", text: "next" });
    expect(r.submitFailed).toBe(false);
    // and acceptance clears it too (replayed adoption after retry)
    r = runReducer(r, { type: "submit", requestId: "r4", text: "next" });
    r = runReducer(r, { type: "submit-failed", error: "boom" });
    r = runReducer(r, { type: "accepted", jobId: "j2", sessionId: null });
    expect(r.submitFailed).toBe(false);
    expect(r.phase).toBe("queued");
  });
});
