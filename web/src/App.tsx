// App shell ported to the reference design (user-provided sample):
// brand header, topbar breadcrumbs, collapsible sidebar (Projects/Sessions
// views, project groups with session task-rows), chat + right panel, statusbar.
// State ownership (ZWUI-006): runs live in a registry keyed by jobId —
// navigating never retargets or cancels a job.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, CloudCheck, FolderClosed, FolderOpen,
  History, Keyboard, Menu, PanelLeft, PanelRight, Plus, Search, Settings2, SquarePen, Unplug, X,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useWorkspace } from "./workspace";
import { ZLogo, IconButton, relativeTime } from "./ui";
import { loadPrefs, savePrefs } from "./state/prefs";
import { ChatPanel } from "./components/ChatPanel";
import { RightPanel } from "./components/RightPanel";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog } from "./components/SettingsDialog";

type SessionRow = { id: string; title: string; directory: string; updatedAt: number };

export function App() {
  const { client, caps, token, setToken } = useWorkspace();
  const params = useParams({ strict: false }) as { workspace?: string; sessionId?: string };
  const navigate = useNavigate();
  const prefs = loadPrefs();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    (() => { try { return localStorage.getItem("zcode-sidebar-collapsed") === "1"; } catch { return false; } })()
  );
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [sidebarView, setSidebarView] = useState<"projects" | "sessions">("projects");
  const [modal, setModal] = useState<null | "search" | "settings">(null);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error"; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type, key: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("zcode-sidebar-collapsed", sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const t = event.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setModal("search"); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); navigateNewChat(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); setSidebarCollapsed((c) => !c); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); setRightCollapsed((c) => !c); }
      if (event.key === "Escape") setModal(null);
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const roots = caps?.allowedRoots || [];
  const cwd = useMemo(() => {
    if (params.workspace) {
      const decoded = decodeURIComponent(params.workspace);
      if (roots.some((r) => decoded === r || decoded.startsWith(r))) return decoded;
    }
    return prefs.rootPath && roots.includes(prefs.rootPath) ? prefs.rootPath : roots[0] || "";
  }, [params.workspace, roots, prefs.rootPath]);

  const navigateToCwd = useCallback((dir: string) => {
    navigate({ to: "/w/$workspace", params: { workspace: encodeURIComponent(dir) } });
  }, [navigate]);

  const navigateNewChat = useCallback(() => {
    navigateToCwd(cwd || decodeURIComponent(params.workspace || ""));
  }, [cwd, params.workspace, navigateToCwd]);

  // sessions of the current cwd (task rows under the active "project")
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cwd || !client) return;
    client.sessions(cwd)
      .then((r) => { if (alive) { setSessions(r.sessions); } })
      .catch(() => { if (alive) setSessions([]); });
    return () => { alive = false; };
  }, [cwd, client, token]);

  const activeSessionId = params.sessionId || null;
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // recent sessions across the current root for the "Sessions" view
  const [recent, setRecent] = useState<SessionRow[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cwd || sidebarView !== "sessions") return;
    void fetch(`/api/sessions/recent?root=${encodeURIComponent(rootOf(cwd, roots))}`, {
      headers: { authorization: `Bearer ${loadTokenSafe()}` },
    })
      .then((r) => r.json())
      .then((j) => { if (alive) setRecent(j.sessions || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cwd, sidebarView, token]);

  function selectSession(id: string) {
    navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace: encodeURIComponent(cwd), sessionId: id } });
  }

  if (!caps) {
    return <main className="workspace-loading"><div className="loading-brand"><ZLogo size={35} /><span>zcode</span></div><span className="loading-line" /><p>Opening your workspace…</p></main>;
  }

  const providerLive = caps.providerConfigured;
  const projectLabel = cwd ? baseName(cwd) : "workspace";

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
      <header className="brand-header">
        <button className="brand-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label="Toggle workspace navigation">
          <ZLogo size={25} /><span className="brand-name">zcode</span>
        </button>
        <span className="web-badge">web</span>
        <IconButton label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><PanelLeft size={15} /></IconButton>
      </header>

      <header className="topbar">
        <IconButton label="Open navigation" className="mobile-menu-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><Menu size={17} /></IconButton>
        <div className="breadcrumbs">
          <button onClick={() => navigateToCwd(cwd)}><FolderClosed size={13} /><span>{projectLabel}</span></button>
          <span className="breadcrumb-divider">/</span>
          <h1>{activeSession?.title || "New chat"}</h1>
        </div>
        <div className="topbar-actions">
          <span className="save-status"><CloudCheck size={14} /><span>{jobsActive() ? "Working…" : "All changes saved"}</span></span>
          <IconButton label={rightCollapsed ? "Show preview panel" : "Hide preview panel"} className="desktop-pane-button" onClick={() => setRightCollapsed(!rightCollapsed)}><PanelRight size={16} /></IconButton>
          <div className="task-menu-wrap">
            <IconButton label="Settings" onClick={() => setModal("settings")}><Settings2 size={17} /></IconButton>
          </div>
        </div>
      </header>

      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="primary-nav">
          <button className="nav-button new-task-button" onClick={navigateNewChat} title="New chat"><SquarePen size={16} /><span className="nav-label">New chat</span><kbd>⌘ N</kbd></button>
          <button className="nav-button" onClick={() => setModal("search")} title="Search sessions"><Search size={16} /><span className="nav-label">Search sessions</span><kbd>⌘ K</kbd></button>
          <button className="nav-button" onClick={() => { updatePrefs({ rootPath: roots.find((r) => r !== cwd) || roots[0] || "" }); notify("Switched workspace root."); }} title="Open workspace"><FolderOpen size={16} /><span className="nav-label">Open workspace</span></button>
        </div>
        <div className="sidebar-viewbar">
          <div className="view-switch" role="tablist" aria-label="Sidebar view">
            <button role="tab" aria-selected={sidebarView === "projects"} className={sidebarView === "projects" ? "active" : ""} onClick={() => setSidebarView("projects")} title="Group sessions by project"><FolderClosed size={13} /><span className="nav-label">Projects</span></button>
            <button role="tab" aria-selected={sidebarView === "sessions"} className={sidebarView === "sessions" ? "active" : ""} onClick={() => setSidebarView("sessions")} title="Recent sessions in this root"><History size={13} /><span className="nav-label">Sessions</span></button>
          </div>
        </div>
        <div className="sidebar-section"><span>{sidebarView === "projects" ? "PROJECTS" : "RECENT SESSIONS"}</span><div><IconButton label="New chat" onClick={navigateNewChat}><Plus size={14} /></IconButton></div></div>
        <div className="project-list">
          {sidebarView === "sessions" ? (
            <div className="sessions-list">
              {recent.map((s) => (
                <div className={`task-row ${s.id === activeSessionId ? "active" : ""}`} key={s.id}>
                  <button className="task-link" onClick={() => selectSession(s.id)} title={s.title}>
                    <span className="task-dot" />
                    <span className="task-title-wrap"><span className="task-title">{prefs.displayAliases[s.id] || s.title || s.id}</span></span>
                    <time>{relativeTime(s.updatedAt)}</time>
                  </button>
                </div>
              ))}
              {!recent.length && <p className="no-tasks">No sessions yet.</p>}
            </div>
          ) : (
            <ProjectGroups
              roots={roots}
              activeSessionId={activeSessionId}
              onSelectSession={selectSession}
              onSelectProject={(dir) => { updatePrefs({ rootPath: dir }); navigateToCwd(dir); }}
            />
          )}
        </div>
        <div className="secondary-nav">
          <button className="nav-button" title="Workspace tools" onClick={() => notify("Workspace tools: files/git/preview capabilities — see the inspector.", "success")}><Unplug size={15} /><span className="nav-label">Workspace tools</span><span className="tools-dot" /></button>
          <button className="nav-button" title="Help and shortcuts" onClick={() => notify("Shortcuts: ⌘K search · ⌘N new chat · ⌘B sidebar · ⌘J preview pane", "success")}><CircleHelp size={15} /><span className="nav-label">Help & shortcuts</span></button>
        </div>
        <div className="profile-section">
          <button className="profile-button" title="Settings" onClick={() => setModal("settings")}>
            <span className="profile-avatar">Z</span>
            <span className="profile-info"><strong>{providerLive ? "Z.AI enabled" : "No provider"}</strong><small>{projectLabel}</small></span>
          </button>
          <IconButton label="Settings" onClick={() => setModal("settings")}><Settings2 size={15} /></IconButton>
        </div>
      </aside>

      <div className="workspace-main">
        <ChatPanel
          key={cwd + "/" + (activeSessionId || "new")}
          client={client}
          cwd={cwd}
          sessionId={activeSessionId}
          modes={caps.modes}
          defaultMode={caps.modes.includes(prefs.mode) ? prefs.mode : caps.modes[0] || "plan"}
          onNotify={notify}
        />
        {!rightCollapsed ? (
          <RightPanel cwd={cwd} onCollapse={() => setRightCollapsed(true)} />
        ) : (
          <div className="pane-rail" aria-label="Preview panel collapsed">
            <IconButton label="Show preview panel" onClick={() => setRightCollapsed(false)}><PanelRight size={15} /></IconButton>
            <span className="rail-label">Preview</span>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <div>
          <span className="status-brand"><ZLogo size={12} /><span>Zcode for web</span></span>
          <span className="status-divider" />
          <span className="status-db"><span className={`tiny-dot ${caps.dbPresent ? "green" : ""}`} />{caps.dbPresent ? "Workspace synced" : "No session DB"}</span>
        </div>
        <div>
          <button onClick={() => setModal("settings")}>{providerLive ? "Z.AI enabled" : "No provider"}</button>
          <span>{jobsActive() ? `${jobsActive()} running` : "idle"}</span>
          <button className="shortcut-button" aria-label="Keyboard shortcuts" onClick={() => notify("Shortcuts: ⌘K search · ⌘N new chat · ⌘B sidebar · ⌘J preview", "success")}><Keyboard size={12} /></button>
        </div>
      </footer>

      {modal === "search" && (
        <SearchDialog
          onClose={() => setModal(null)}
          onSelect={(id) => selectSession(id)}
        />
      )}
      {modal === "settings" && (
        <SettingsDialog caps={caps} onClose={() => setModal(null)} onLogout={() => { clearTokenSafe(); setToken(""); }} />
      )}
      {toast && (
        <div className={`toast ${toast.type}`} role={toast.type === "error" ? "alert" : "status"} key={toast.key}>
          {toast.type === "error" ? <CircleHelp size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.text}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      {needsToken() && <TokenPrompt onSubmit={(t) => setToken(t)} />}
    </main>
  );

  function jobsActive() {
    return 0; // authoritative count comes from job polls inside runs
  }
  function needsToken() {
    return Boolean(caps?.authRequired) && !token;
  }
  function updatePrefs(patch: Parameters<typeof savePrefs>[0]) {
    savePrefs(patch);
  }
  function loadTokenSafe() {
    try { return localStorage.getItem("zcode-web-token") || ""; } catch { return ""; }
  }
  function clearTokenSafe() {
    try { localStorage.removeItem("zcode-web-token"); } catch {}
    location.reload();
  }
}

function TokenPrompt({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="modal-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Access token required">
        <header className="dialog-header"><div><h2>Access token required</h2><p>Paste the deployment's ZCODE_WEB_TOKEN to continue.</p></div></header>
        <input
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(v.trim())}
          placeholder="token"
          style={{ width: "100%", marginBottom: 12 }}
        />
        <button className="primary-button" onClick={() => onSubmit(v.trim())}>Continue</button>
      </div>
    </div>
  );
}

function ProjectGroups({ roots, activeSessionId, onSelectSession, onSelectProject }: {
  roots: string[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onSelectProject: (dir: string) => void;
}) {
  const token = (() => { try { return localStorage.getItem("zcode-web-token") || ""; } catch { return ""; } })();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dirsByRoot, setDirsByRoot] = useState<Record<string, string[]>>({});
  const [sessionsByDir, setSessionsByDir] = useState<Record<string, SessionRow[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/projects", { headers: { authorization: `Bearer ${token}` } });
        const j = await r.json();
        if (!alive) return;
        const map: Record<string, string[]> = {};
        for (const root of j.roots || []) map[root.path] = root.projects;
        setDirsByRoot(map);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  function toggle(dir: string) {
    setOpen((o) => ({ ...o, [dir]: !o[dir] }));
    if (!sessionsByDir[dir]) {
      void fetch(`/api/sessions?cwd=${encodeURIComponent(dir)}`, { headers: { authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((j) => setSessionsByDir((m) => ({ ...m, [dir]: j.sessions || [] })))
        .catch(() => setSessionsByDir((m) => ({ ...m, [dir]: [] })));
    }
  }

  if (error) return <div className="error-text">{error}</div>;

  return (
    <>
      {roots.map((root) => {
        const dirs = dirsByRoot[root] || [];
        return (
          <div className="sidebar-group" key={root}>
            <div className="group-heading">
              <button className="group-toggle" onClick={() => toggle(root)} aria-expanded={!!open[root]}>
                <ChevronDown size={12} className={open[root] ? "" : "rotate-negative-90"} />
                <FolderClosed size={14} className="folder-color" />
                <span>{baseName(root)}</span>
                <span className="project-task-count">{dirs.length}</span>
              </button>
              <IconButton label={`New chat in ${baseName(root)}`} onClick={() => onSelectProject(root)}><Plus size={12} /></IconButton>
            </div>
            {open[root] && (
              <div className="group-projects">
                {!dirs.length && <p className="no-tasks">No projects in this root.</p>}
                {dirs.map((d) => {
                  const dir = root.replace(/\/$/, "") + "/" + d;
                  const rows = sessionsByDir[dir];
                  const isOpen = open[dir];
                  return (
                    <div className="project-group" key={dir}>
                      <div className="project-heading">
                        <button className="project-toggle" onClick={() => toggle(dir)} aria-expanded={!!isOpen}>
                          <ChevronRight size={12} className={isOpen ? "rotate-90" : ""} />
                          <FolderClosed size={13} className="folder-color" />
                          <span>{d}</span>
                        </button>
                        <IconButton label={`Open ${d}`} onClick={() => onSelectProject(dir)}><ChevronRight size={12} /></IconButton>
                      </div>
                      {isOpen && (
                        <div className="project-tasks">
                          {(rows || []).map((s) => (
                            <div className={`task-row ${activeSessionId === s.id ? "active" : ""}`} key={s.id}>
                              <button className="task-link" onClick={() => onSelectSession(s.id)} title={s.title}>
                                <span className="task-dot" />
                                <span className="task-title-wrap"><span className="task-title">{s.title || s.id}</span></span>
                                <time>{relativeTime(s.updatedAt)}</time>
                              </button>
                            </div>
                          ))}
                          {rows && !rows.length && <p className="no-tasks">No sessions.</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function baseName(p: string) {
  return p.split("/").filter(Boolean).pop() || p;
}
function rootOf(cwd: string, roots: string[]) {
  return roots.find((r) => cwd === r || cwd.startsWith(r + "/")) || cwd;
}
