// ZWUI-058: ticketed SSE transport — the only live wire to a running job.
// Pinned behaviors: ticket exchange, Last-Event-ID resume, ticket-expired
// rotation, done/timeout finalizes the transport, bounded reconnect backoff.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StreamController, type StreamCallbacks } from "../stream";
import type { ApiClient } from "../../api/client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() { FakeEventSource.instances = []; }
  url: string;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }); }
  fail() { this.onerror?.(); }
}

function makeClient(ticketFailures = 0) {
  let tickets = 0;
  return {
    sseTicket: async () => {
      if (tickets++ < ticketFailures) throw new Error("no ticket endpoint");
      return `TKT${tickets}`;
    },
  } as unknown as ApiClient;
}

function makeCallbacks() {
  const seen: { events: unknown[]; attached: number; detached: string[]; fatal: string[] } = {
    events: [], attached: 0, detached: [], fatal: [],
  };
  const cb: StreamCallbacks = {
    onEvents: (events) => seen.events.push(...events),
    onAttached: () => { seen.attached += 1; },
    onDetached: (reason) => { seen.detached.push(reason); },
    onFatal: (message) => { seen.fatal.push(message); },
  };
  return { cb, seen };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.reset();
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("StreamController", () => {
  it("attaches with a ticketed URL and streams parsed events", async () => {
    const { cb, seen } = makeCallbacks();
    const s = new StreamController(makeClient(), "job-1", cb);
    s.start();
    await flush();
    expect(seen.attached).toBe(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events/job-1?ticket=TKT1");
    FakeEventSource.instances[0].emit({ kind: "agent", id: 1, text: "hi" });
    expect(seen.events).toEqual([{ kind: "agent", id: 1, text: "hi" }]);
    s.close();
  });

  it("falls back to a bearer URL when the ticket endpoint fails", async () => {
    const { cb } = makeCallbacks();
    const s = new StreamController(makeClient(1), "job-1", cb);
    s.start();
    await flush();
    expect(FakeEventSource.instances[0].url).toBe("/api/events/job-1");
    s.close();
  });

  it("closes the transport on done (disconnect ≠ completion, done is)", async () => {
    const { cb, seen } = makeCallbacks();
    const s = new StreamController(makeClient(), "job-1", cb);
    s.start();
    await flush();
    FakeEventSource.instances[0].emit({ kind: "done", status: "succeeded" });
    expect(s.attached).toBe(false);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(seen.events).toHaveLength(1);
  });

  it("ignores malformed JSON instead of crashing the stream", async () => {
    const { cb, seen } = makeCallbacks();
    const s = new StreamController(makeClient(), "job-1", cb);
    s.start();
    await flush();
    FakeEventSource.instances[0].emit("{{not json");
    FakeEventSource.instances[0].emit({ kind: "agent", id: 2 });
    expect(seen.events).toHaveLength(1);
    expect(s.attached).toBe(true);
    s.close();
  });

  it("rotates the ticket on ticket-expired and resumes after the last event id", async () => {
    const { cb, seen } = makeCallbacks();
    const client = makeClient();
    const s = new StreamController(client, "job-1", cb);
    s.start();
    await flush();
    FakeEventSource.instances[0].emit({ kind: "agent", id: 7 });
    FakeEventSource.instances[0].emit({ kind: "ticket-expired" });
    expect(seen.detached).toEqual(["ticket-expired"]);
    await flush();
    expect(FakeEventSource.instances).toHaveLength(2);
    // a FRESH ticket (TKT2 — the old one was just declared dead) + resume id
    expect(FakeEventSource.instances[1].url).toBe("/api/events/job-1?lastEventId=7&ticket=TKT2");
    s.close();
  });

  it("reconnects with backoff on network errors, then goes fatal", async () => {
    const { cb, seen } = makeCallbacks();
    const s = new StreamController(makeClient(), "job-1", cb, 2);
    s.start();
    await flush();
    FakeEventSource.instances[0].fail();
    expect(seen.detached).toEqual(["network"]);
    await vi.advanceTimersByTimeAsync(500); // 500 * 2^0
    FakeEventSource.instances[1].fail();
    await vi.advanceTimersByTimeAsync(1000); // 500 * 2^1
    expect(FakeEventSource.instances).toHaveLength(3);
    FakeEventSource.instances[2].fail();
    await flush();
    expect(seen.fatal).toHaveLength(1);
    expect(seen.fatal[0]).toContain("stream lost");
    expect(FakeEventSource.instances).toHaveLength(3); // bounded: no more reconnects
    s.close();
  });

  it("close() stops a pending reconnect from firing", async () => {
    const { cb } = makeCallbacks();
    const s = new StreamController(makeClient(), "job-1", cb, 5);
    s.start();
    await flush();
    FakeEventSource.instances[0].fail();
    s.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
