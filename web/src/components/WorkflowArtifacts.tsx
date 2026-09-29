// Workflow artifacts tab (right panel): the dynamic-workflow runs of the
// open session and the artifacts they published — the web counterpart of the
// desktop's run-detail artifacts section. Data comes from the CLI's journal
// via the agent bridge (v4 conversation queries), so everything here is
// read-only and safe while a turn streams.
//
// Two artifact families, mirroring the upstream contract:
//   content (file / markdown) — versioned bytes, fetched on open
//   preset boards (chart / table / metrics / board) — spec + tagged report
//     items; rendered by small in-house renderers from the spec's fields
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, ChevronLeft, FileText, Gauge, Kanban, RefreshCw, ScrollText, Table as TableIcon, Workflow, X,
} from "lucide-react";
import { IconButton, Markdown, relativeTime } from "../ui";
import type { ApiClient, WorkflowArtifact, WorkflowArtifactItem, WorkflowRunSummary } from "../api/client";

// ── preset spec parsing (loose, like the desktop's: render what's there,
//    degrade to a plain card when the spec can't be read) ──
type Field = { field: string; label?: string; unit?: string };
type ChartSpec = { type?: "line" | "bar" | "scatter"; x: Field; y: Field[]; scale?: "linear" | "log"; baseline?: Field };
type TableSpec = { columns: Field[]; key?: string };
type MetricsSpec = { metrics: Field[] };
type BoardSpec = { key: string; status: string; columns: string[]; cardTitle?: string; detail?: Field[] };
type PresetSpec = ChartSpec | TableSpec | MetricsSpec | BoardSpec;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const parseField = (v: unknown): Field | undefined => {
  const shorthand = nonEmpty(v);
  if (shorthand) return { field: shorthand };
  if (!isRecord(v)) return undefined;
  const field = nonEmpty(v.field);
  if (!field) return undefined;
  return { field, ...(nonEmpty(v.label) ? { label: nonEmpty(v.label) } : {}), ...(nonEmpty(v.unit) ? { unit: nonEmpty(v.unit) } : {}) };
};
const parseFieldList = (v: unknown): Field[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const fields = v.map(parseField).filter((f): f is Field => !!f);
  return fields.length ? fields : undefined;
};

export function parsePresetSpec(kind: WorkflowArtifact["kind"], spec: unknown): PresetSpec | undefined {
  if (!isRecord(spec)) return undefined;
  if (kind === "chart") {
    const x = parseField(spec.x);
    const y = parseFieldList(spec.y) ?? (parseField(spec.y) ? [parseField(spec.y)!] : undefined);
    if (!x || !y) return undefined;
    return { type: spec.type === "bar" || spec.type === "scatter" ? spec.type : "line", x, y, scale: spec.scale === "log" ? "log" : "linear", ...(parseField(spec.baseline) ? { baseline: parseField(spec.baseline)! } : {}) };
  }
  if (kind === "table") {
    const columns = parseFieldList(spec.columns);
    return columns ? { columns, ...(nonEmpty(spec.key) ? { key: nonEmpty(spec.key) } : {}) } : undefined;
  }
  if (kind === "metrics") {
    const metrics = parseFieldList(spec.metrics);
    return metrics ? { metrics } : undefined;
  }
  if (kind === "board") {
    const key = nonEmpty(spec.key);
    const status = nonEmpty(spec.status);
    const columns = Array.isArray(spec.columns) ? spec.columns.map(nonEmpty).filter((c): c is string => !!c) : [];
    if (!key || !status || !columns.length) return undefined;
    return { key, status, columns, ...(nonEmpty(spec.cardTitle) ? { cardTitle: nonEmpty(spec.cardTitle)! } : {}), ...(parseFieldList(spec.detail) ? { detail: parseFieldList(spec.detail)! } : {}) };
  }
  return undefined;
}

// dot-path read from a report item ("timing.after")
function getByPath(item: unknown, path: string): unknown {
  let cur: unknown = item;
  for (const seg of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}
const fieldLabel = (f: Field) => f.label ?? f.field;

// ── item application per preset kind ──
function tableRows(spec: TableSpec, items: WorkflowArtifactItem[]) {
  const rows = new Map<string, unknown[]>();
  for (const it of items) {
    const key = spec.key ? String(getByPath(it.item, spec.key) ?? "") : `#${it.sequence}`;
    rows.set(key, spec.columns.map((c) => getByPath(it.item, c.field)));
  }
  return [...rows.entries()];
}
function metricValues(spec: MetricsSpec, items: WorkflowArtifactItem[]) {
  return spec.metrics.map((m) => {
    let value: unknown;
    for (const it of items) {
      const v = getByPath(it.item, m.field);
      if (v !== undefined) value = v;
    }
    return { m, value };
  });
}
function chartSeries(spec: ChartSpec, items: WorkflowArtifactItem[]) {
  const xs = items.map((it) => { const v = getByPath(it.item, spec.x.field); return typeof v === "number" ? v : undefined; });
  const xIsNumeric = xs.filter((v) => v !== undefined).length >= Math.max(1, Math.floor(items.length / 2));
  const series = spec.y.map((y) => ({
    label: fieldLabel(y),
    points: items.map((it, i) => ({ x: xIsNumeric ? (xs[i] ?? i) : i, y: Number(getByPath(it.item, y.field)) })).filter((p) => Number.isFinite(p.y)),
  }));
  let baseline: { value: number } | null = null;
  if (spec.baseline) {
    for (const it of items) {
      const v = Number(getByPath(it.item, spec.baseline!.field));
      if (Number.isFinite(v)) { baseline = { value: v }; break; }
    }
  }
  return { series, baseline, xIsNumeric };
}
function boardColumns(spec: BoardSpec, items: WorkflowArtifactItem[]) {
  const cards = new Map<string, { col: string; title: string; details: string[] }>();
  for (const it of items) {
    const key = String(getByPath(it.item, spec.key) ?? `#${it.sequence}`);
    const col = String(getByPath(it.item, spec.status) ?? "");
    cards.set(key, {
      col,
      title: spec.cardTitle ? String(getByPath(it.item, spec.cardTitle) ?? key) : key,
      details: (spec.detail ?? []).map((d) => `${fieldLabel(d)}: ${String(getByPath(it.item, d.field) ?? "—")}`),
    });
  }
  const cols = [...spec.columns];
  const known = new Set(cols);
  for (const c of cards.values()) if (c.col && !known.has(c.col)) { cols.push(c.col); known.add(c.col); }
  return { cols, cards: [...cards.values()] };
}

// ── tiny SVG chart (line/bar/scatter, optional log y, dashed baseline) ──
const CHART_COLORS = ["#a9c38e", "#8aa8c9", "#c9a38e", "#b398c9", "#8ec9b8"];
function ChartView({ spec, items }: { spec: ChartSpec; items: WorkflowArtifactItem[] }) {
  const { series, baseline } = useMemo(() => chartSeries(spec, items), [spec, items]);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="wf-empty-hint">No report items yet — the chart fills as the workflow reports.</p>;
  const W = 560, H = 220, P = 34;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const ly = (v: number) => {
    const t = spec.scale === "log" && v > 0 ? (Math.log10(v) - (minY > 0 ? Math.log10(minY) : 0)) / (Math.log10(maxY || 1) - (minY > 0 ? Math.log10(minY) : 0) || 1) : (v - minY) / spanY;
    return H - P - t * (H - 2 * P);
  };
  const lx = (v: number) => P + ((v - minX) / spanX) * (W - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="wf-chart" role="img" aria-label={spec.x.field}>
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--border-strong)" />
      <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--border-strong)" />
      {baseline && <line x1={P} y1={ly(baseline.value)} x2={W - P} y2={ly(baseline.value)} stroke="#8f988c" strokeDasharray="4 3" />}
      {series.map((s, i) => (
        <g key={s.label} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]}>
          {spec.type === "scatter"
            ? s.points.map((p, j) => <circle key={j} cx={lx(p.x)} cy={ly(p.y)} r={3} stroke="none" />)
            : spec.type === "bar"
              ? s.points.map((p, j) => <rect key={j} x={lx(p.x) - 4} y={ly(p.y)} width={8} height={H - P - ly(p.y)} stroke="none" opacity={0.85} />)
              : <polyline points={s.points.map((p) => `${lx(p.x)},${ly(p.y)}`).join(" ")} fill="none" strokeWidth={1.6} />}
        </g>
      ))}
      {series.map((s, i) => (
        <text key={s.label} x={W - P} y={12 + i * 13} textAnchor="end" fontSize={10} fill={CHART_COLORS[i % CHART_COLORS.length]}>{s.label}</text>
      ))}
      <text x={P} y={H - 8} fontSize={9.5} fill="var(--muted)">{fieldLabel(spec.x)}</text>
      <text x={4} y={P - 6} fontSize={9.5} fill="var(--muted)">{fieldLabel(spec.y[0])}{spec.scale === "log" ? " (log)" : ""}</text>
    </svg>
  );
}

// ── the artifact detail modal ──
type ArtifactView =
  | { kind: "text"; title: string; text: string; markdown: boolean }
  | { kind: "image"; title: string; src: string }
  | { kind: "pdf"; title: string; src: string }
  | { kind: "preset"; artifact: WorkflowArtifact; spec: PresetSpec }
  | { kind: "preset-failed"; artifact: WorkflowArtifact }
  | { kind: "loading"; title: string }
  | { kind: "error"; title: string; message: string };

function ArtifactModal({ view, onClose, client, sessionId, runId, itemCount }: {
  view: ArtifactView; onClose: () => void; client: ApiClient; sessionId: string; runId: string; itemCount: number;
}) {
  const [items, setItems] = useState<WorkflowArtifactItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const artifact = view.kind === "preset" || view.kind === "preset-failed" ? view.artifact : null;

  useEffect(() => {
    if (view.kind !== "preset") return;
    let alive = true;
    setItems(null);
    setItemsError(null);
    client.workflowRunArtifactData(sessionId, runId, view.artifact.id)
      .then((r) => { if (alive) setItems(Array.isArray(r?.items) ? r.items : []); })
      .catch((e) => { if (alive) setItemsError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [view, client, sessionId, runId]);

  return (
    <div className="wf-modal-backdrop" role="dialog" aria-modal="true" aria-label="Workflow artifact" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wf-modal">
        <header className="wf-modal-header">
          <div className="wf-modal-titles">
            <strong>{view.kind === "preset" || view.kind === "preset-failed" ? (view.artifact.title || view.artifact.id) : view.title}</strong>
            {artifact && <small>{artifact.kind} · v{artifact.version}{itemCount ? ` · ${itemCount} report item${itemCount === 1 ? "" : "s"}` : ""}</small>}
          </div>
          <IconButton label="Close artifact" onClick={onClose}><X size={16} /></IconButton>
        </header>
        <div className="wf-modal-body">
          {view.kind === "loading" && <p className="wf-empty-hint">Reading artifact…</p>}
          {view.kind === "error" && <p className="wf-empty-hint wf-error">{view.message}</p>}
          {view.kind === "text" && (view.markdown ? <Markdown text={view.text} /> : <pre className="wf-text">{view.text}</pre>)}
          {view.kind === "image" && <img src={view.src} alt={view.title} className="wf-image" />}
          {view.kind === "pdf" && <iframe src={view.src} title={view.title} className="wf-pdf" />}
          {view.kind === "preset-failed" && <p className="wf-empty-hint">This board's spec can't be rendered — {artifact?.itemCount || 0} report items are recorded.</p>}
          {view.kind === "preset" && (
            itemsError ? <p className="wf-empty-hint wf-error">{itemsError}</p>
              : items === null ? <p className="wf-empty-hint">Loading report items…</p>
              : view.spec && view.artifact.kind === "chart" ? <ChartView spec={view.spec as ChartSpec} items={items} />
              : view.spec && view.artifact.kind === "table" ? (
                <table className="wf-table">
                  <thead><tr>{(view.spec as TableSpec).columns.map((c) => <th key={c.field}>{fieldLabel(c)}{c.unit ? ` (${c.unit})` : ""}</th>)}</tr></thead>
                  <tbody>
                    {tableRows(view.spec as TableSpec, items).map(([key, cells], i) => (
                      <tr key={key || i}>{cells.map((cell, j) => <td key={j}>{cell === undefined || cell === null ? "—" : typeof cell === "object" ? JSON.stringify(cell) : String(cell)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              )
              : view.spec && view.artifact.kind === "metrics" ? (
                <div className="wf-metrics">
                  {metricValues(view.spec as MetricsSpec, items).map(({ m, value }) => (
                    <div className="wf-metric-tile" key={m.field}>
                      <small>{fieldLabel(m)}{m.unit ? ` (${m.unit})` : ""}</small>
                      <strong>{value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</strong>
                    </div>
                  ))}
                </div>
              )
              : view.spec && view.artifact.kind === "board" ? (() => {
                const { cols, cards } = boardColumns(view.spec as BoardSpec, items);
                return (
                  <div className="wf-board">
                    {cols.map((col) => (
                      <div className="wf-board-col" key={col}>
                        <small>{col || "Other"} · {cards.filter((c) => (c.col || "") === col).length}</small>
                        {cards.filter((c) => (c.col || "") === col).map((c, i) => (
                          <div className="wf-board-card" key={i}>
                            <strong>{c.title}</strong>
                            {c.details.map((d, j) => <small key={j}>{d}</small>)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()
              : <p className="wf-empty-hint">Nothing to render.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── the tab ──
const KIND_ICON: Record<WorkflowArtifact["kind"], typeof FileText> = {
  file: FileText, markdown: ScrollText, chart: BarChart3, table: TableIcon, metrics: Gauge, board: Kanban,
};
const STATUS_CLASS: Record<WorkflowRunSummary["status"], string> = {
  completed: "wf-status-completed", errored: "wf-status-errored", stopped: "wf-status-stopped",
  running: "wf-status-running", pending: "wf-status-pending",
};
const formatBytes = (n?: number) => (n == null ? "" : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

export function WorkflowArtifactsTab({ client, sessionId, refreshKey = 0 }: { client: ApiClient; sessionId: string; refreshKey?: number }) {
  const [runs, setRuns] = useState<WorkflowRunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[] | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [view, setView] = useState<ArtifactView | null>(null);

  const loadRuns = useCallback(() => {
    setRuns(null);
    setRunsError(null);
    setSelectedRun(null);
    client.workflowRuns(sessionId)
      .then((r) => setRuns(r.runs))
      .catch((e) => setRunsError(e instanceof Error ? e.message : String(e)));
  }, [client, sessionId]);

  useEffect(() => { loadRuns(); }, [loadRuns, refreshKey]);

  useEffect(() => {
    if (!selectedRun) { setArtifacts(null); return; }
    let alive = true;
    setArtifacts(null);
    setArtifactsError(null);
    client.workflowRunArtifacts(sessionId, selectedRun)
      .then((r) => { if (alive) setArtifacts(r.artifacts); })
      .catch((e) => { if (alive) setArtifactsError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [client, sessionId, selectedRun]);

  const openArtifact = useCallback(async (a: WorkflowArtifact) => {
    if (a.kind === "file" || a.kind === "markdown") {
      setView({ kind: "loading", title: a.title || a.id });
      try {
        const r = await client.workflowArtifactContent(sessionId, selectedRun!, a.id, a.version);
        if (!r.ok) throw new Error(r.status === 404 ? "Artifact not found." : `HTTP ${r.status}`);
        const ct = r.headers.get("content-type") || a.contentType || "text/plain";
        if (ct.startsWith("image/") || ct === "application/pdf") {
          const objUrl = URL.createObjectURL(await r.blob());
          setView(ct.startsWith("image/")
            ? { kind: "image", title: a.title || a.id, src: objUrl }
            : { kind: "pdf", title: a.title || a.id, src: objUrl });
        } else {
          const text = await r.text();
          setView({ kind: "text", title: a.title || a.id, text: text.slice(0, 400_000), markdown: a.kind === "markdown" || ct.includes("markdown") });
        }
      } catch (e) {
        setView({ kind: "error", title: a.title || a.id, message: e instanceof Error ? e.message : "Could not read artifact." });
      }
      return;
    }
    const spec = parsePresetSpec(a.kind, a.spec);
    setView(spec ? { kind: "preset", artifact: a, spec } : { kind: "preset-failed", artifact: a });
  }, [client, sessionId, selectedRun]);

  const ordered = useMemo(() => {
    if (!artifacts) return null;
    return [...artifacts].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  }, [artifacts]);

  const run = runs?.find((r) => r.runId === selectedRun) || null;

  return (
    <div className="wf-tab">
      <div className="wf-tab-header">
        {selectedRun && run ? (
          <>
            <IconButton label="Back to runs" onClick={() => setSelectedRun(null)}><ChevronLeft size={14} /></IconButton>
            <div className="wf-modal-titles">
              <strong>{run.label || run.runId}</strong>
              <small>{run.status}{run.updatedAt ? ` · ${relativeTime(run.updatedAt)}` : ""}</small>
            </div>
          </>
        ) : (
          <>
            <Workflow size={14} />
            <strong>Workflow runs</strong>
            <span className="wf-tab-count">{runs?.length ?? "…"}</span>
          </>
        )}
        <span className="wf-tab-spacer" />
        <IconButton label="Refresh workflow runs" onClick={loadRuns}><RefreshCw size={13} /></IconButton>
      </div>

      <div className="wf-tab-body">
        {runsError && <p className="wf-empty-hint wf-error">{runsError}</p>}
        {!runsError && runs === null && <p className="wf-empty-hint">Reading the workflow journal…</p>}
        {runs && runs.length === 0 && (
          <div className="wf-empty">
            <Workflow size={22} />
            <p>No workflow runs in this session yet. Runs created with the workflow tool appear here — with every artifact they published.</p>
          </div>
        )}
        {runs && runs.length > 0 && !selectedRun && (
          <ul className="wf-run-list">
            {runs.map((r) => (
              <li key={r.runId}>
                <button className="wf-run-row" onClick={() => setSelectedRun(r.runId)} title={r.failureMessage || r.runId}>
                  <span className={`wf-status-dot ${STATUS_CLASS[r.status] || ""}`} />
                  <span className="wf-run-name">{r.label || r.runId}</span>
                  {r.updatedAt ? <time>{relativeTime(r.updatedAt)}</time> : null}
                </button>
                {r.failureMessage && <small className="wf-run-failure">{r.failureMessage}</small>}
              </li>
            ))}
          </ul>
        )}
        {selectedRun && (
          artifactsError ? <p className="wf-empty-hint wf-error">{artifactsError}</p>
          : artifacts === null ? <p className="wf-empty-hint">Reading artifacts…</p>
          : artifacts.length === 0 ? <p className="wf-empty-hint">This run published no artifacts.</p>
          : (
            <ul className="wf-artifact-list">
              {ordered!.map((a) => {
                const Icon = KIND_ICON[a.kind] || FileText;
                const latest = a.versions[a.versions.length - 1];
                return (
                  <li key={a.id}>
                    <button className="wf-artifact-card" onClick={() => void openArtifact(a)}>
                      <Icon size={15} />
                      <span className="wf-artifact-main">
                        <strong>{a.title || a.id}{a.primary ? <em className="wf-primary-badge">Deliverable</em> : null}</strong>
                        <small>
                          {a.kind}
                          {a.versions.length > 1 ? ` · v${a.version} (${a.versions.length} versions)` : ` · v${a.version}`}
                          {latest?.bytes ? ` · ${formatBytes(latest.bytes)}` : ""}
                          {(a.kind !== "file" && a.kind !== "markdown" && a.itemCount) ? ` · ${a.itemCount} items` : ""}
                          {a.sourcePath ? ` · ${a.sourcePath}` : ""}
                        </small>
                        {a.description && <small className="wf-artifact-desc">{a.description}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>

      {view && (
        <ArtifactModal
          view={view}
          onClose={() => setView(null)}
          client={client}
          sessionId={sessionId}
          runId={selectedRun || ""}
          itemCount={view.kind === "preset" || view.kind === "preset-failed" ? view.artifact.itemCount : 0}
        />
      )}
    </div>
  );
}
