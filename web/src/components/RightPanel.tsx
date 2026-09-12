// Right panel ported from the reference: Preview / Code / Changes tabs.
// Every tab is honest about capability state — disabled means disabled.

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Code2, Eye, FileDiff, FileText, FolderClosed, Globe, LoaderCircle, Maximize2, Minimize2, RefreshCw, Wrench } from "lucide-react";
import { IconButton } from "../ui";

type Tab = "preview" | "code" | "changes";

function authHeaders() {
  return { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` };
}

export function RightPanel({ cwd, onCollapse }: { cwd: string; onCollapse: () => void }) {
  const [tab, setTab] = useState<Tab>("preview");
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="preview-panel" aria-label="Workspace panel">
      <header className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Panel tabs">
          {(["preview", "code", "changes"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`panel-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "preview" ? <Globe size={13} /> : t === "code" ? <Code2 size={13} /> : <FileDiff size={13} />}
              <span>{t[0].toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <IconButton label={expanded ? "Collapse panel width" : "Expand panel width"} onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
          <IconButton label="Hide panel" onClick={onCollapse}><Eye size={14} /></IconButton>
        </div>
      </header>
      <div className={`panel-body ${expanded ? "expanded" : ""}`}>
        {tab === "preview" && <PreviewTab cwd={cwd} />}
        {tab === "code" && <CodeTab cwd={cwd} />}
        {tab === "changes" && <ChangesTab cwd={cwd} />}
      </div>
    </section>
  );
}

// ---------- Preview (ZWUI-035/036 contract) ----------

function PreviewTab({ cwd }: { cwd: string }) {
  const [cap, setCap] = useState<{ enabled: boolean; budgetBytes: number } | null>(null);
  const [building, setBuilding] = useState(false);
  const [snapId, setSnapId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ files: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/preview/capability")
      .then((r) => r.json())
      .then((c) => alive && setCap(c))
      .catch(() => alive && setCap({ enabled: false, budgetBytes: 0 }));
    return () => { alive = false; };
  }, []);

  async function build() {
    setBuilding(true);
    setError(null);
    try {
      const r = await fetch("/api/preview/build", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ cwd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `build failed (${r.status})`);
      setSnapId(j.snapshotId);
      setMeta({ files: j.files, bytes: j.bytes });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="preview-tab">
      {!cap ? <div className="panel-note"><LoaderCircle size={14} className="spin" /> Checking capability…</div>
        : !cap.enabled ? (
          <div className="panel-note">
            <Globe size={15} />
            <p>Preview is disabled on this deployment.</p>
            <small>Requires ZCODE_ENABLE_PREVIEW=1 and ZCODE_PREVIEW_ORIGIN — see the threat model (ZWUI-034).</small>
          </div>
        ) : (
          <>
            <div className="preview-toolbar">
              <button className="ghost-button" onClick={() => void build()} disabled={building}>
                {building ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
                <span>{building ? "Building…" : snapId ? "Rebuild snapshot" : "Build snapshot"}</span>
              </button>
              {meta && <span className="mini-badge">{meta.files} files · {Math.ceil(meta.bytes / 1024)} KB</span>}
            </div>
            {error && <div className="panel-note error-text">{error}</div>}
            {snapId ? (
              <iframe title="Static preview snapshot" src={`/api/preview/${snapId}/index.html`} sandbox="" referrerPolicy="no-referrer" />
            ) : (
              <div className="preview-empty"><Globe size={22} /><p>Build a snapshot to preview the project here.</p></div>
            )}
          </>
        )}
    </div>
  );
}

// ---------- Code (files API) ----------

function CodeTab({ cwd }: { cwd: string }) {
  const [state, setState] = useState<{ enabled: boolean } | null>(null);
  const [dir] = useState(cwd);
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/files/capability").then((r) => r.json()).then((c) => { if (alive) setState(c); }).catch(() => alive && setState({ enabled: false }));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!state?.enabled || !cwd) return;
    let alive = true;
    void fetch(`/api/files/list?dir=${encodeURIComponent(cwd)}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => { if (alive) { if (j.error) setError(j.error); else { setEntries(j.entries); setError(null); } } })
      .catch(() => alive && setError("listing failed"));
    return () => { alive = false; };
  }, [state, cwd]);

  async function open(path: string) {
    setLoadingFile(true);
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(path)}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "read failed");
      setFile({ path, content: j.content });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingFile(false);
    }
  }

  if (state && !state.enabled) {
    return <div className="panel-note"><Code2 size={15} /><p>Code inspector is disabled on this deployment.</p><small>ZCODE_ENABLE_FILES=1 enables it.</small></div>;
  }

  return (
    <div className="code-tab">
      <div className="code-toolbar">
        <FolderClosed size={13} />
        <span className="code-dir" title={dir}>{dir}</span>
        <IconButton label="Refresh listing" onClick={() => { setEntries(null); }}><RefreshCw size={12} /></IconButton>
      </div>
      {error && <div className="error-text" style={{ padding: 8 }}>{error}</div>}
      <div className="code-files">
        {(entries || []).map((e) => (
          <button key={e.name} className={e.dir ? "file-row is-dir" : "file-row"} onClick={() => !e.dir && void open(dir.replace(/\/$/, "") + "/" + e.name)} disabled={e.dir}>
            <FileText size={12} /><span>{e.name}</span>{e.dir && <ChevronDown size={11} style={{ marginLeft: "auto" }} />}
          </button>
        ))}
        {loadingFile && <div className="panel-note"><LoaderCircle size={13} className="spin" /> reading…</div>}
      </div>
      {file && (
        <pre className="code-content"><code>{file.content}</code></pre>
      )}
    </div>
  );
}

// ---------- Changes (git API) ----------

function ChangesTab({ cwd }: { cwd: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<{ status: string; path: string }[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { headers: authHeaders() });
      const j = await r.json();
      if (r.status === 403) { setEnabled(false); return; }
      setEnabled(true);
      setEntries(j.entries || []);
      setBranch(j.branch || null);
      setError(j.error || null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  async function showDiff(path?: string) {
    const r = await fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}${path ? `&path=${encodeURIComponent(path)}` : ""}`, { headers: authHeaders() });
    const j = await r.json();
    setDiff(j.diff || j.error);
  }

  if (enabled === null) return <div className="panel-note"><LoaderCircle size={14} className="spin" /> checking…</div>;
  if (enabled === false) {
    return <div className="panel-note"><FileDiff size={15} /><p>Changes inspector is disabled on this deployment.</p><small>ZCODE_ENABLE_GIT=1 enables it.</small></div>;
  }

  return (
    <div className="changes-tab">
      {branch && <div className="branch-line"><Wrench size={11} />{branch}</div>}
      {error && <div className="error-text" style={{ padding: 8 }}>{error}</div>}
      <div className="changed-file-list">
        {(entries || []).map((e, i) => (
          <button key={i} onClick={() => void showDiff(e.path)}>
            <FileText size={12} /><span>{e.path}</span><span className="file-change-count">{e.status}</span>
          </button>
        ))}
        {entries && !entries.length && (
          <div className="panel-note"><CheckCircle2 size={15} /><p>Working tree clean.</p></div>
        )}
      </div>
      {diff && <pre className="code-content"><code>{diff}</code></pre>}
    </div>
  );
}
