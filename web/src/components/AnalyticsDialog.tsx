// Workspace analytics ported from the clone — rebuilt on honest data:
// the /api/analytics aggregates come from the CLI's own session store
// (step-finish token sums, turn_usage durations, per-day session counts).
// No invented cost estimates, no fabricated in/out splits.
import { useEffect, useState } from "react";
import { Activity, Clock3, Database, MessageSquare, Target, Zap } from "lucide-react";
import { Dialog } from "../ui";

type Analytics = {
  sessions: number;
  tokens: number;
  steps: number;
  turns: number;
  agentTimeMs: number;
  failedTurns: number;
  activeSessions: number;
  daily: { day: string; sessions: number }[];
  topSessions: { id: string; title: string; directory: string; updatedAt: number; tokens: number }[];
  generatedAt: number;
  /** true when the snapshot is past its TTL and a rebuild is running */
  stale?: boolean;
};

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}
function dur(ms: number): string {
  if (!ms) return "—";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

export function AnalyticsDialog({ open, onClose, onSelectSession, token }: {
  open: boolean;
  onClose: () => void;
  onSelectSession: (id: string, directory: string) => void;
  token: string;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ZWUI-043 contract: 202 while the first snapshot builds on the server's
  // worker thread (retry until ready), 503 on build failure, 200 otherwise —
  // possibly a stale snapshot with a fresh rebuild in flight.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setError(null);
    setPending(true);
    const load = async () => {
      try {
        const r = await fetch("/api/analytics?days=14", { headers: { authorization: `Bearer ${token}` } });
        if (!alive) return;
        if (r.status === 202) { timer = setTimeout(load, 2500); return; }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `analytics failed (${r.status})`);
        setData(j as Analytics);
        setPending(false);
      } catch (e) {
        if (alive) { setError((e as Error).message); setPending(false); }
      }
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [open, token]);

  if (!open) return null;

  const daily = (data?.daily || []).slice().reverse();
  const maxDaily = Math.max(1, ...daily.map((d) => d.sessions));

  return (
    <Dialog title="Workspace analytics." subtitle="Every number below is read from your sessions — nothing estimated." onClose={onClose} wide>
      <div className="dialog-body analytics-body">
        {pending && <div className="analytics-loading"><Activity size={15} className="spin" />Building the first snapshot — this scan runs once, off the server's request path…</div>}
        {error && <div className="danger-text">{error}</div>}
        {!pending && data && (
          <>
            {data.stale && (
              <div className="analytics-stale" role="status">
                Snapshot as of {new Date(data.generatedAt).toLocaleTimeString()} — refreshing in the background; numbers below are the last complete scan.
              </div>
            )}
            <div className="token-metrics analytics-grid">
              <div className="token-metric">
                <span><Database size={13} className="cyan-text" />Sessions<b className="right">{data.sessions.toLocaleString()}</b></span>
                <small>{data.activeSessions} active right now</small>
              </div>
              <div className="token-metric">
                <span><Zap size={13} className="amber-text" />Tokens<b className="right">{fmt(data.tokens)}</b></span>
                <small>across {fmt(data.steps)} steps</small>
              </div>
              <div className="token-metric">
                <span><MessageSquare size={13} className="violet-text" />Turns<b className="right">{data.turns.toLocaleString()}</b></span>
                <small>{data.failedTurns} failed</small>
              </div>
              <div className="token-metric">
                <span><Clock3 size={13} className="green-text" />Agent time<b className="right">{dur(data.agentTimeMs)}</b></span>
                <small>sum of turn durations</small>
              </div>
            </div>

            <div className="analytics-section">
              <div className="token-table-head"><span>ACTIVITY — LAST {daily.length} DAYS</span><span>{data.daily.reduce((a, d) => a + d.sessions, 0)} sessions</span></div>
              <div className="analytics-bars" role="img" aria-label="Sessions per day bar chart">
                {daily.map((d) => (
                  <div className="analytics-bar-col" key={d.day} title={`${d.day}: ${d.sessions} sessions`}>
                    <div className="analytics-bar" style={{ height: `${Math.max(4, Math.round((d.sessions / maxDaily) * 72))}px` }} />
                    <small>{d.day.slice(5)}</small>
                  </div>
                ))}
                {!daily.length && <div className="analytics-empty">No activity recorded yet.</div>}
              </div>
            </div>

            <div className="analytics-section">
              <div className="token-table-head"><span>TOP SESSIONS BY TOKENS</span><span>top 5</span></div>
              <div className="analytics-top">
                {data.topSessions.map((s) => (
                  <button key={s.id} className="analytics-row" onClick={() => { onSelectSession(s.id, s.directory); onClose(); }}>
                    <Target size={12} />
                    <span className="analytics-row-title">{s.title || s.id}</span>
                    <small>{(s.directory || "").split("/").filter(Boolean).pop()}</small>
                    <b>{fmt(s.tokens)}</b>
                  </button>
                ))}
                {!data.topSessions.length && <div className="analytics-empty">No token usage recorded yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
