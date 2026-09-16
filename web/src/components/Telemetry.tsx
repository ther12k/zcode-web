// Telemetry surfaces ported from the clone's best ideas, rebuilt on real
// data: the token inspector reads turn_usage-backed transcript fields (no
// invented pricing), and the terminal drawer is read-only evidence of what
// the agent actually executed — not a shell.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Coins, Copy, Download, Layers, LoaderCircle, SquareTerminal, Terminal, Trash2, X, Zap } from "lucide-react";
import { Dialog, IconButton } from "../ui";
import type { TranscriptTurn } from "../api/client";

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

function fmtDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Session-level token audit: aggregates from completed turns plus the live
// run, a per-turn table (tokens · duration · tokens/s), copy summary and
// JSON export. Everything shown is measured — prompt/completion splits and
// cost estimates are deliberately absent (the store has totals only).
//
// Scope honesty (ZWUI-047): the per-turn table can only ever describe the
// LOADED transcript page. When the server provides a pagination-independent
// session total it is shown as the headline number; otherwise the label says
// exactly what the number covers.
export function TokenTelemetryDialog({ sessionId, title, turns, totalTurns, sessionTotal, contextTokens, liveTokens, onClose }: {
  sessionId: string;
  title: string;
  turns: TranscriptTurn[];
  /** turns available in the session (transcript `total`) */
  totalTurns: number;
  /** server-side token sum over ALL messages, independent of pagination */
  sessionTotal: number | null;
  /** latest step usage ≈ the context the next call re-feeds (the desktop's
      "current context"); each agentic step re-feeds the whole context, so
      cumulative sums are billing figures, not sizes */
  contextTokens?: number | null;
  liveTokens: number | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    const measured = turns.filter((t) => (t.tokens || 0) > 0 || t.durationMs);
    const loadedTotal = measured.reduce((a, t) => a + (t.tokens || 0), 0);
    const liveTotal = liveTokens ? loadedTotal + liveTokens : loadedTotal;
    const totalTimeMs = measured.reduce((a, t) => a + (t.durationMs || 0), 0);
    const tokenTurns = measured.filter((t) => (t.tokens || 0) > 0);
    const timeTurns = measured.filter((t) => (t.durationMs || 0) > 0);
    const avgTurn = tokenTurns.length ? Math.round(loadedTotal / tokenTurns.length) : 0;
    const speed = totalTimeMs > 0 && liveTotal > 0 ? Math.round(liveTotal / (totalTimeMs / 1000)) : 0;
    const slowest = timeTurns.reduce<TranscriptTurn | null>((acc, t) => (!acc || (t.durationMs || 0) > (acc.durationMs || 0) ? t : acc), null);
    const richest = tokenTurns.reduce<TranscriptTurn | null>((acc, t) => (!acc || (t.tokens || 0) > (acc.tokens || 0) ? t : acc), null);
    return {
      measured, totalTokens: liveTotal, loadedTotal, totalTimeMs,
      avgTurn, speed, slowest, richest, liveIncluded: Boolean(liveTokens),
    };
  }, [turns, liveTokens]);

  const headlineTotal = sessionTotal ?? stats.totalTokens;
  const scopeLabel = sessionTotal != null
    ? "all messages of this session"
    : stats.liveIncluded
      ? `loaded turns + live turn (${turns.length} loaded)`
      : `loaded turns only (${turns.length} of ${totalTurns} loaded)`;

  async function copySummary() {
    const lines = [
      `Session token audit: ${title}`,
      `Session: ${sessionId}`,
      contextTokens != null ? `Current context: ${contextTokens.toLocaleString()} (what the next call re-feeds)` : "",
      `Cumulative usage — all steps: ${headlineTotal.toLocaleString()} (scope: ${scopeLabel}; each step re-feeds the context)`,
      `Loaded-turn tokens: ${stats.totalTokens.toLocaleString()}${stats.liveIncluded ? ` (${stats.loadedTotal.toLocaleString()} committed + live turn in flight)` : ""}`,
      `Turns with telemetry: ${stats.measured.length} of ${totalTurns} in session`,
      `Total agent time: ${fmtDuration(stats.totalTimeMs)}`,
      `Average per loaded turn: ${stats.avgTurn.toLocaleString()} tokens`,
      stats.speed ? `Aggregate speed: ~${stats.speed.toLocaleString()} tokens/s` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }

  function exportJson() {
    const data = {
      sessionId,
      sessionTitle: title,
      exportedAt: new Date().toISOString(),
      scope: { sessionTotal, loadedTurns: turns.length, totalTurns, note: "per-turn rows cover the loaded transcript page only" },
      totals: {
        tokens: headlineTotal,
        sessionTotal,
        loadedTurnTokens: stats.totalTokens,
        liveTurnTokens: stats.liveIncluded ? liveTokens : null,
        totalTimeMs: stats.totalTimeMs,
        averageTokensPerLoadedTurn: stats.avgTurn,
      },
      turns: stats.measured.map((t, i) => ({
        index: i + 1,
        id: t.id || null,
        role: t.role,
        tokens: t.tokens || 0,
        durationMs: t.durationMs || null,
        tokensPerSecond: t.durationMs ? Math.round((t.tokens || 0) / (t.durationMs / 1000)) : null,
        failed: Boolean(t.error),
      })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `zcode-token-telemetry-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog title="Token telemetry." subtitle="Measured usage — per turn, from the CLI's own records." onClose={onClose} wide>
      <div className="dialog-body token-telemetry">
        <div className="token-metrics">
          {contextTokens != null && (
            <div className="token-metric">
              <span><Zap size={13} className="amber-text" />Current context<b className="right">{fmtTokens(contextTokens)}</b></span>
              <small>what the next call re-feeds — the desktop's context figure</small>
            </div>
          )}
          <div className="token-metric">
            <span><Coins size={13} className="amber-text" />Cumulative usage — all steps<b className="right">{fmtTokens(headlineTotal)}</b></span>
            <small>{scopeLabel} · every agentic step re-feeds the context, so this grows by ~one context per step (a billing figure, not a size)</small>
          </div>
          <div className="token-metric">
            <span><ArrowDownRight size={13} className="cyan-text" />Turns measured<b className="right">{stats.measured.length}</b></span>
            <small>in {turns.length} loaded of {totalTurns} turns</small>
          </div>
          <div className="token-metric">
            <span><ArrowUpRight size={13} className="violet-text" />Agent time<b className="right">{fmtDuration(stats.totalTimeMs)}</b></span>
            <small>sum of loaded turn durations</small>
          </div>
          <div className="token-metric">
            <span><Layers size={13} className="green-text" />Avg / turn<b className="right">{fmtTokens(stats.avgTurn)}</b></span>
            <small>{stats.speed ? `~${fmtTokens(stats.speed)} tk/s aggregate` : "—"}</small>
          </div>
        </div>
        <div className="token-table-wrap">
          <div className="token-table-head">
            <span>PER-TURN AUDIT — LOADED MESSAGES</span>
            <span>{stats.measured.length} rows</span>
          </div>
          <table className="token-table">
            <thead>
              <tr><th>#</th><th>Role</th><th className="num">Tokens</th><th className="num">Duration</th><th className="num">Speed</th><th>Status</th></tr>
            </thead>
            <tbody>
              {stats.measured.map((t, i) => (
                <tr key={t.id || i}>
                  <td>{i + 1}</td>
                  <td>{t.role === "user" ? "You" : "Zcode"}</td>
                  <td className="num">{t.tokens ? t.tokens.toLocaleString() : "—"}</td>
                  <td className="num">{fmtDuration(t.durationMs || 0)}</td>
                  <td className="num">{t.tokens && t.durationMs ? `${Math.round(t.tokens / (t.durationMs / 1000))}/s` : "—"}</td>
                  <td>{t.error ? <span className="failed-chip">failed</span> : t.incomplete ? <span className="muted">in flight</span> : "ok"}</td>
                </tr>
              ))}
              {!stats.measured.length && (
                <tr><td colSpan={6} className="token-empty">No telemetry yet — turns record usage when they finish.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="token-actions">
          <button className="secondary-button" onClick={() => void copySummary()}>
            {copied ? <Check size={13} className="success-text" /> : <Copy size={13} />}{copied ? "Copied" : "Copy summary"}
          </button>
          <button className="secondary-button" onClick={exportJson} disabled={!stats.measured.length}>
            <Download size={13} />Export JSON
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export type TerminalEntry = {
  key: string;
  command: string;
  /** the call's own lifecycle status (started/running/completed/failed) */
  status: string;
  /** where the entry came from — never conflated with its status (ZWUI-046) */
  source: "history" | "live";
};

// Read-only agent terminal: every Bash command the session actually ran
// (transcript tool parts + the live stream), terminal-styled. It is evidence,
// not a shell — there is deliberately no free-text execution input.
export function AgentTerminalDrawer({ open, entries, onClose, onClear }: {
  open: boolean;
  entries: TerminalEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const isRunning = (e: TerminalEntry) => e.source === "live" && /start|running|pending/i.test(e.status);
  return (
    <section className="workspace-terminal" aria-label="Agent terminal">
      <header>
        <SquareTerminal size={13} />
        <span>Agent terminal</span>
        <span className="terminal-badge">read-only</span>
        <span className="terminal-spacer" />
        <span className="terminal-count">{entries.length} command{entries.length === 1 ? "" : "s"}</span>
        <IconButton label="Clear terminal view" onClick={onClear}><Trash2 size={12} /></IconButton>
        <IconButton label="Close terminal" onClick={onClose}><X size={13} /></IconButton>
      </header>
      <div className="terminal-output" ref={scrollRef}>
        {!entries.length && (
          <p className="terminal-welcome"><Terminal size={12} /> <span>Commands Zcode runs in this workspace appear here as they execute.</span></p>
        )}
        {entries.map((e) => {
          const running = isRunning(e);
          return (
            <div className="terminal-item" key={e.key}>
              <p className="terminal-command">
                <span>$</span>{e.command}
                {running && <LoaderCircle size={10} className="spin terminal-live" />}
                <small className={e.status === "failed" || e.status === "error" ? "deletions" : running ? "muted" : "success-text"}>
                  {running ? "running" : e.status || "—"}
                </small>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
