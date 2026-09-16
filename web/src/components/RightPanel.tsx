// Right panel — reference structure: panel-tabs + preview (address bar +
// frame) / code-panel (file-tabs + code-editor) / changes-panel (diff-file
// lines). Capability states render as honest empty/clean-tree panels.
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, ChevronDown, CircleDot, Code2, Eye, FileCode2, FileDiff, FolderClosed, GitBranch,
  Globe, ListChecks, ListTree, LoaderCircle, Maximize2, Minimize2, Monitor, PanelBottom, Play, RefreshCw, Smartphone, Target,
} from "lucide-react";
import { IconButton, relativeTime } from "../ui";
import { IssueInspector, useGithubIssue } from "./IssueInspector";
import { issueKey, type IssueIdentity, type ScannedIssueRef } from "../lib/issueRefs";
import type { ApiClient, TodoItem } from "../api/client";
import { DiffViewerModal, parseUnifiedDiff, type ParsedDiff } from "./DiffViewer";

type Tab = "overview" | "preview" | "code" | "changes" | "issues";

function authHeaders() {
  return { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` };
}

type Goal = { objective: string; status: string; tokensUsed: number; timeUsedSeconds: number; updatedAt?: number } | null | undefined;

// ZWUI-067: decode `git status --porcelain` XY codes into words — raw
// two-letter codes assume git knowledge the UI must not require. X is the
// staged (index) state, Y the unstaged (worktree) state; a space means "no
// change on that side".
const GIT_CODE_WORDS: Record<string, string> = {
  M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied",
  T: "type change", U: "conflict", "?": "untracked", "!": "ignored",
};
function gitStatusLabel(code: string, long: boolean): string {
  const raw = code || "";
  if (raw === "??") return long ? "Untracked file (not yet in git)" : "new";
  if (raw === "!!") return long ? "Ignored file" : "ignored";
  if (raw.length > 2) return raw; // already a word (fixtures) — pass through
  const x = raw[0] ?? "";
  const y = raw[1] ?? "";
  const wx = GIT_CODE_WORDS[x];
  const wy = GIT_CODE_WORDS[y];
  if (x && x === y && wx) return long ? `Staged and unstaged ${wx}` : wx;
  if (wx && wy) return long ? `Staged ${wx}, unstaged ${wy}` : `${x}+${y}`;
  if (wx) return long ? `Staged ${wx}` : wx;
  if (wy) return long ? wy : wy;
  return raw || "changed";
}

export function RightPanel({ cwd, onCollapse, goal, expanded = false, onToggleExpanded, refreshKey = 0, runBusy = false, runStartedAt = null, sessionTitle, branch: branchProp, client, issues = [], selectedIssue = null, onAddToPrompt, todos }: {
  cwd: string;
  onCollapse: () => void;
  goal?: Goal;
  /** live run state for the Overview card (ZWUI-050 subscription lives in App) */
  runBusy?: boolean;
  /** when the current busy period started (ms epoch) — live goal timer */
  runStartedAt?: number | null;
  /** the agent's todo checklist for this session (ZWUI-078) */
  todos?: TodoItem[];
  sessionTitle?: string;
  branch?: string | null;
  /** authenticated client — issue reads go through it, never bare fetches */
  client: ApiClient;
  /** issue references seen in this conversation (chat reports them) */
  issues?: ScannedIssueRef[];
  selectedIssue?: IssueIdentity | null;
  /** append a reference to the composer WITHOUT sending (ZWUI-051) */
  onAddToPrompt?: (text: string) => void;
  /** bumped when a run finishes — inspectors refetch (the tree may have changed) */
  refreshKey?: number;
  /** full-width layout (`.preview-expanded` on the workspace grid) */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [mobile, setMobile] = useState(false);
  const showIssuesTab = issues.length > 0 || !!selectedIssue;
  const selectedIssueKey = selectedIssue ? issueKey(selectedIssue) : "";
  // a clicked reference (or new selection) opens the Issues section
  useEffect(() => {
    if (selectedIssueKey) setTab("issues");
  }, [selectedIssueKey]);
  // Preview appears ONLY where the deployment supports it (REF2-04) — it is
  // never the default empty surface
  const [previewCap, setPreviewCap] = useState<{ enabled: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/preview/capability", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((c) => { if (alive) setPreviewCap(c); })
      .catch(() => { if (alive) setPreviewCap({ enabled: false }); });
    return () => { alive = false; };
  }, []);

  return (
    <section className="preview-panel" aria-label="Workspace panel">
      <div className="panel-tabs">
        <div className="panel-tab-group" role="tablist" aria-label="Panel tabs">
          <button role="tab" aria-selected={tab === "overview"} className={`panel-tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}><ListTree size={14} /><span>Overview</span></button>
          <button role="tab" aria-selected={tab === "changes"} className={`panel-tab ${tab === "changes" ? "active" : ""}`} onClick={() => setTab("changes")}><FileDiff size={14} /><span>Changes</span></button>
          <button role="tab" aria-selected={tab === "code"} className={`panel-tab ${tab === "code" ? "active" : ""}`} onClick={() => setTab("code")}><Code2 size={14} /><span>Files</span></button>
          {previewCap?.enabled && (
            <button role="tab" aria-selected={tab === "preview"} className={`panel-tab ${tab === "preview" ? "active" : ""}`} onClick={() => setTab("preview")}><Globe size={14} /><span>Preview</span></button>
          )}
          {showIssuesTab && (
            <button role="tab" aria-selected={tab === "issues"} className={`panel-tab ${tab === "issues" ? "active" : ""}`} onClick={() => setTab("issues")}>
              <CircleDot size={14} /><span>Issues</span>
              {issues.length > 0 && <span className="panel-tab-badge">{issues.length}</span>}
            </button>
          )}
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
      {tab === "overview" && (
        <OverviewTab cwd={cwd} branch={branchProp} goal={goal} runBusy={runBusy} runStartedAt={runStartedAt} sessionTitle={sessionTitle} todos={todos}
          goChanges={() => setTab("changes")} goFiles={() => setTab("code")} />
      )}
      {tab === "preview" && previewCap?.enabled && <PreviewTab cwd={cwd} mobile={mobile} onMobile={setMobile} cap={previewCap} />}
      {tab === "code" && <CodeTab cwd={cwd} refreshKey={refreshKey} />}
      {tab === "changes" && <ChangesTab cwd={cwd} refreshKey={refreshKey} />}
      {tab === "issues" && showIssuesTab && (
        <IssuesTab client={client} refs={issues} selectedIssue={selectedIssue} onAddToPrompt={onAddToPrompt ?? (() => {})} />
      )}
    </section>
  );
}

// ---------- Issues (ZWUI-051) ----------
// Compact "issues in this conversation" list, grouped by repository and
// deduplicated by the scanner. Selecting shows the verified issue; a new
// mention never hijacks what the reader is looking at.

function IssuesTab({ client, refs, selectedIssue, onAddToPrompt }: {
  client: ApiClient;
  refs: ScannedIssueRef[];
  selectedIssue: IssueIdentity | null;
  onAddToPrompt: (text: string) => void;
}) {
  const [selected, setSelected] = useState<IssueIdentity | null>(selectedIssue ?? refs[0] ?? null);
  useEffect(() => {
    if (selectedIssue) setSelected(selectedIssue);
  }, [issueKey(selectedIssue || { host: "", owner: "", repo: "", number: 0 })]);
  const groups = useMemo(() => {
    const map = new Map<string, ScannedIssueRef[]>();
    for (const ref of refs) {
      const g = `${ref.owner}/${ref.repo}`;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(ref);
    }
    return Array.from(map.entries());
  }, [refs]);
  const active = selected ?? refs[0] ?? null;
  return (
    <div className="issues-tab">
      <div className="issues-list" aria-label="Issues in this conversation">
        <span className="overview-label">IN THIS CONVERSATION</span>
        {groups.map(([group, groupRefs]) => (
          <div key={group} className="issues-group">
            <span className="issues-group-name">{group}</span>
            {groupRefs.map((ref) => (
              <IssueListRow key={issueKey(ref)} client={client} ref_={ref}
                active={!!active && issueKey(active) === issueKey(ref)}
                onSelect={() => setSelected(ref)} />
            ))}
          </div>
        ))}
      </div>
      {active
        ? <IssueInspector client={client} identity={active} onAddToPrompt={onAddToPrompt} />
        : <div className="empty-history"><p>Select an issue to read it here.</p></div>}
    </div>
  );
}

function IssueListRow({ client, ref_, active, onSelect }: {
  client: ApiClient;
  ref_: ScannedIssueRef;
  active: boolean;
  onSelect: () => void;
}) {
  const { issue, status } = useGithubIssue(client, ref_, 0);
  return (
    <button className={`issue-row ${active ? "active" : ""}`} onClick={onSelect} aria-current={active ? "true" : undefined}>
      <CircleDot size={12} className={issue?.state === "closed" ? "deletions" : "success-text"} />
      <span className="issue-row-title">
        {status === "loading" && !issue ? `#${ref_.number} — checking…`
          : status === "error" && !issue ? `#${ref_.number} — unable to load`
          : `#${ref_.number} · ${issue?.title || ""}`}
      </span>
      {issue?.isPR && <small className="issue-row-tag">PR</small>}
    </button>
  );
}

// ---------- Overview ----------
// REF2-04: the inspector answers "what is the agent doing, what can I do
// next" from REAL state — conversation identity, run status, goal — and
// routes to Changes/Files. Selection-driven details open from there.

function OverviewTab({ cwd, branch, goal, runBusy, runStartedAt, sessionTitle, todos, goChanges, goFiles }: {
  cwd: string;
  branch?: string | null;
  goal: Goal;
  runBusy: boolean;
  runStartedAt: number | null;
  sessionTitle?: string;
  todos?: TodoItem[];
  goChanges: () => void;
  goFiles: () => void;
}) {
  return (
    <div className="overview-panel">
      <div className="overview-card">
        <span className="overview-label">CONVERSATION</span>
        <p className="overview-title">{sessionTitle || "New chat"}</p>
        <small className="overview-sub" title={cwd}>{cwd}</small>
      </div>
      <div className="overview-card">
        <span className="overview-label">AGENT</span>
        <p className="overview-title">
          <span className={`pulse-dot ${runBusy ? "" : "idle"}`} />
          {runBusy ? "Working in this project" : "Idle — nothing running"}
        </p>
        {branch && <small className="overview-sub"><GitBranch size={11} /> {branch}</small>}
      </div>
      <GoalPanel goal={goal} runBusy={runBusy} runStartedAt={runStartedAt} />
      <ProgressPanel todos={todos} runBusy={runBusy} />
      <div className="overview-links">
        <button onClick={goChanges}><FileDiff size={14} /><span><b>Review changes</b><small>Working-tree diff, unified or split</small></span></button>
        <button onClick={goFiles}><FolderClosed size={14} /><span><b>Browse files</b><small>Read-only project files</small></span></button>
      </div>
    </div>
  );
}

// ---------- Preview ----------

function PreviewTab({ cwd, mobile, onMobile, cap }: { cwd: string; mobile: boolean; onMobile: (m: boolean) => void; cap: { enabled: boolean } | null }) {
  const [building, setBuilding] = useState(false);
  const [snap, setSnap] = useState<{ id: string; files: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const [state, setState] = useState<{ enabled: boolean; unauthorized?: boolean } | null>(null);
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null);
  const [openFile, setOpenFile] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // capability discovery goes through the AUTHENTICATED path — under token
  // protection a bare fetch 401s and the tab must not misread it as "disabled"
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/files/capability", { headers: authHeaders() });
        if (!alive) return;
        if (r.status === 401) { setState({ enabled: false, unauthorized: true }); return; }
        const j = await r.json();
        setState(alive ? j : null);
      } catch {
        if (alive) setState({ enabled: false });
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!state?.enabled || state.unauthorized || !cwd) return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/files/list?dir=${encodeURIComponent(cwd)}`, { headers: authHeaders() });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(j.error || `listing failed (${r.status})`); setEntries(null); return; }
        setEntries(j.entries); setError(null);
      } catch {
        if (alive) setError("listing failed");
      }
    })();
    return () => { alive = false; };
  }, [state, cwd, refreshKey]);

  async function open(name: string) {
    setError(null);
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(cwd.replace(/\/$/, "") + "/" + name)}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `read failed (${r.status})`);
      setOpenFile({ name, content: j.content });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (state === null) return <div className="empty-history"><LoaderCircle size={16} className="spin" /><p>Checking capability…</p></div>;
  if (state.unauthorized) {
    return (
      <div className="empty-history">
        <Code2 size={22} />
        <p>Not authorized.</p>
        <small>Paste this deployment&apos;s access token to inspect files.</small>
      </div>
    );
  }
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
          <button key={e.path} className="diff-file-header" onClick={() => void showDiff(e.path)} title={gitStatusLabel(e.status, true)}>
            <FileCode2 size={12} />
            <span>{e.path}</span>
            <small className="file-state" aria-label={gitStatusLabel(e.status, true)}>{gitStatusLabel(e.status, false)}</small>
            <ChevronDown size={12} />
          </button>
        ))}
      </div>
      <DiffViewerModal target={diffTarget} onClose={() => setDiffTarget(null)} />
    </div>
  );
}


// ZWUI-078: the agent's todo checklist — the desktop's Progress list, fed by
// the CLI store's todo table (rows update in place, so this is live state).
// Hidden entirely for sessions that never created todos.
function ProgressPanel({ todos, runBusy }: { todos?: TodoItem[]; runBusy?: boolean }) {
  if (!todos || todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = done === todos.length;
  return (
    <div className="progress-panel" aria-label="Agent progress">
      <div className="progress-heading">
        <ListChecks size={13} />
        <strong>Progress</strong>
        <span className={`goal-state ${allDone ? "is-complete" : ""}`}>{done}/{todos.length}</span>
        {runBusy && !allDone && <LoaderCircle size={12} className="spin progress-live" />}
      </div>
      <ul className="progress-list">
        {todos.map((t, i) => (
          <li key={i} className={`progress-item is-${t.status}`}>
            {t.status === "completed"
              ? <CheckCircle2 size={13} className="success-text" />
              : t.status === "in_progress"
                ? <LoaderCircle size={13} className="spin" />
                : <span className="unchecked-step" />}
            <span className="progress-text">{t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
// ZWUI-077: while a run is busy the time figure ticks live (stored cumulative
// time + the current busy period's elapsed), mirroring the desktop's card.
// Goal panel — reference structure, fed by the CLI's real session_target row.
// ZWUI-077: while a run is busy the time figure ticks live (stored cumulative
// time + the current busy period's elapsed), mirroring the desktop's card.
function GoalPanel({ goal, runBusy, runStartedAt }: { goal?: Goal; runBusy?: boolean; runStartedAt?: number | null }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!runBusy) return;
    setTick(Date.now());
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runBusy]);
  if (!goal) return null;
  const running = goal.status === "active";
  const liveSeconds = goal.timeUsedSeconds
    + (runBusy && runStartedAt ? Math.max(0, ((tick || Date.now()) - runStartedAt)) / 1000 : 0);
  const worked = liveSeconds >= 1
    ? liveSeconds < 60
      ? `${Math.round(liveSeconds)}s`
      : `${Math.floor(liveSeconds / 60)}m ${Math.round(liveSeconds % 60)}s`
    : "just started";
  const updated = goal.updatedAt ? relativeTime(goal.updatedAt) : "";
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
        <small>{worked}</small>
      </div>
      <div className="goal-progress" aria-label="Goal activity">
        <span className="done" />
      </div>
      {open && (
        <ul className="goal-steps">
          <li>
            <span className={running ? "unchecked-step" : "checked-step"} />
            <span>{running ? "Working toward the objective" : `Objective ${goal.status}`}</span>
          </li>
          <li>
            <span className="unchecked-step" />
            <span>{goal.tokensUsed.toLocaleString()} tokens used · updated {updated || "recently"}</span>
          </li>
        </ul>
      )}
    </div>
  );
}
