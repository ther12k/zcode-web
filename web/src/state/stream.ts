// ZWUI-017: ticketed stream controller with recovery UX.
//
// Owns the EventSource transport for one job:
//  - exchanges bearer for a job-scoped SSE ticket (token never in URLs)
//  - reconnects with Last-Event-ID so the server replays missed events
//  - treats `ticket-expired` by fetching a fresh ticket then reconnecting
//  - disconnect ≠ completion: only `done`/`timeout` events finalize the run
//    (the reducer owns run state; this controller owns transport state)

import type { ApiClient } from "../api/client";
import type { StoredEvent } from "../state/run";

export type StreamCallbacks = {
  onEvents: (events: StoredEvent[]) => void;
  onAttached: () => void;
  onDetached: (reason: "network" | "ticket-expired" | "closed") => void;
  onFatal: (message: string) => void;
};

export class StreamController {
  private es: EventSource | null = null;
  private closed = false;
  private lastEventId = 0;
  private reconnectAttempt = 0;

  private client: ApiClient;
  private jobId: string;
  private cb: StreamCallbacks;
  private maxReconnects: number;
  constructor(client: ApiClient, jobId: string, cb: StreamCallbacks, maxReconnects = 6) {
    this.client = client;
    this.jobId = jobId;
    this.cb = cb;
    this.maxReconnects = maxReconnects;
  }

  get attached() {
    return this.es !== null;
  }

  start() {
    this.closed = false;
    void this.connect(true);
  }

  private async connect(_initial: boolean) {
    if (this.closed) return;
    try {
      let url = `/api/events/${this.jobId}`;
      if (this.lastEventId > 0) url += `?lastEventId=${this.lastEventId}`;

      try {
        const ticket = await this.client.sseTicket(this.jobId);
        url += `${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
      } catch {
        // ticket endpoint may be unavailable (e.g. job finished); fall back to
        // bearer credentials — EventSource cannot set headers, so this only
        // works where the deployment allows it (e.g. same-host local use).
      }
      if (this.closed) return;

      const es = new EventSource(url);
      this.es = es;
      this.cb.onAttached();

      es.onmessage = (ev) => {
        let msg: StoredEvent;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.kind === "ticket-expired") {
          // rotate: server told us our ticket died (timeout/window)
          this.closeEs();
          this.cb.onDetached("ticket-expired");
          void this.connect(false);
          return;
        }
        if (msg.id && msg.id > this.lastEventId) this.lastEventId = msg.id;
        this.reconnectAttempt = 0;
        this.cb.onEvents([msg]);
        if (msg.kind === "done" || msg.kind === "timeout") {
          this.close(); // terminal event: stop the transport
        }
      };

      es.onerror = () => {
        if (this.closed) return;
        this.closeEs();
        this.cb.onDetached("network");
        // exponential backoff reconnect with Last-Event-ID resume
        if (this.reconnectAttempt < this.maxReconnects) {
          const delay = Math.min(500 * 2 ** this.reconnectAttempt, 8000);
          this.reconnectAttempt += 1;
          setTimeout(() => {
            if (!this.closed) void this.connect(false);
          }, delay);
        } else {
          this.cb.onFatal("stream lost after repeated reconnects — the job keeps running; check job status");
        }
      };
    } catch (e) {
      this.cb.onFatal(e instanceof Error ? e.message : "stream failed");
    }
  }

  private closeEs() {
    this.es?.close();
    this.es = null;
  }

  close() {
    this.closed = true;
    this.closeEs();
  }
}
