// ZWUI-036: capability-gated Preview UX and lifecycle states.
// States: disabled (403-capability) → building → ready (iframe, sandboxed,
// separate origin per threat model) → stale/error. No fake previews.
import { useCallback, useEffect, useState } from "react";

type Cap = { enabled: boolean; budgetBytes: number; maxFiles: number; origin: string | null };
type Snapshot = { snapshotId: string; files: number; bytes: number; warnings: string[] };

export function PreviewPane({ cwd }: { cwd: string }) {
  const [cap, setCap] = useState<Cap | null>(null);
  const [building, setBuilding] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/preview/capability")
      .then((r) => r.json())
      .then((c) => alive && setCap(c))
      .catch(() => alive && setCap({ enabled: false, budgetBytes: 0, maxFiles: 0, origin: null }));
    return () => {
      alive = false;
    };
  }, []);

  const build = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      const r = await fetch("/api/preview/build", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}`,
        },
        body: JSON.stringify({ cwd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `build failed (${r.status})`);
      setSnap(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }, [cwd]);

  if (!cap) return <div className="muted">checking preview capability…</div>;

  if (!cap.enabled) {
    return (
      <div className="muted">
        Preview is disabled on this deployment. Requires ZCODE_ENABLE_PREVIEW=1
        and ZCODE_PREVIEW_ORIGIN (see the preview threat model, ZWUI-034).
      </div>
    );
  }

  return (
    <div>
      <button className="primary" onClick={() => void build()} disabled={building}>
        {building ? "Building snapshot…" : "Build preview snapshot"}
      </button>
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      {snap && (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: "var(--fs-xs)", fontFamily: "var(--font-mono)" }}>
            snapshot {snap.snapshotId} · {snap.files} files · {Math.ceil(snap.bytes / 1024)} KB
          </div>
          {snap.warnings.map((w, i) => (
            <div key={i} className="activity error">{w}</div>
          ))}
          <iframe
            title="Static preview snapshot"
            src={`/api/preview/${snap.snapshotId}/index.html`}
            sandbox=""
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: 360, border: "1px solid var(--border)", borderRadius: "var(--r-md)", marginTop: 8, background: "#fff" }}
          />
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
            Scripts stripped at snapshot time; iframe sandboxed; serve from a
            dedicated origin in production (ZCODE_PREVIEW_ORIGIN).
          </div>
        </div>
      )}
    </div>
  );
}
