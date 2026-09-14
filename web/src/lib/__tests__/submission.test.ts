// REF2-01: contracts for honest metrics, run ownership and draft protection.
import { describe, it, expect } from "vitest";
import { metricLabel, sameOwner, snapshotSubmission, mayClearDraft, type DraftInput } from "../submission";

const draft = (): DraftInput => ({
  draftKey: "instance/project/session", revision: 4,
  projectKey: "project", cwd: "/workspace/project", sessionId: "session",
  text: "Review this change", model: "configured-model", mode: "plan", attachments: [],
});

describe("metricLabel", () => {
  it("unavailable is not displayed as zero", () => {
    expect(metricLabel({ kind: "unavailable", reason: "CLI did not report usage" })).toBe("Not reported");
  });
  it("reported zero remains zero", () => {
    expect(metricLabel({ kind: "reported", value: 0, unit: "tokens", scope: "message", basis: "CLI", asOf: "2026-09-14T00:00:00Z" })).toBe("0 tokens");
  });
  it("invalid numeric metrics fail safely", () => {
    expect(metricLabel({ kind: "reported", value: NaN, unit: "tokens", scope: "message", basis: "CLI", asOf: "" })).toBe("Unavailable");
    expect(metricLabel({ kind: "derived", value: -5, unit: "ms", scope: "session", basis: "CLI", asOf: "" })).toBe("Unavailable");
  });
  it("estimated numbers are visibly marked", () => {
    expect(metricLabel({ kind: "estimated", value: 125, unit: "tokens", scope: "loaded-messages", basis: "estimate", asOf: "" })).toMatch(/^~/);
  });
});

describe("sameOwner", () => {
  it("late events must match job, server epoch and generation", () => {
    const owner = { jobId: "A", serverEpoch: "epoch1", generation: 2 };
    expect(sameOwner(owner, { ...owner })).toBe(true);
    for (const other of [null, { ...owner, jobId: "B" }, { ...owner, serverEpoch: "epoch2" }, { ...owner, generation: 3 }]) {
      expect(sameOwner(owner, other)).toBe(false);
    }
  });
});

describe("submission snapshots", () => {
  it("freezes the snapshot and does not share mutable attachments with the composer", () => {
    const source = { ...draft(), attachments: [{ uploadRef: "upload-A", name: "a.txt" }] };
    const accepted = snapshotSubmission(source, "request-1");
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(accepted.attachments[0]).toEqual({ uploadRef: "upload-A", name: "a.txt" });
    // mutating the composer's array afterwards must not affect the snapshot
    (source.attachments as { uploadRef: string; name: string }[]).length = 0;
    expect(accepted.attachments).toHaveLength(1);
  });

  it("rejects empty request ids, bad revisions and unuploaded attachments", () => {
    expect(() => snapshotSubmission(draft(), " ")).toThrow(/request identity/i);
    expect(() => snapshotSubmission({ ...draft(), revision: -1 }, "r")).toThrow(/revision/i);
    expect(() => snapshotSubmission({ ...draft(), text: "" }, "r")).toThrow(/Text or an attachment/);
    expect(() => snapshotSubmission({ ...draft(), attachments: [{ uploadRef: "", name: "x" }] }, "r")).toThrow(/uploading/i);
  });

  it("mayClearDraft only clears the same draft key AND revision", () => {
    const accepted = snapshotSubmission(draft(), "request-1");
    expect(mayClearDraft({ draftKey: accepted.draftKey, revision: 4 }, accepted)).toBe(true);
    // the user kept typing while the request was in flight — newer revision
    expect(mayClearDraft({ draftKey: accepted.draftKey, revision: 5 }, accepted)).toBe(false);
    // or switched conversations mid-flight
    expect(mayClearDraft({ draftKey: "instance/other/session", revision: 4 }, accepted)).toBe(false);
  });
});
