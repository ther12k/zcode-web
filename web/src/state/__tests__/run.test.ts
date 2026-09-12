// ZWUI-016 reducer tests: state ownership rules are enforced by construction.
import { describe, it, expect } from "vitest";
import { runReducer, initialRun, isTerminal } from "../run";

const line = (n: number, type: string, payload: Record<string, unknown> = {}) => ({
  id: n, kind: "line" as const, line: { type, payload },
});

describe("run reducer", () => {
  it("submit → accepted → running", () => {
    let r = runReducer(initialRun(), { type: "submit", requestId: "r1" });
    expect(r.phase).toBe("submitting");
    r = runReducer(r, { type: "accepted", jobId: "j1", sessionId: null });
    expect(r.phase).toBe("queued");
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    expect(r.phase).toBe("running");
  });

  it("text deltas accumulate into answer; reasoning separately", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
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
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
    r = runReducer(r, { type: "events", events: [line(2, "turn.started")] });
    const before = r.events.length;
    r = runReducer(r, { type: "events", events: [line(1, "session.titleUpdated", { title: "old" })] });
    expect(r.events.length).toBe(before); // stale event dropped
  });

  it("stream detach does NOT finalize the run (disconnect ≠ completion)", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
    r = runReducer(r, { type: "events", events: [line(1, "turn.started")] });
    r = runReducer(r, { type: "stream-detached" });
    expect(isTerminal(r.phase)).toBe(false);
    expect(r.streamAttached).toBe(false);
  });

  it("only done/timeout events or terminal job-status finalize", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
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

  it("terminal states are immutable — late events cannot resurrect a run", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
    r = runReducer(r, {
      type: "events",
      events: [{ id: 1, kind: "done", exitCode: 0, error: null }],
    });
    expect(r.phase).toBe("succeeded");
    r = runReducer(r, { type: "events", events: [line(2, "turn.started")] });
    r = runReducer(r, { type: "job-status", status: "running" });
    expect(r.phase).toBe("succeeded");
  });

  it("turn.completed backfills answer when no text streamed", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
    r = runReducer(r, {
      type: "events",
      events: [line(1, "turn.completed", { response: "final answer" })],
    });
    expect(r.answer).toBe("final answer");
  });

  it("job-status reconciles queued→running but never invents success", () => {
    let r = runReducer(initialRun(), { type: "accepted", jobId: "j1", sessionId: null });
    r = runReducer(r, { type: "job-status", status: "running" });
    expect(r.phase).toBe("running");
    // a hypothetical "tests passed" badge is NOT derivable from process exit:
    r = runReducer(r, { type: "job-status", status: "succeeded" });
    expect(r.answer).toBe(""); // no invented content
  });
});
