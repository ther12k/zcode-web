// Right panel — reference structure: panel-tabs + preview (address bar +
// frame) / code-panel (file-tabs + code-editor) / changes-panel (diff-file
// lines). Capability states render as honest empty/clean-tree panels.
import { useEffect, useState } from "react";
import {
  CheckCircle2, ChevronDown, Code2, Eye, FileCode2, FileDiff, FolderClosed, GitBranch,
  Globe, LoaderCircle, Maximize2, Minimize2, Monitor, PanelBottom, Play, RefreshCw, Smartphone, Target,
} from "lucide-react";
import { IconButton } from "../ui";
import { DiffViewerModal, parseUnifiedDiff, type ParsedDiff } from "./DiffViewer";

type Tab = "preview" | "code" | "changes";

function authHeaders() {
  return { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` };
}

type Goal = { objective: string; status: string; tokensUsed: number; timeUsedSeconds: number } | null | undefined;

export function RightPanel({ cwd, onCollapse, goal, expanded = false, onToggleExpanded, refreshKey = 0 }: {
  cwd: string;
  onCollapse: () => void;
  goal?: Goal;
  /** bumped when a run finishes — inspectors refetch (the tree may have changed) */
  refreshKey?: number;
  /** full-width layout (`.preview-expanded` on the workspace grid) */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("preview");
  const [mobile, setMobile] = useState(false);

  return (
    <section className="preview-panel" aria-label="Workspace panel">
      <div className="panel-tabs">
        <div className="panel-tab-group" role="tablist" aria-label="Panel tabs">
          <button role="tab" aria-selected={tab === "preview"} className={`panel-tab ${tab === "preview" ? "active" : ""}`} onClick={() => setTab("preview")}><Globe size={14} /><span>Preview</span></button>
          <button role="tab" aria-selected={tab === "code"} className={`panel-tab ${tab === "code" ? "active" : ""}`} onClick={() => setTab("code")}><Code2 size={14} /><span>Code</span></button>
          <button role="tab" aria-selected={tab === "changes"} className={`panel-tab ${tab === "changes" ? "active" : ""}`} onClick={() => setTab("changes")}><FileDiff size={14} /><span>Changes</span></button>
        </div>
        <div className="panel-actions">
          {onToggleExpanded && (
            <IconButton label={expanded ? "Restore chat beside the panel" : "Expand panel to full width"} onClick={onToggleExpanded} aria-pressed={expanded}>
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </IconButton>
          )}
          <IconButton label="Close panel" className="pane-back-button" onClick={onCollapse}><Eye size={14} /></IconButton>
        </div>
      </div>
      {tab === "preview" && <PreviewTab cwd={cwd} mobile={mobile} onMobile={setMobile} />}
      {tab === "code" && <CodeTab cwd={cwd} refreshKey={refreshKey} />}
      {tab === "changes" && <ChangesTab cwd={cwd} refreshKey={refreshKey} />}
      <GoalPanel goal={goal} />
    </section>
  );
}

// ---------- Preview ----------

function PreviewTab({ cwd, mobile, onMobile }: { cwd: string; mobile: boolean; onMobile: (m: boolean) => void }) {
  const [cap, setCap] = useState<{ enabled: boolean } | null>(null);
  const [building, setBuilding] = useState(false);
  const [snap, setSnap] = useState<{ id: string; files: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/preview/capability", { headers: authHeaders() }).then((r) => r.json()).then((c) => alive && setCap(c)).catch(() => alive && setCap({ enabled: false }));
    return () => { alive = false; };
  }, []);

  async function build() {
    setBuilding(true); setError(null);
    try {
      const r = await fetch("/api/preview/build", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ cwd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `build failed (${r.status})`);
      setSnap({ id: j.snapshotId, files: j.files, bytes: j.bytes });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <>
      <div className="preview-toolbar">
        <div className="device-switch">
          <IconButton label="Desktop view" className={!mobile ? "selected" : ""} onClick={() => onMobile(false)}><Monitor size={14} /></IconButton>
          <IconButton label="Mobile view" className={mobile ? "selected" : ""} onClick={() => onMobile(true)}><Smartphone size={13} /></IconButton>
        </div>
        <div className="preview-address">
          <Globe size={12} />
          <span>{snap ? `${snap.id}.preview` : (cwd.split("/").filter(Boolean).pop() || "workspace")}</span>
          {snap && <small>{snap.files}f · {Math.ceil(snap.bytes / 1024)}KB</small>}
          <span className="preview-live-dot" title="Static snapshot" />
        </div>
        <IconButton label="Rebuild snapshot" onClick={() => void build()} disabled={building}>
          {building ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
        </IconButton>
        {snap && (
          <a href={`/api/preview/${snap.id}/index.html`} target="_blank" rel="noopener noreferrer" className="icon-button" aria-label="Open preview in a new tab" title="Open preview in a new tab">
            <Play size={13} />
          </a>
        )}
      </div>
      {error && <div className="empty-history"><p className="danger-text">{error}</p></div>}
      {cap === null ? (
        <div className="empty-history"><LoaderCircle size={16} className="spin" /><p>Checking capability…</p></div>
      ) : !cap.enabled ? (
        <div className="empty-history">
          <Globe size={22} />
          <p>Preview is disabled on this deployment.</p>
          <small>Requires ZCODE_ENABLE_PREVIEW=1 and ZCODE_PREVIEW_ORIGIN.</small>
        </div>
      ) : snap ? (
        <div className={`preview-canvas ${mobile ? "mobile-canvas" : ""}`}>
          <div className={`preview-frame ${mobile ? "mobile-frame" : ""}`}>
            <iframe title="Static preview snapshot" src={`/api/preview/${snap.id}/index.html`} sandbox="" referrerPolicy="no-referrer" />
          </div>
        </div>
      ) : (
        <div className="empty-history">
          <PanelBottom size={22} />
          <p>Build a snapshot to preview the project here.</p>
          <button className="primary-button" onClick={() => void build()} disabled={building}>
            {building ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}Build snapshot
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Code ----------

function CodeTab({ cwd, refreshKey = 0 }: { cwd: string; refreshKey?: number }) {
  const [state, setState] = useState<{ enabled: boolean } | null>(null);
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null);
  const [openFile, setOpenFile] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/files/capability").then((r) => r.json()).then((c) => alive && setState(c)).catch(() => alive && setState({ enabled: false }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!state?.enabled || !cwd) return;
    let alive = true;
    void fetch(`/api/files/list?dir=${encodeURIComponent(cwd)}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else { setEntries(j.entries); setError(null); }
      })
      .catch(() => alive && setError("listing failed"));
    return () => { alive = false; };
  }, [state, cwd, refreshKey]);

  async function open(name: string) {
    setError(null);
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(cwd.replace(/\/$/, "") + "/" + name)}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "read failed");
      setOpenFile({ name, content: j.content });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (state === null) return <div className="empty-history"><LoaderCircle size={16} className="spin" /><p>Checking capability…</p></div>;
  if (!state.enabled) {
    return (
      <div className="empty-history">
        <Code2 size={22} />
        <p>Code inspector is disabled on this deployment.</p>
        <small>ZCODE_ENABLE_FILES=1 enables read-only file access.</small>
      </div>
    );
  }

  return (
    <div className="code-panel">
      <div className="file-tabs">
        {(entries || []).filter((e) => !e.dir).slice(0, 8).map((e) => (
          <button key={e.name} className={openFile?.name === e.name ? "active" : ""} onClick={() => void open(e.name)}>
            <FileCode2 size={12} />{e.name}
          </button>
        ))}
        {!entries?.some((e) => !e.dir) && <span className="file-state">no files at root</span>}
      </div>
      {error && <div className="empty-history"><p className="danger-text">{error}</p></div>}
      {openFile ? (
        <div className="code-editor">
          <pre className="diff-content"><code>{openFile.content}</code></pre>
        </div>
      ) : (
        <div className="empty-history">
          <FolderClosed size={22} />
          <p>Pick a file tab to read it here.</p>
          <small>Directories: {(entries || []).filter((e) => e.dir).map((e) => e.name).join(", ") || "none"}</small>
        </div>
      )}
    </div>
  );
}

// ---------- Changes ----------

function ChangesTab({ cwd, refreshKey = 0 }: { cwd: string; refreshKey?: number }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<{ status: string; path: string }[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<ParsedDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { headers: authHeaders() });
        const j = await r.json();
        if (!alive) return;
        if (r.status === 403) { setEnabled(false); return; }
        setEnabled(true);
        setEntries(j.entries || []);
        setBranch(j.branch || null);
        setError(j.error || null);
      } catch (e) {
        if (alive) { setEnabled(true); setError((e as Error).message); }
      }
    })();
    return () => { alive = false; };
  }, [cwd, refreshKey]);

  async function showDiff(path: string) {
    const r = await fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`, { headers: authHeaders() });
    const j = await r.json();
    const parsed = j.diff ? parseUnifiedDiff(j.diff) : null;
    if (parsed) setDiffTarget(parsed);
    else setError(j.error || "No diff available for this file.");
  }

  if (enabled === null) return <div className="empty-history"><LoaderCircle size={16} className="spin" /><p>Checking git…</p></div>;
  if (enabled === false) {
    return (
      <div className="empty-history">
        <FileDiff size={22} />
        <p>Changes inspector is disabled on this deployment.</p>
        <small>ZCODE_ENABLE_GIT=1 enables read-only git status and diff.</small>
      </div>
    );
  }

  const changed = entries || [];
  return (
    <div className="changes-panel">
      <header className="changes-view-header">
        <div><GitBranch size={15} /><h3>Working tree</h3><span className="branch-chip">{branch || "no branch"}</span></div>
        <span className="muted">{changed.length} changed {changed.length === 1 ? "file" : "files"}</span>
      </header>
      <div className="changes-scroll">
        {error && <div className="empty-history"><p className="danger-text">{error}</p></div>}
        {!error && !changed.length && (
          <div className="clean-tree">
            <span><CheckCircle2 size={28} /></span>
            <h3>All caught up.</h3>
            <p>Your working tree is clean. Changes made by agent runs will appear here.</p>
          </div>
        )}
        {changed.map((e) => (
          <button key={e.path} className="diff-file-header" onClick={() => void showDiff(e.path)}>
            <FileCode2 size={12} />
            <span>{e.path}</span>
            <small className="file-state">{e.status}</small>
            <ChevronDown size={12} />
          </button>
        ))}
      </div>
      <DiffViewerModal target={diffTarget} onClose={() => setDiffTarget(null)} />
    </div>
  );
}


// Goal panel — reference structure, fed by the CLI's real session_target row.
function GoalPanel({ goal }: { goal?: Goal }) {
  const [open, setOpen] = useState(false);
  if (!goal) return null;
  const running = goal.status === "active";
  const mins = Math.floor(goal.timeUsedSeconds / 60);
  return (
    <div className={`goal-panel ${open ? "goal-open" : ""}`}>
      <button className="goal-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Target size={14} />
        <strong>Goal</strong>
        <span className={`goal-state ${running ? "" : "is-complete"}`}>{running ? "In progress" : goal.status}</span>
        <ChevronDown size={13} className={open ? "rotate-180" : ""} />
      </button>
      <div className="goal-description">
        <span>{goal.objective}</span>
        <small>{mins > 0 ? `${mins}m` : "just started"}</small>
      </div>
      <div className="goal-progress" aria-label="Goal activity">
        <span className={running ? "done" : ""} />
      </div>
      {open && (
        <ul className="goal-steps">
          <li><span className="unchecked-step" /><span>Objective tracked from the CLI session target ({goal.tokensUsed.toLocaleString()} tokens used)</span></li>
        </ul>
      )}
    </div>
  );
}
