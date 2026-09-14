// App shell ported to the reference design (user-provided sample):
// brand header, topbar breadcrumbs, collapsible sidebar (Projects/Sessions
// views, project groups with session task-rows), chat + right panel, statusbar.
// State ownership (ZWUI-006): runs live in a registry keyed by jobId —
// navigating never retargets or cancels a job.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowDownWideNarrow, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CloudCheck, Eye, EyeOff, KeyRound,
  FolderClosed, FolderOpen, History, Keyboard, LoaderCircle, Menu, MoreHorizontal, PanelLeft, PanelRight, Pin, PinOff, Plus,
  Search, Settings2, SquarePen, Unplug, WandSparkles, X, GitBranch,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useWorkspace } from "./workspace";
import { ZLogo, IconButton, relativeTime, useMediaQuery, useDialogA11y } from "./ui";
import { loadPrefs, savePrefs } from "./state/prefs";
import type * as prefsMod from "./state/prefs";
import { ChatPanel } from "./components/ChatPanel";
import { RightPanel } from "./components/RightPanel";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutsDialog, SkillsDialog, ToolsDialog } from "./components/InfoDialogs";
import { AnalyticsDialog } from "./components/AnalyticsDialog";

type SessionRow = {
  id: string; title: string; directory: string; updatedAt: number;
  goal?: { objective: string; status: string; tokensUsed: number; timeUsedSeconds: number; updatedAt: number } | null;
};

export function App() {
  const { client, caps, token, setToken } = useWorkspace();
  const params = useParams({ strict: false }) as { workspace?: string; sessionId?: string };
  const navigate = useNavigate();
  const prefs = loadPrefs();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    (() => { try { return localStorage.getItem("zcode-sidebar-collapsed") === "1"; } catch { return false; } })()
  );
  // user-resizable sidebar width (drag the divider; persisted). The fixed
  // per-breakpoint widths only apply while no custom width has been set.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem("zcode-sidebar-width"));
      return v >= 190 && v <= 460 ? v : null;
    } catch { return null; }
  });
  const resizing = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    try {
      if (sidebarWidth === null) localStorage.removeItem("zcode-sidebar-width");
      else localStorage.setItem("zcode-sidebar-width", String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    resizing.current = { startX: e.clientX, startW: sidebarWidth ?? 238 };
    document.body.classList.add("is-col-resizing");
  }, [sidebarCollapsed, sidebarWidth]);
  const moveSidebarResize = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const next = Math.min(460, Math.max(190, resizing.current.startW + (e.clientX - resizing.current.startX)));
    setSidebarWidth((w) => (w === next ? w : next));
  }, []);
  const endSidebarResize = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.classList.remove("is-col-resizing");
  }, []);
  // user-resizable inspector width (drag the divider; persisted). The panel
  // is a FIXED-width column — the chat owns everything else.
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem("zcode-panel-width"));
      return v >= 280 && v <= 900 ? v : null;
    } catch { return null; }
  });
  const resizingPanel = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    try {
      if (panelWidth === null) localStorage.removeItem("zcode-panel-width");
      else localStorage.setItem("zcode-panel-width", String(panelWidth));
    } catch {}
  }, [panelWidth]);
  const startPanelResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizingPanel.current = { startX: e.clientX, startW: panelWidth ?? 420 };
    document.body.classList.add("is-col-resizing");
  }, [panelWidth]);
  const movePanelResize = useCallback((e: React.PointerEvent) => {
    if (!resizingPanel.current) return;
    // dragging LEFT widens the panel (it sits on the right edge)
    const next = Math.min(900, Math.max(280, resizingPanel.current.startW - (e.clientX - resizingPanel.current.startX)));
    setPanelWidth((w) => (w === next ? w : next));
  }, []);
  const endPanelResize = useCallback((e: React.PointerEvent) => {
    if (!resizingPanel.current) return;
    resizingPanel.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.classList.remove("is-col-resizing");
  }, []);
  // keyboard resizing on the splitters (separator pattern): arrows move by
  // 16px (48 with shift), Home/End restore the responsive default width
  const sidebarKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const cur = sidebarWidth ?? 238;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSidebarWidth(Math.max(190, cur - step)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setSidebarWidth(Math.min(460, cur + step)); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); setSidebarWidth(null); }
  }, [sidebarWidth]);
  const panelKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const cur = panelWidth ?? 420;
    // ArrowLeft widens the panel — same direction as dragging it leftward
    if (e.key === "ArrowLeft") { e.preventDefault(); setPanelWidth(Math.min(900, cur + step)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setPanelWidth(Math.max(280, cur - step)); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); setPanelWidth(null); }
  }, [panelWidth]);
  // inspector starts collapsed (chat owns the width); the user's choice persists
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try { return localStorage.getItem("zcode-right-collapsed") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("zcode-right-collapsed", rightCollapsed ? "1" : "0"); } catch {}
  }, [rightCollapsed]);
  // Responsive shell state (ZPAR-016): below 1100px the sidebar is an icon
  // rail; `navOpen` turns it into the fixed overlay drawer the stylesheet
  // already styles (`.is-sidebar-open`). Below 821px chat and inspector are
  // exclusive panes; `mobilePreview` flips between them (`.preview-active`).
  const [navOpen, setNavOpen] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const isNarrowNav = useMediaQuery("(max-width: 1099px)");
  const isPane = useMediaQuery("(max-width: 820px)");
  // chat text scale (device-local; changed from Settings → Text size)
  const [fontSize, setFontSizeState] = useState<prefsMod.FontSize>(() => loadPrefs().fontSize);
  useEffect(() => {
    const onCustom = (e: Event) => { const fs = (e as CustomEvent<string>).detail as prefsMod.FontSize; if (fs) setFontSizeState(fs); };
    const onStorage = () => setFontSizeState(loadPrefs().fontSize);
    window.addEventListener("zcode-fontsize", onCustom);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("zcode-fontsize", onCustom); window.removeEventListener("storage", onStorage); };
  }, []);
  // Sessions is the default active view (persisted; an explicit Projects
  // choice is remembered too)
  const [sidebarView, setSidebarView] = useState<"projects" | "sessions">(
    (() => { try { return localStorage.getItem("zcode-sidebar-view") === "projects" ? "projects" : "sessions"; } catch { return "sessions"; } })()
  );
  const [sidebarSort, setSidebarSort] = useState<"recent" | "name">(
    (() => { try { const v = localStorage.getItem("zcode-sidebar-sort"); return v === "name" ? "name" : "recent"; } catch { return "recent"; } })()
  );
  const [sortMenu, setSortMenu] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "search" | "settings" | "shortcuts" | "tools" | "skills" | "analytics">(null);
  const [taskMenu, setTaskMenu] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [transcriptReload, setTranscriptReload] = useState(0);
  // titles seen in transcript fetches — deep-linked sessions outside the
  // recent list still show their real title (desktop parity)
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  // real CLI skills for the launcher (fetched once per page load)
  const [skills, setSkills] = useState<{ list: import("./api/client").SkillInfo[]; loading: boolean; error: string | null }>({ list: [], loading: true, error: null });
  const [draft, setDraft] = useState<{ text: string; key: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error"; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type, key: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    // errors need reading time; successes are confirmations
    toastTimer.current = setTimeout(() => setToast(null), type === "error" ? 6000 : 3500);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("zcode-sidebar-collapsed", sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed]);
  useEffect(() => {
    try { localStorage.setItem("zcode-sidebar-sort", sidebarSort); } catch {}
  }, [sidebarSort]);
  useEffect(() => {
    try { localStorage.setItem("zcode-sidebar-view", sidebarView); } catch {}
  }, [sidebarView]);
  useEffect(() => {
    if (!sortMenu && !taskMenu) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".sort-menu-wrap")) setSortMenu(false);
      if (!el.closest(".task-menu-wrap")) setTaskMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortMenu, taskMenu]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const t = event.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      // ⌘N intentionally NOT intercepted — the browser owns New Window
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setModal("search"); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); setSidebarCollapsed((c) => !c); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); setRightCollapsed((c) => !c); }
      if (event.key === "Escape") { setModal(null); setTaskMenu(false); setSortMenu(false); setNavOpen(false); }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const activeSessionId = params.sessionId || null;
  const roots = caps?.allowedRoots || [];
  const cwd = useMemo(() => {
    if (params.workspace) {
      const decoded = safeDecode(params.workspace);
      if (roots.some((r) => decoded === r || decoded.startsWith(r))) return decoded;
    }
    return prefs.rootPath && roots.includes(prefs.rootPath) ? prefs.rootPath : roots[0] || "";
  }, [params.workspace, roots, prefs.rootPath]);

  // $workspace params are encoded by the router — pass the RAW path and let it
  // encode once; pre-encoding here double-encodes (%2F becomes %252F)
  const navigateToCwd = useCallback((dir: string) => {
    navigate({ to: "/w/$workspace", params: { workspace: dir } });
  }, [navigate]);

  // bumping this signals the chat panel that any run shown there belongs to
  // a previous "new chat" — it detaches (the job keeps running server-side)
  const [newChatNonce, setNewChatNonce] = useState(0);
  const navigateNewChat = useCallback(() => {
    setNewChatNonce((n) => n + 1);
    setNavOpen(false);
    // on pane widths, a new chat happens in the chat pane
    setMobilePreview(false);
    navigateToCwd(cwd || safeDecode(params.workspace || ""));
  }, [cwd, params.workspace, navigateToCwd]);

  // stable identities for ChatPanel effect deps — inline arrows here would
  // retrigger its fetch/poll effects on every App render
  const onSlashAction = useCallback((action: string) => {
    if (action === "new") { navigateNewChat(); return true; }
    if (action === "search" || action === "skills" || action === "tools" || action === "settings" || action === "shortcuts") { setModal(action); return true; }
    return false;
  }, [navigateNewChat]);
  const onSessionMeta = useCallback((s: { id: string; title: string; directory?: string }) => {
    setSessionTitles((m) => (m[s.id] === s.title ? m : { ...m, [s.id]: s.title }));
    if (s.directory && s.id === activeSessionId) {
      const canonical = safeDecode(s.directory);
      if (canonical && cwd && canonical !== cwd && roots.some((r) => canonical === r || canonical.startsWith(r))) {
        navigate({
          to: "/w/$workspace/s/$sessionId",
          params: { workspace: canonical, sessionId: s.id },
          replace: true,
        });
      }
    }
  }, [activeSessionId, cwd, roots, navigate]);

  // sessions of the current cwd (task rows under the active "project")
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const refreshSessions = useCallback(() => {
    if (!cwd || !client) return;
    void client.sessions(cwd)
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, [cwd, client]);
  const [renaming, setRenaming] = useState<{ title: string; busy: boolean } | null>(null);


  useEffect(() => {
    let alive = true;
    if (!cwd || !client) return;
    void client.sessions(cwd)
      .then((r) => { if (alive) setSessions(r.sessions); })
      .catch(() => { if (alive) setSessions([]); });
    // the desktop creates sessions too — follow along while the tab is open
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void client.sessions(cwd)
        .then((r) => { if (alive) setSessions(r.sessions); })
        .catch(() => {});
    }, 30_000);
    return () => { alive = false; clearInterval(poll); };
  }, [cwd, client, token]);
  useEffect(() => {
    let alive = true;
    if (!client) return;
    void client.skills()
      .then((r) => { if (alive) setSkills({ list: r.skills, loading: false, error: null }); })
      .catch((e) => { if (alive) setSkills((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })); });
    return () => { alive = false; };
  }, [client, token]);
  // statusbar branch chip (only when the read-only git capability is enabled)
  useEffect(() => {
    let alive = true;
    void fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } })
      // always consume the body: an unread fetch body keeps the request
      // in-flight in Chromium and breaks networkidle-based waits
      .then((r) => r.json().catch(() => null))
      .then((j) => { if (alive && j?.branch) setBranch(j.branch); else if (alive) setBranch(null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cwd]);

  const renameSession = useCallback(async () => {
    if (!activeSessionId || !renaming?.title.trim() || renaming.busy) return;
    setRenaming((r) => (r ? { ...r, busy: true } : r));
    try {
      const r = await fetch(`/api/sessions/${activeSessionId}/rename`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${loadTokenSafe()}` },
        body: JSON.stringify({ title: renaming.title.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "rename failed");
      notify("Session renamed.");
      setRenaming(null);
      refreshSessions();
    } catch (e) {
      notify((e as Error).message, "error");
      setRenaming((r2) => (r2 ? { ...r2, busy: false } : r2));
    }
  }, [activeSessionId, renaming, notify, refreshSessions]);
  const listed = sessions.find((s) => s.id === activeSessionId) || null;
  const activeSession = listed
    || (activeSessionId && sessionTitles[activeSessionId]
      ? { id: activeSessionId, title: sessionTitles[activeSessionId], directory: cwd, createdAt: 0, updatedAt: 0, goal: null }
      : null);

  // "Sessions" view: the LATEST 50 across all allowed roots (like the search
  // dialog's empty state). The row label shows each session's project, so a
  // global list still reads clearly. Re-selecting still merges the active
  // project's own sessions to the top via pinned/sort below.
  const [recent, setRecent] = useState<SessionRow[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cwd || sidebarView !== "sessions") return;
    const load = () => {
      void fetch("/api/sessions/recent?limit=50", {
        headers: { authorization: `Bearer ${loadTokenSafe()}` },
      })
        .then((r) => r.json())
        .then((j) => { if (alive) setRecent(j.sessions || []); })
        .catch(() => {});
    };
    load();
    // the desktop adds sessions too — follow along while this view is open
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load();
    }, 30_000);
    return () => { alive = false; clearInterval(poll); };
  }, [cwd, sidebarView, token]);

  function selectSession(id: string, directory?: string) {
    const targetDir = directory || recent.find((r) => r.id === id)?.directory || sessions.find((s) => s.id === id)?.directory || cwd;
    setNavOpen(false);
    setMobilePreview(false);
    if (id === activeSessionId && targetDir === cwd) {
      // re-selecting the open session pulls the transcript fresh — the
      // ZCode app may have continued it meanwhile (shared session store)
      setTranscriptReload((k) => k + 1);
      return;
    }
    navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace: targetDir, sessionId: id } });
  }

  // refresh the inspector (Changes/Code) whenever a run finishes — the agent
  // may have touched the working tree
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !runBusy) setPanelRefreshKey((k) => k + 1);
    prevBusy.current = runBusy;
  }, [runBusy]);

  if (!caps) {
    return <main className="workspace-loading"><div className="loading-brand"><ZLogo size={35} /><span>zcode</span></div><span className="loading-line" /><p>Opening your workspace…</p></main>;
  }

  const providerLive = caps.providerConfigured;
  const projectLabel = cwd ? baseName(cwd) : "workspace";

  return (
    <main
      className={`app-shell fs-${fontSize} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${navOpen ? "is-sidebar-open" : ""} ${sidebarWidth ? "sidebar-resized" : ""}`}
      style={sidebarWidth && !sidebarCollapsed ? ({ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties) : undefined}
      data-fs={fontSize}
    >
      <header className="brand-header">
        <button
          className="brand-button"
          aria-label={isNarrowNav ? "Open workspace navigation" : "Toggle workspace navigation"}
          aria-expanded={isNarrowNav ? navOpen : !sidebarCollapsed}
          onClick={() => (isNarrowNav ? setNavOpen(true) : setSidebarCollapsed(!sidebarCollapsed))}
        >
          <ZLogo size={25} /><span className="brand-name">zcode</span>
        </button>
        <span className="web-badge">web</span>
        <IconButton label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><PanelLeft size={15} /></IconButton>
      </header>

      <header className="topbar">
        <IconButton
          label="Open navigation"
          className="mobile-menu-button"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        ><Menu size={17} /></IconButton>
        <span className="history-nav">
          <IconButton label="Back" onClick={() => window.history.back()}><ChevronLeft size={16} /></IconButton>
          <IconButton label="Forward" onClick={() => window.history.forward()}><ChevronRight size={16} /></IconButton>
        </span>
        <div className="breadcrumbs">
          <button onClick={() => navigateToCwd(cwd)}><FolderClosed size={13} /><span>{projectLabel}</span></button>
          <span className="breadcrumb-divider">/</span>
          <h1 className="topbar-title" title={activeSession?.title || "New chat"}>{activeSession?.title || "New chat"}</h1>
          {activeSessionId && prefs.pinnedSessions.includes(activeSessionId) && <span className="mini-badge pinned-badge"><Pin size={8} />Pinned</span>}
        </div>
        <div className="topbar-actions">
          <span className="save-status">{runBusy ? <LoaderCircle size={12} className="spin" /> : <CloudCheck size={14} />}<span>{runBusy ? "Working…" : "All changes saved"}</span></span>
          <IconButton label={rightCollapsed ? "Show preview panel" : "Hide preview panel"} className="desktop-pane-button" onClick={() => setRightCollapsed(!rightCollapsed)}><PanelRight size={16} /></IconButton>
          <IconButton
            label={mobilePreview ? "Back to chat" : "Open preview panel"}
            className="mobile-preview-button"
            aria-pressed={mobilePreview}
            onClick={() => { setRightCollapsed(false); setMobilePreview((v) => !v); }}
          ><PanelRight size={16} /></IconButton>
          <div className="task-menu-wrap">
            <IconButton label="Session options" className={taskMenu ? "selected" : ""} onClick={() => setTaskMenu(!taskMenu)}><MoreHorizontal size={18} /></IconButton>
            {taskMenu && activeSessionId && (
              <div className="popover task-popover">
                <div className="popover-label">SESSION ACTIONS</div>
                <button onClick={() => { const pinned = !prefs.pinnedSessions.includes(activeSessionId); savePrefs({ pinnedSessions: pinned ? [...prefs.pinnedSessions, activeSessionId] : prefs.pinnedSessions.filter((x) => x !== activeSessionId) }); notify(pinned ? "Pinned to the top of your sidebar." : "Removed from pinned."); setTaskMenu(false); }}>
                  {prefs.pinnedSessions.includes(activeSessionId) ? <PinOff size={14} /> : <Pin size={14} />}{prefs.pinnedSessions.includes(activeSessionId) ? "Unpin session" : "Pin session"}
                </button>
                <button onClick={() => { setRenaming({ title: activeSession?.title || "", busy: false }); setTaskMenu(false); }}>
                  <SquarePen size={14} />Rename session
                </button>
                <button onClick={() => { savePrefs({ hiddenSessions: prefs.hiddenSessions.includes(activeSessionId) ? prefs.hiddenSessions.filter((x) => x !== activeSessionId) : [...prefs.hiddenSessions, activeSessionId] }); notify("Hidden on this device."); setTaskMenu(false); }}>
                  <Archive size={14} />{prefs.hiddenSessions.includes(activeSessionId) ? "Unhide on this device" : "Hide on this device"}
                </button>
                <div className="popover-divider" />
                <button onClick={() => { setModal("settings"); setTaskMenu(false); }}><Settings2 size={14} />Settings</button>
              </div>
            )}
            {taskMenu && !activeSessionId && (
              <div className="popover task-popover">
                <div className="popover-label">SESSION ACTIONS</div>
                <button onClick={() => { setModal("settings"); setTaskMenu(false); }}><Settings2 size={14} />Settings</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="primary-nav">
          <button className="nav-button new-task-button" onClick={navigateNewChat} title="New chat"><SquarePen size={16} /><span className="nav-label">New chat</span></button>
          <button className="nav-button" onClick={() => setModal("search")} title="Search sessions"><Search size={16} /><span className="nav-label">Search sessions</span><kbd>⌘ K</kbd></button>
          <button className="nav-button" onClick={() => { updatePrefs({ rootPath: roots.find((r) => r !== cwd) || roots[0] || "" }); notify("Switched workspace root."); }} title="Open workspace"><FolderOpen size={16} /><span className="nav-label">Open workspace</span></button>
        </div>
        <div className="sidebar-viewbar">
          <span className="sort-menu-wrap">
            <IconButton label="Change sidebar sorting" className={sortMenu ? "selected" : ""} onClick={() => setSortMenu(!sortMenu)}><ArrowDownWideNarrow size={13} /></IconButton>
            {sortMenu && (
              <div className="popover sort-popover">
                <div className="popover-label">SORT BY</div>
                {([["recent", "Most recent", "Latest activity first"], ["name", "Name", "Alphabetical order"]] as const).map(([id, label, hint]) => (
                  <button key={id} onClick={() => { setSidebarSort(id); setSortMenu(false); }}>
                    <span><b>{label}</b><small>{hint}</small></span>
                    {sidebarSort === id && <CheckCircle2 size={13} className="success-text" />}
                  </button>
                ))}
              </div>
            )}
          </span>
          <div className="view-switch" role="tablist" aria-label="Sidebar view">
            <button role="tab" aria-selected={sidebarView === "projects"} className={sidebarView === "projects" ? "active" : ""} onClick={() => setSidebarView("projects")} title="Group sessions by project"><FolderClosed size={13} /><span className="nav-label">Projects</span></button>
            <button role="tab" aria-selected={sidebarView === "sessions"} className={sidebarView === "sessions" ? "active" : ""} onClick={() => setSidebarView("sessions")} title="Latest 50 sessions"><History size={13} /><span className="nav-label">Sessions</span></button>
          </div>
        </div>
        <div className="sidebar-section">
          <span>{sidebarView === "projects" ? "PROJECTS" : "RECENT SESSIONS"}</span>
          <div>
            {navOpen && isNarrowNav && (
              <IconButton label="Close navigation" className="drawer-close" onClick={() => setNavOpen(false)}><X size={14} /></IconButton>
            )}
            <IconButton label="New chat" onClick={navigateNewChat}><Plus size={14} /></IconButton>
          </div>
        </div>
        <div className="project-list">
          {sidebarView === "sessions" ? (
            <div className="sessions-list">
              {prefs.pinnedSessions.length > 0 && (
                <div className="pinned-section">
                  <div className="pinned-heading"><Pin size={11} /><span>PINNED</span><span className="pinned-count">{prefs.pinnedSessions.filter((id) => recent.some((r) => r.id === id)).length}</span></div>
                  {prefs.pinnedSessions.map((id) => {
                    const row = recent.find((r) => r.id === id);
                    if (!row) return null;
                    return (
                      <button key={id} className={`pinned-row ${id === activeSessionId ? "active" : ""}`} onClick={() => selectSession(id, row.directory)} title={row.title}>
                        <span className={`task-dot ${id === activeSessionId ? "current" : ""}`} />
                        <span>{prefs.displayAliases[id] || row.title || id}</span>
                        <span className="pinned-kind">{row.directory.split("/").filter(Boolean).pop()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {[...recent]
                .filter((s) => !prefs.pinnedSessions.includes(s.id) && !prefs.hiddenSessions.includes(s.id))
                .sort((a, b) => (sidebarSort === "name" ? (a.title || "").localeCompare(b.title || "") : 0))
                .map((s) => (
                  <SessionRow
                    key={s.id}
                    row={s}
                    active={s.id === activeSessionId}
                    prefs={prefs}
                    onSelect={() => selectSession(s.id, s.directory)}
                    onPin={(pin) => savePrefs({ pinnedSessions: pin ? [...prefs.pinnedSessions, s.id] : prefs.pinnedSessions.filter((x) => x !== s.id) })}
                    onHide={() => savePrefs({ hiddenSessions: [...prefs.hiddenSessions, s.id] })}
                  />
                ))}
              {!recent.length && <p className="no-tasks">No sessions yet.</p>}
            </div>
          ) : (
            <ProjectGroups
              roots={roots}
              activeSessionId={activeSessionId}
              pinnedSessions={prefs.pinnedSessions}
              onSelectSession={selectSession}
              onSelectProject={(dir) => { updatePrefs({ rootPath: dir }); navigateToCwd(dir); }}
            />
          )}
        </div>
        <div className="secondary-nav">
          <button className="nav-button" title="Skills" onClick={() => setModal("skills")}><WandSparkles size={15} /><span className="nav-label">Skills</span><span className="nav-count">{skills.loading ? "…" : skills.list.length || ""}</span></button>
          <button className="nav-button" title="Workspace tools" onClick={() => setModal("tools")}><Unplug size={15} /><span className="nav-label">Workspace tools</span><span className="tools-dot" /></button>
          <button className="nav-button" title="Help and shortcuts" onClick={() => setModal("shortcuts")}><CircleHelp size={15} /><span className="nav-label">Help & shortcuts</span><CircleHelp size={12} className="nav-end" /></button>
        </div>
        <div className="profile-section">
          <button className="profile-button" title="Settings" onClick={() => setModal("settings")}>
            <span className="profile-avatar">Z</span>
            <span className="profile-info"><strong>{providerLive ? "Z.AI enabled" : "No provider"}</strong><small>{projectLabel}</small></span>
          </button>
          <IconButton label="Settings" onClick={() => setModal("settings")}><Settings2 size={15} /></IconButton>
        </div>
      </aside>
      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={190}
          aria-valuemax={460}
          aria-valuenow={sidebarWidth ?? 238}
          tabIndex={0}
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={endSidebarResize}
          onKeyDown={sidebarKeyDown}
          onDoubleClick={() => setSidebarWidth(null)}
        />
      )}
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div
        className={`workspace-main ${rightCollapsed ? "right-collapsed" : ""} ${mobilePreview ? "preview-active" : ""} ${panelExpanded ? "preview-expanded" : ""}`}
        style={panelWidth && !rightCollapsed && !panelExpanded ? ({ "--panel-w": `${panelWidth}px` } as React.CSSProperties) : undefined}
      >
        <ChatPanel
          key={cwd}
          client={client}
          cwd={cwd}
          sessionId={activeSessionId}
          sessionTitle={activeSession?.title}
          modes={caps.modes}
          defaultMode={caps.modes.includes(prefs.mode) ? prefs.mode : caps.modes[0] || "plan"}
          branch={branch}
          roots={roots}
          onNavigateCwd={navigateToCwd}
          providerLive={caps.providerConfigured}
          newChatNonce={newChatNonce}
          reloadKey={transcriptReload}
          injectedDraft={draft}
          onNotify={notify}
          onBusyChange={setRunBusy}
          onSlashAction={onSlashAction}
          onSessionMeta={onSessionMeta}
          onSessionCreated={(id) => {
            refreshSessions();
            if (id !== activeSessionId) {
              // replace (not push) when a fresh chat first gets its session,
              // so Back skips the empty pre-send state
              navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace: cwd, sessionId: id }, replace: !activeSessionId });
            }
          }}
        />
        {!rightCollapsed && !panelExpanded && (
          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            aria-valuemin={280}
            aria-valuemax={900}
            aria-valuenow={panelWidth ?? 420}
            tabIndex={0}
            onPointerDown={startPanelResize}
            onPointerMove={movePanelResize}
            onPointerUp={endPanelResize}
            onKeyDown={panelKeyDown}
            onDoubleClick={() => setPanelWidth(null)}
          />
        )}
        {!rightCollapsed ? (
          <RightPanel
            cwd={cwd}
            refreshKey={panelRefreshKey}
            runBusy={runBusy}
            sessionTitle={activeSession?.title}
            branch={branch}
            expanded={panelExpanded}
            onToggleExpanded={() => setPanelExpanded((v) => !v)}
            onCollapse={() => {
              // on pane widths the collapse control means "back to chat";
              // on desktop it hides the panel to the rail
              if (isPane) setMobilePreview(false);
              else setRightCollapsed(true);
            }}
            goal={activeSession?.goal}
          />
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
          {branch && <span className="branch-chip" title="git branch (read-only)"><GitBranch size={11} />{branch}</span>}
          <span className="status-db"><span className={`tiny-dot ${caps.dbPresent ? "green" : ""}`} />{caps.dbPresent ? "Workspace synced" : "No session DB"}</span>
        </div>
        <div>
          <button onClick={() => setModal("settings")}>{providerLive ? "Z.AI enabled" : "No provider"}</button>
          <button onClick={() => setModal("analytics")} title="Workspace analytics">Analytics</button>
          <span>{runBusy ? "1 running" : "idle"}</span>
          <button className="shortcut-button" aria-label="Keyboard shortcuts" onClick={() => setModal("shortcuts")}><Keyboard size={12} /></button>
        </div>
      </footer>

      {modal === "search" && (
        <SearchDialog
          onClose={() => setModal(null)}
          onSelect={(id, directory) => {
            // navigate into the session's own project directory
            setNavOpen(false);
            setMobilePreview(false);
            navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace: directory, sessionId: id } });
          }}
        />
      )}
      {modal === "settings" && (
        <SettingsDialog caps={caps} onClose={() => setModal(null)} onLogout={() => { clearTokenSafe(); setToken(""); }} />
      )}
      {renaming && activeSessionId && (
        <RenameDialog
          title={renaming.title}
          busy={renaming.busy}
          onChange={(title) => setRenaming((r) => (r ? { ...r, title } : r))}
          onCancel={() => setRenaming(null)}
          onSubmit={() => void renameSession()}
        />
      )}
      {modal === "shortcuts" && <ShortcutsDialog onClose={() => setModal(null)} />}
      {modal === "analytics" && (
        <AnalyticsDialog
          open
          token={loadTokenSafe()}
          onClose={() => setModal(null)}
          onSelectSession={(id, directory) => selectSession(id, directory)}
        />
      )}
      {modal === "tools" && <ToolsDialog caps={caps} onClose={() => setModal(null)} />}
      {modal === "skills" && (
        <SkillsDialog
          skills={skills.list}
          loading={skills.loading}
          error={skills.error}
          onClose={() => setModal(null)}
          onSelect={(name) => {
            setDraft({ text: `Use the ${name} skill: `, key: Date.now() });
            setModal(null);
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.type}`} role={toast.type === "error" ? "alert" : "status"} key={toast.key}>
          {toast.type === "error" ? <CircleHelp size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.text}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      {needsToken() && (
        <TokenPrompt
          isInvalid={Boolean(caps?.authRequired && token && !caps.workspaceRoot)}
          onSubmit={(t) => setToken(t)}
        />
      )}
    </main>
  );

  function needsToken() {
    return Boolean(caps?.authRequired) && (!token || !caps?.workspaceRoot);
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

function TokenPrompt({ onSubmit, isInvalid }: { onSubmit: (t: string) => void; isInvalid?: boolean }) {
  const [v, setV] = useState("");
  const [reveal, setReveal] = useState(false);
  return (
    <div className="modal-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Access token required">
        <header className="dialog-header">
          <div className="token-head">
            <span className="token-glyph"><KeyRound size={19} /></span>
            <div>
              <h2>{isInvalid ? "That token didn't take." : "Unlock this workspace."}</h2>
              <p>
                {isInvalid
                  ? "The token was rejected by the server. Check it against ZCODE_WEB_TOKEN in the deployment's .env and try again."
                  : "This deployment is protected. Paste its ZCODE_WEB_TOKEN once — it stays in this browser."}
              </p>
            </div>
          </div>
        </header>
        <form
          className="dialog-body"
          onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()); }}
        >
          <label className="field-label" htmlFor="token-input">Access token</label>
          <div className="token-field">
            <input
              id="token-input"
              type={reveal ? "text" : "password"}
              className="text-field mono"
              value={v}
              onChange={(e) => setV(e.target.value)}
              placeholder="zb…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <IconButton label={reveal ? "Hide token" : "Show token"} onClick={() => setReveal((r) => !r)}>
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
          </div>
          <div className="dialog-footer">
            <span className="muted">Stored locally · never sent anywhere but this server</span>
            <button className="primary-button" disabled={!v.trim()}>
              <CheckCircle2 size={13} />{isInvalid ? "Try again" : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RenameDialog({ title, busy, onChange, onCancel, onSubmit }: {
  title: string;
  busy: boolean;
  onChange: (title: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onCancel);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Rename session" ref={ref}>
        <header className="dialog-header"><div><h2>Give it a good name.</h2><p>Something that makes it easy to pick up where you left off.</p></div></header>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          <div className="dialog-body">
            <label className="field-label" htmlFor="rename-session">Session name</label>
            <input id="rename-session" className="text-field" autoFocus value={title} onChange={(e) => onChange(e.target.value)} maxLength={200} required />
          </div>
          <footer className="dialog-footer">
            <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
            <button className="primary-button" disabled={!title.trim() || busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <CheckCircle2 size={13} />}Save name</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function ProjectGroups({ roots, activeSessionId, pinnedSessions, onSelectSession, onSelectProject }: {
  roots: string[];
  activeSessionId: string | null;
  pinnedSessions: string[];
  onSelectSession: (id: string, directory: string) => void;
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

  async function toggle(dir: string) {
    setOpen((o) => ({ ...o, [dir]: !o[dir] }));
    // expanding a root group refreshes its directory listing so newly
    // created projects appear without a reload
    if (roots.includes(dir)) {
      try {
        const r = await fetch("/api/projects", { headers: { authorization: `Bearer ${token}` } });
        const j = await r.json();
        setDirsByRoot((m) => ({ ...m, ...(Object.fromEntries((j.roots || []).map((x: { path: string; projects: string[] }) => [x.path, x.projects]))) }));
      } catch { /* keep previous listing */ }
    }
    // re-fetch on every expand: a cached list hides newly finished chats
    void fetch(`/api/sessions?cwd=${encodeURIComponent(dir)}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => setSessionsByDir((m) => ({ ...m, [dir]: j.sessions || [] })))
      .catch(() => setSessionsByDir((m) => ({ ...m, [dir]: m[dir] || [] })));
  }

  if (error) return <div className="danger-text">{error}</div>;

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
                  // pinned sessions always float to the top of their project
                  const rows = [...(sessionsByDir[dir] || [])].sort(
                    (a, b) => Number(pinnedSessions.includes(b.id)) - Number(pinnedSessions.includes(a.id)),
                  );
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
                              <button className="task-link" onClick={() => onSelectSession(s.id, s.directory || dir)} title={s.title}>
                                <span className={`task-dot ${activeSessionId === s.id ? "current" : ""}`} />
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

function SessionRow({ row, active, prefs, onSelect, onPin, onHide }: {
  row: { id: string; title: string; updatedAt: number; directory: string };
  active: boolean;
  prefs: { pinnedSessions: string[]; displayAliases: Record<string, string> };
  onSelect: () => void;
  onPin: (pin: boolean) => void;
  onHide: () => void;
}) {
  const pinned = prefs.pinnedSessions.includes(row.id);
  return (
    <div className={`task-row ${active ? "active" : ""} ${pinned ? "is-pinned" : ""}`}>
      <button className="task-link" onClick={onSelect} title={`${row.title}${row.directory ? ` — ${row.directory}` : ""}`}>
        <span className={`task-dot ${active ? "current" : ""}`} />
        <span className="task-title-wrap"><span className="task-title">{prefs.displayAliases[row.id] || row.title || row.id}</span></span>
        <span className="task-project" title={row.directory}>{baseName(row.directory)}</span>
        <time>{relativeTime(row.updatedAt)}</time>
      </button>
      <span className="task-row-actions">
        {pinned && <Pin size={10} className="pinned-indicator" />}
        <IconButton label={pinned ? "Unpin" : "Pin"} className="task-pin" onClick={() => onPin(!pinned)}>
          {pinned ? <PinOff size={11} /> : <Pin size={11} />}
        </IconButton>
        <IconButton label="Hide on this device" className="task-archive" onClick={onHide}><Archive size={11} /></IconButton>
      </span>
    </div>
  );
}

function baseName(p: string) {
  return p.split("/").filter(Boolean).pop() || p;
}
// decode router params until stable: tolerates legacy double-encoded URLs
// (%252F) as well as the normal single-encoded form (%2F)
function safeDecode(v: string) {
  let out = v;
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}
