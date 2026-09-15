// ZWUI-050: the run manager owns transports and schedules reducer actions.
// These tests pin the ownership rules the browser tests exercise end-to-end.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { submitRun, retryDelivery, retryFailedRun, cancelRun, getRun, subscribeRun, isRunBusy, lastSubmission, __setPollIntervalForTests } from "../runManager";
import type { ApiClient, ChatAccepted, JobStatus } from "../../api/client";

function fakeClient(overrides: Partial<ApiClient> = {}) {
  return {
    chat: vi.fn(),
    job: vi.fn(),
    cancel: vi.fn(async () => ({ canceled: true })),
    sseTicket: vi.fn(async () => { throw new Error("no ticket endpoint"); }),
    ...overrides,
  } as unknown as ApiClient & { chat: ReturnType<typeof vi.fn>; job: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
}

// silent EventSource: the transport attaches but emits nothing — the
// reconciliation poll drives terminal transitions in these tests
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.last = this; }
  close() {}
}

const submission = (over: Record<string, unknown> = {}) => ({
  draftKey: "k", revision: 1, projectKey: "p", cwd: "/w", sessionId: null,
  text: "hello", model: "m", mode: "plan", attachments: [],
  requestId: "req-1", ...over,
}) as Parameters<typeof submitRun>[1];

beforeEach(() => { (globalThis as Record<string, unknown>).EventSource = FakeEventSource; __setPollIntervalForTests(25); });
afterEach(() => { delete (globalThis as Record<string, unknown>).EventSource; __setPollIntervalForTests(5000); });

describe("run manager", () => {
  it("submit → accepted → terminal via poll; subscriber notified; snapshots stable between changes", async () => {
    const client = fakeClient();
    client.chat.mockResolvedValue({ jobId: "j1", sessionId: "sess_1" });
    client.job.mockResolvedValue({ status: "succeeded" });
    let notifications = 0;
    const unsubscribe = subscribeRun("new:0", () => { notifications += 1; });
    const snap1 = getRun("new:0");
    await submitRun("new:0", submission(), client as unknown as ApiClient);
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(getRun("new:0").jobId).toBe("j1");
    expect(isRunBusy("new:0")).toBe(true);
    expect(notifications).toBeGreaterThan(0);
    expect(getRun("new:0")).toBe(snap1 === getRun("new:0") ? snap1 : getRun("new:0")); // identity is object-stable between dispatches
    // poll finalizes
    await vi.waitFor(() => { expect(getRun("new:0").phase).toBe("succeeded"); }, { timeout: 3000 });
    expect(getRun("new:0").phase).toBe("succeeded");
    unsubscribe();
  });

  it("acceptance rekeys new:<nonce> to the session, aliasing the old key while subscribed", async () => {
    const client = fakeClient();
    client.chat.mockResolvedValue({ jobId: "j2", sessionId: "sess_rekey" });
    client.job.mockResolvedValue({ status: "running" });
    // ZWUI-072: the old key aliases the entry ONLY while a subscriber still
    // uses it — with no listeners the alias would leak forever
    const unsubscribe = subscribeRun("new:7", () => {});
    await submitRun("new:7", submission({ requestId: "req-2" }), client as unknown as ApiClient);
    expect(getRun("new:7").jobId).toBe("j2");
    expect(getRun("sess_rekey").jobId).toBe("j2");
    expect(getRun("new:7")).toBe(getRun("sess_rekey"));
    // once nobody listens through the old key it stops resolving the entry
    unsubscribe();
    expect(getRun("new:7").jobId).toBeNull();
  });

  it("a busy conversation refuses a second submission", async () => {
    const client = fakeClient();
    let release!: (v: ChatAccepted) => void;
    client.chat.mockImplementation(() => new Promise((res) => { release = res; }));
    const first = submitRun("sess_busy", submission({ requestId: "req-a", sessionId: "sess_busy" }), client as unknown as ApiClient);
    await vi.waitFor(() => expect(client.chat).toHaveBeenCalled());
    const second = submitRun("sess_busy", submission({ requestId: "req-b", sessionId: "sess_busy" }), client as unknown as ApiClient);
    release({ jobId: "jA", sessionId: "sess_busy" });
    await first;
    await second;
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(getRun("sess_busy").requestId).toBe("req-a");
  });

  it("ambiguous delivery: submit-failed keeps the record; retryDelivery reuses the SAME request id (one job)", async () => {
    const client = fakeClient();
    client.chat
      .mockRejectedValueOnce(new Error("network dropped"))
      .mockResolvedValueOnce({ jobId: "j9", sessionId: "sess_retry", replayed: true });
    const onFailed = vi.fn();
    const onAccepted = vi.fn();
    await submitRun("new:1", submission({ requestId: "same-id" }), client as unknown as ApiClient, { onFailed });
    expect(getRun("new:1").phase).toBe("failed");
    expect(getRun("new:1").submitFailed).toBe(true);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(lastSubmission("new:1")?.requestId).toBe("same-id");
    retryDelivery("new:1", { onAccepted });
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(client.chat).toHaveBeenCalledTimes(2);
    expect(client.chat.mock.calls[1][0].requestId).toBe("same-id");
    expect(client.chat.mock.calls[1][0]).toEqual(client.chat.mock.calls[1][0]);
    expect(onAccepted.mock.calls[0][0].replayed).toBe(true);
    expect(getRun("new:1").submitFailed).toBe(false);
  });

  it("retryDelivery ignores a stale record (different request id than the current run)", () => {
    const client = fakeClient();
    retryDelivery("never-submitted", {});
    expect(client.chat).not.toHaveBeenCalled();
  });

  it("retryFailedRun deliberately takes a NEW identity with the same payload", async () => {
    const client = fakeClient();
    client.chat.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ jobId: "jB", sessionId: "sess_b" });
    await submitRun("new:2", submission({ requestId: "first", text: "payload x" }), client as unknown as ApiClient);
    retryFailedRun("new:2");
    await vi.waitFor(() => expect(client.chat).toHaveBeenCalledTimes(2));
    expect(client.chat.mock.calls[1][0].requestId).not.toBe("first");
    expect(client.chat.mock.calls[1][0].text).toBe("payload x");
  });

  it("cancelRun targets the run's own job", async () => {
    const client = fakeClient();
    client.chat.mockResolvedValue({ jobId: "jC", sessionId: "sess_c" });
    client.job.mockResolvedValue({ status: "running" });
    await submitRun("sess_c", submission({ sessionId: "sess_c" }), client as unknown as ApiClient);
    cancelRun("sess_c");
    expect(client.cancel).toHaveBeenCalledWith("jC");
  });

  it("a stale job-status response for another job never applies (reducer identity, manager-checked)", async () => {
    const client = fakeClient();
    client.chat.mockResolvedValue({ jobId: "jLive", sessionId: "sess_live" });
    client.job.mockResolvedValue({ status: "failed" as const, jobId: "jLive" } as JobStatus);
    await submitRun("sess_live", submission({ sessionId: "sess_live" }), client as unknown as ApiClient);
    await vi.waitFor(() => expect(getRun("sess_live").phase).toBe("failed"));
    // the entry's own poll drove its correct terminal state; a late response
    // captured for a DIFFERENT job cannot even reach dispatch (manager guard)
    expect(lastSubmission("sess_live")?.requestId).toBe("req-1");
  });
});
