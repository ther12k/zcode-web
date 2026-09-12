// Session sidebar list for a workspace alias.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useWorkspace } from "../workspace";
import { loadPrefs } from "../state/prefs";

export function SessionList({ workspace }: { workspace: string }) {
  const { client } = useWorkspace();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { sessionId?: string };
  const [sessions, setSessions] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const prefs = loadPrefs();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { discoverWorkspaceRoot } = await import("../lib/workspaceRoot");
        const cwd = discoverWorkspaceRoot(workspace);
        const r = await client.sessions(cwd);
        if (!alive) return;
        setSessions(
          r.sessions.filter((s) => !prefs.hiddenSessions.includes(s.id))
        );
        setError(null);
      } catch (e) {
        if (alive) setError(String((e as Error).message));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, client]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {error && <div className="error-text">{error}</div>}
      {!error && !sessions.length && <div className="muted">No sessions yet</div>}
      {sessions.map((s) => {
        const label = prefs.displayAliases[s.id] || s.title || s.id;
        return (
          <div
            key={s.id}
            className={`session-item ${params.sessionId === s.id ? "active" : ""}`}
            title={s.id}
            onClick={() => navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace, sessionId: s.id } })}
          >
            <div className="session-title">
              {prefs.pinnedSessions.includes(s.id) ? "📌 " : ""}
              {label}
            </div>
            <div className="session-meta">
              {s.id.slice(0, 15)}… · {new Date(s.updatedAt).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
