// ZWUI-020: truthful activity & artifact inspector — shows the live run's
// event stream stats, current activity, tool calls and artifacts. Only real
// evidence appears here; no derived "success" badges.
import { useWorkspace } from "../workspace";
import { useEffect, useState } from "react";

export function ActivityInspector() {
  const { runs } = useWorkspace();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const live = [...runs.values()].filter((r) => r.jobId);
  if (!live.length) {
    return <div className="muted">No active runs. Tool calls and artifacts appear here during a job.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {live.map((r) => {
        const tools = r.events.filter(
          (e) => e.kind === "line" && (e.line as { type?: string })?.type?.startsWith("tool.call.")
        );
        return (
          <div key={r.jobId}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              job {r.jobId?.slice(0, 8)}… · {r.phase}
              {r.streamAttached ? "" : " · stream detached"}
            </div>
            <div className="activity">{r.activity || "…"}</div>
            <div style={{ marginTop: 8 }}>
              {tools.slice(-6).map((e, i) => {
                const line = e.line as { type: string; payload: Record<string, unknown> };
                const name = (line.payload.toolName as string) || "tool";
                const status = line.type.split(".").pop();
                return (
                  <div key={i} className={`tool-card ${status === "started" ? "running" : status === "failed" ? "failed" : "done"}`}>
                    🔧 {name} — {status}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
