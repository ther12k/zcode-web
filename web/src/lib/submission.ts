// Presentation-boundary helpers (REF2-01, from the reference-v2 kit's
// domain.ts). These do not start jobs or authorize requests — they encode the
// contracts the visual migration must preserve:
//   - honest metrics (unavailable ≠ zero, estimates visibly marked)
//   - run-ownership identity for delayed results
//   - immutable submission snapshots with draft-revision protection

export type MetricScope = "message" | "session" | "project" | "loaded-messages";
export type Metric =
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{
      kind: "reported" | "derived" | "estimated";
      value: number;
      unit: "tokens" | "ms" | "USD";
      scope: MetricScope;
      basis: string;
      asOf: string;
    }>;

export function metricLabel(metric: Metric): string {
  if (metric.kind === "unavailable") return "Not reported";
  if (!Number.isFinite(metric.value) || metric.value < 0) return "Unavailable";
  const value = metric.unit === "USD"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 5 }).format(metric.value)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(metric.value);
  return `${metric.kind === "estimated" ? "~" : ""}${value}${metric.unit === "USD" ? "" : ` ${metric.unit}`}`;
}

export interface RunOwner {
  readonly jobId: string;
  readonly serverEpoch: string;
  /** Increment whenever the owning subscription/auth context is replaced. */
  readonly generation: number;
}

export function sameOwner(expected: RunOwner, current: RunOwner | null): boolean {
  return !!current && expected.jobId === current.jobId &&
    expected.serverEpoch === current.serverEpoch && expected.generation === current.generation;
}

export interface DraftInput {
  readonly draftKey: string;
  readonly revision: number;
  readonly projectKey: string;
  readonly cwd: string;
  readonly sessionId: string | null;
  readonly text: string;
  readonly model: string;
  readonly mode: string;
  readonly attachments: readonly Readonly<{ uploadRef: string; name: string }>[];
}

export type Submission = Readonly<DraftInput & { requestId: string }>;

/** Supply a new ID for a new intended run. Delivery retry reuses the returned object. */
export function snapshotSubmission(input: DraftInput, requestId: string): Submission {
  if (!requestId.trim()) throw new Error("A request identity is required.");
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error("Invalid draft revision.");
  if (!input.projectKey || !input.cwd) throw new Error("A resolved project is required.");
  if (!input.text.trim() && input.attachments.length === 0) throw new Error("Text or an attachment is required.");
  if (input.attachments.some((file) => !file.uploadRef || !file.name)) throw new Error("An attachment has not finished uploading.");
  return Object.freeze({
    ...input,
    requestId,
    attachments: Object.freeze(input.attachments.map((file) => Object.freeze({ ...file }))),
  });
}

/** Clear only the accepted draft revision; never clear edits typed during acceptance. */
export function mayClearDraft(current: Pick<DraftInput, "draftKey" | "revision">, accepted: Submission): boolean {
  return current.draftKey === accepted.draftKey && current.revision === accepted.revision;
}

/**
 * Choose the next queued prompt only after a successful turn. A terminal
 * failure/cancellation leaves the queue intact so the user can retry instead
 * of silently losing follow-up work.
 */
export function dequeueAfterSuccess<T>(queue: readonly T[], phase: string): { next: T | null; rest: readonly T[] } {
  if (phase !== "succeeded" || queue.length === 0) return { next: null, rest: queue };
  return { next: queue[0] ?? null, rest: queue.slice(1) };
}
