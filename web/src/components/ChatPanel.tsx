// ChatPanel ported to the reference design: context strip, messages-scroll
// with byline blocks, thinking + tool evidence, bottom composer with
// mode/model pickers, live-run "working" message. Run state comes from the
// ZWUI-016 reducer; transport from the ZWUI-017 controller.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeftRight, ArrowUp, ArrowUpRight, BadgeCheck, Brain, ChevronUp, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Coins, Copy, Eye, EyeOff, FileText, FoldVertical, FolderClosed, GitBranch, LoaderCircle, MessageSquare, MoreHorizontal, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Square, SquarePen, SquareTerminal, Terminal, Unplug, Wrench, X, Zap } from "lucide-react";
import { ZLogo, IconButton, Markdown, CheckMark, useDialogA11y, relativeTime } from "../ui";
import { randomUUID } from "../lib/uuid";
import { ApiError, type ApiClient, type CommandInfo, type FileCard, type ModelInfo, type SessionDetail, type TimelineEvent, type TranscriptTurn } from "../api/client";
import { isTerminal } from "../state/run";
import * as runs from "../state/runManager";
import { snapshotSubmission, mayClearDraft, type Submission } from "../lib/submission";
import { loadDraft, saveDraft, loadPrefs, savePrefs } from "../state/prefs";
import { AgentTerminalDrawer, TokenTelemetryDialog, type TerminalEntry } from "./Telemetry";

// zcode-artifact://<sessionId>/tool-result-<uuid> → server route args
function artifactArgs(url: string): { sessionId: string; uuid: string } | null {
  const m = url.match(/zcode-artifact:\/\/(sess_[A-Za-z0-9-]+)\/tool-result-([A-Za-z0-9-]+)$/);
  return m ? { sessionId: m[1], uuid: m[2] } : null;
}
const artifactUrl = (a: { sessionId: string; uuid: string }) => `/api/artifacts/${a.sessionId}/${a.uuid}`;

// One pending attachment: uploaded path for --attach plus the local File for
// in-composer preview (object URL created lazily, revoked on removal)
type Attachment = { name: string; path: string; file?: File; previewUrl?: string };
type PreviewState =
  | { kind: "image"; title: string; src: string }
  | { kind: "pdf"; title: string; src: string }
  | { kind: "text"; title: string; text: string };

export function ChatPanel({
  client, cwd, sessionId, sessionTitle, modes, defaultMode, branch, roots, onNavigateCwd, providerLive = true, newChatNonce = 0, reloadKey = 0, injectedDraft, onNotify, onSessionCreated, onBusyChange, onSlashAction, onSessionMeta,
}: {
  client: ApiClient;
  cwd: string;
  sessionId: string | null;
  sessionTitle?: string;
  modes: string[];
  defaultMode: string;
  branch?: string | null;
  /** allowed workspace roots — the project switcher */
  roots?: string[];
  /** navigate the shell to another project directory */
  onNavigateCwd?: (dir: string) => void;
  /** false → composer explains instead of failing on send */
  providerLive?: boolean;
  newChatNonce?: number;
  reloadKey?: number;
  injectedDraft?: { text: string; key: number } | null;
  onNotify: (text: string, type?: "success" | "error") => void;
  onSessionCreated?: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
  /** app-level slash actions (open dialogs, new chat) — true when handled */
  onSlashAction?: (action: string) => boolean;
  /** session metadata from transcript fetches (title lift for deep links) */
  onSessionMeta?: (s: { id: string; title: string; directory?: string }) => void;
}) {
  const draftKey = `${cwd}::${sessionId || "new"}`;
  // ZWUI-050: the run is OWNED by the job-keyed manager and survives view
  // switches and panel remounts; this panel only subscribes to it. A fresh
  // chat runs under `new:<nonce>` — the manager rekeys it to the session
  // when the server accepts and names it.
  const runKey = sessionId ?? `new:${newChatNonce}`;
  const run = useSyncExternalStore(
    useCallback((cb: () => void) => runs.subscribeRun(`${cwd}::${runKey}`, cb), [cwd, runKey]),
    useCallback(() => runs.getRun(`${cwd}::${runKey}`), [cwd, runKey]),
  );
  const [input, setInput] = useState(loadDraft(draftKey));
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mode, setMode] = useState(defaultMode);
  const [model, setModel] = useState("");
  const [menu, setMenu] = useState<"mode" | "model" | "project" | "view" | null>(null);
  // per-turn action menu ("…" byline control) — keyed by turn id
  const [turnMenu, setTurnMenu] = useState<string | null>(null);
  // project switcher data (roots → projects), fetched on first open
  const [projectsByRoot, setProjectsByRoot] = useState<Record<string, string[]> | null>(null);
  const openProjectMenu = useCallback(() => {
    setMenu((m) => (m === "project" ? null : "project"));
    if (projectsByRoot) return;
    const token = localStorage.getItem("zcode-web-token") || "";
    void fetch("/api/projects", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string[]> = {};
        for (const r of j.roots || []) map[r.path] = r.projects || [];
        setProjectsByRoot(map);
      })
      .catch(() => setProjectsByRoot({}));
  }, [projectsByRoot]);
  // "/" palette: local actions run in the app; send-through commands go to
  // the CLI as the prompt (it expands them — verified for /compact and
  // custom .zcode/commands)
  const [cmdIndex, setCmdIndex] = useState(0);
  const [customCommands, setCustomCommands] = useState<CommandInfo[]>([]);
  useEffect(() => {
    let alive = true;
    void client.commands(cwd)
      .then((r) => { if (alive) setCustomCommands(r.commands); })
      .catch(() => {});
    return () => { alive = false; };
  }, [client, cwd]);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // telemetry surfaces (ported from the clone, on real data): token audit
  // dialog, agent terminal drawer, relative/exact byline timestamps
  const [tokenDialog, setTokenDialog] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalClearedSig, setTerminalClearedSig] = useState<string | null>(null);
  const [exactTimes, setExactTimes] = useState(() => {
    try { return localStorage.getItem("zcode-exact-times") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("zcode-exact-times", exactTimes ? "1" : "0"); } catch {}
  }, [exactTimes]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [history, setHistory] = useState<{ turns: TranscriptTurn[]; total: number; hasMore: boolean }>({ turns: [], total: 0, hasMore: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastKey = useRef(draftKey);

  // models for the picker
  useEffect(() => {
    let alive = true;
    void client.models()
      .then((r) => {
        if (!alive) return;
        setModels(r.models);
        // Keep a valid user choice across reloads. Server default only wins
        // when saved model no longer exists.
        const saved = loadPrefs().model;
        setModel((cur) => cur || (r.models.find((m) => m.ref === saved) || r.models.find((m) => m.isDefault) || r.models[0])?.ref || "");
        if (saved && !r.models.some((m) => m.ref === saved)) savePrefs({ model: "" });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  // load transcript for an existing session
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  // a turn running from another writer (desktop/CLI): the composer locks and
  // the view shows progress until the store says the turn ended
  const [externalActive, setExternalActive] = useState(false);
  const [externalStartedAt, setExternalStartedAt] = useState<number | null>(null);
  const externalActiveRef = useRef(false);
  useEffect(() => { externalActiveRef.current = externalActive; }, [externalActive]);
  const applySessionPage = useCallback((d: SessionDetail) => {
    setHistory({ turns: d.transcript, total: d.total, hasMore: d.hasMore });
    setSessionTokensTotal(d.tokensTotal ?? null);
    setExternalActive(!!d.runActive);
    setExternalStartedAt(d.runStartedAt ?? null);
    if (d.session?.id && d.session?.title) onSessionMeta?.({ id: d.session.id, title: d.session.title, directory: d.session.directory });
  }, [onSessionMeta]);
  // incremental refresh: match turns by message id — known turns update in
  // place (streaming text grows), new ones append. Older pages the reader
  // paged in are preserved; no loader flash, no scroll jump.
  const mergeSessionPage = useCallback((d: SessionDetail) => {
    setHistory((cur) => {
      const merged = [...cur.turns];
      let changed = false;
      for (const t of d.transcript) {
        if (!t.id) continue;
        const idx = merged.findIndex((x) => x.id === t.id);
        if (idx >= 0) {
          if (JSON.stringify(merged[idx]) !== JSON.stringify(t)) { merged[idx] = t; changed = true; }
        } else {
          merged.push(t);
          changed = true;
        }
      }
      if (!changed && cur.total === d.total && cur.hasMore === d.hasMore) return cur;
      return { turns: merged, total: d.total, hasMore: d.hasMore };
    });
    setExternalActive(!!d.runActive);
    setExternalStartedAt(d.runStartedAt ?? null);
    if (d.tokensTotal != null) setSessionTokensTotal(d.tokensTotal);
    if (d.session?.id && d.session?.title) onSessionMeta?.({ id: d.session.id, title: d.session.title, directory: d.session.directory });
  }, [onSessionMeta]);
  // initial load — full replace only when the session (or an explicit
  // re-select reload) changes
  useEffect(() => {
    let alive = true;
    sessionEpochRef.current += 1;
    if (!sessionId) { setHistory({ turns: [], total: 0, hasMore: false }); setHistoryLoading(false); setExternalActive(false); return; }
    // selecting a session: clear the previous view, show a loader until the
    // transcript arrives, and re-arm follow-mode (the reader may have scrolled
    // up in the previous session)
    stickToBottom.current = true;
    setHistory({ turns: [], total: 0, hasMore: false });
    setHistoryLoading(true);
    void client.session(sessionId, 10, 0)
      .then((d) => { if (alive) applySessionPage(d); })
      .catch((e) => { if (alive) onNotify(e instanceof ApiError ? e.message : String(e), "error"); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [sessionId, client, onNotify, reloadKey, applySessionPage]);
  // visibility refresh merges instead of reloading — coming back to the tab
  // must not clear the view or drop paged-in history
  useEffect(() => {
    if (!syncTick || !sessionId) return;
    let alive = true;
    void client.session(sessionId, 10, 0)
      .then((d) => { if (alive) mergeSessionPage(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [syncTick]);
  // desktop↔web sync: both apps write the same session store, so pull the
  // transcript fresh when the tab becomes visible again (e.g. the ZCode app
  // continued the session meanwhile). Skipped while a run is attached here —
  // the live stream is the fresher source until it ends.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !sessionId) return;
      if (run.phase !== "idle" && !isTerminal(run.phase)) return;
      setSyncTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sessionId, run.phase]);
  // and poll while you watch: the desktop's in-progress turns land in the
  // shared store as they commit, so an open web view follows along — faster
  // while a turn is running elsewhere (progress + lock), 10s when idle.
  // Updates MERGE by turn id: no reload flash, paged-in history preserved.
  useEffect(() => {
    if (!sessionId) return;
    if (run.phase !== "idle" && !isTerminal(run.phase)) return;
    let alive = true;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      timer = null;
      if (fetching || document.visibilityState !== "visible") return;
      fetching = true;
      try {
        const d = await client.session(sessionId, 10, 0);
        if (alive) mergeSessionPage(d);
      } catch { /* transient */ }
      finally { fetching = false; }
      if (alive && !timer) timer = setTimeout(tick, externalActiveRef.current ? 4_000 : 10_000);
    };
    timer = setTimeout(tick, externalActiveRef.current ? 500 : 10_000);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [sessionId, run.phase, client, mergeSessionPage]);

  useEffect(() => {
    if (lastKey.current !== draftKey) { setInput(loadDraft(draftKey)); setAttachments([]); setMenu(null); draftRevRef.current = 0; lastKey.current = draftKey; }
  }, [draftKey]);
  // injected drafts (skills launcher) land in the composer, keeping what's
  // already typed; the saved draft follows so it survives a remount
  const lastInjected = useRef(0);
  useEffect(() => {
    if (!injectedDraft || injectedDraft.key === lastInjected.current) return;
    lastInjected.current = injectedDraft.key;
    const next = (input ? input.trimEnd() + " " : "") + injectedDraft.text;
    setInput(next);
    touchDraft();
    saveDraft(draftKey, next);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.length, next.length); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedDraft?.key]);
  useEffect(() => {
    const t = setTimeout(() => saveDraft(draftKey, input), 250);
    return () => clearTimeout(t);
  }, [input, draftKey]);
  // ZWUI-050: run ownership lives in the job-keyed manager — switching views
  // or remounting this panel never resets a run; the panel only follows it.
  // bumped on every session change; async history reads validate their epoch
  // after each await so a slow page can never land in the wrong conversation
  const sessionEpochRef = useRef(0);
  // the view identity (read in submit callbacks): acceptance navigates the
  // URL only when the user is still on the view that submitted
  const viewKeyRef = useRef(runKey);
  viewKeyRef.current = runKey;
  // draft revision — every composer edit bumps it, so a late acceptance can
  // only clear the draft revision that was actually submitted (ZWUI-041)
  const draftRevRef = useRef(0);
  const touchDraft = useCallback(() => { draftRevRef.current += 1; }, []);
  // a run adopted the session this view created — surface it so the URL and
  // sidebar catch up (the manager has already rekeyed the entry)
  useEffect(() => {
    if (!sessionId && run.sessionId && run.phase !== "idle" && viewKeyRef.current === `new:${newChatNonce}`) {
      // keep anything typed since submit: the draft key flips with the URL
      if (input) saveDraft(`${cwd}::${run.sessionId}`, input);
      onSessionCreated?.(run.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.sessionId]);
  // refresh the sidebar when a run finishes: the session row often commits
  // after the first envelope, so the creation-time refresh can miss it
  useEffect(() => {
    if (run.sessionId && isTerminal(run.phase)) onSessionCreated?.(run.sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase]);
  // stick to the newest message while streaming, like the desktop — unless
  // the reader has scrolled up (then leave their reading position alone)
  const stickToBottom = useRef(true);
  // "↓ latest" pill when the reader is away from the bottom — the standard
  // chat affordance for getting back after reading history
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const [externalTick, setExternalTick] = useState(0);
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scroll.current;
      if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
    });
  }, [run.answer, run.activity, run.submittedText, history]);
  useEffect(() => {
    // the desktop's live timer on an in-progress turn
    if (!externalActive || !externalStartedAt) return;
    const t = setInterval(() => {
      setExternalTick(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [externalActive, externalStartedAt]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".composer-menu-wrap") && !el.closest(".project-menu-wrap")) { setMenu(null); setTurnMenu(null); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setTurnMenu(null); } };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [menu, turnMenu]);

  const localBusy = run.phase !== "idle" && !isTerminal(run.phase);
  // the sent prompt echoes instantly; once the transcript commits the real
  // user turn (createdAt at/after submit), the echo retires
  const echoVisible = run.submittedText && run.phase !== "idle" && !(
    isTerminal(run.phase) &&
    history.turns.some((t) => t.role === "user" && t.text === run.submittedText && (t.createdAt || 0) >= run.submittedAt - 2000)
  );
  // busy either because a run is attached here or because the desktop/CLI is
  // mid-turn on this session — both mean "can't send yet"
  const busy = localBusy || externalActive;
  useEffect(() => { onBusyChange?.(busy); }, [busy]);

  // ---- "/" command palette ----
  type Cmd = { name: string; desc: string; run: () => void; group: string; sendThrough?: boolean };
  const commandList: Cmd[] = useMemo(() => {
    const local: Cmd[] = [
      { name: "new", desc: "Start a new chat", group: "Chat", run: () => { onSlashAction?.("new"); } },
      ...modes.map((m) => ({
        name: m,
        desc: `Switch to ${m} mode`,
        group: "Mode",
        run: () => { setMode(m); savePrefs({ mode: m }); },
      })),
      { name: "model", desc: "Choose the model", group: "Chat", run: () => { setMenu("model"); } },
      { name: "stop", desc: "Stop the running turn", group: "Chat", run: () => { stopRunRef.current?.(); } },
      { name: "search", desc: "Search sessions", group: "Navigate", run: () => { onSlashAction?.("search"); } },
      { name: "skills", desc: "Browse skills", group: "Navigate", run: () => { onSlashAction?.("skills"); } },
      { name: "tools", desc: "Browse tools", group: "Navigate", run: () => { onSlashAction?.("tools"); } },
      { name: "settings", desc: "Open settings", group: "Navigate", run: () => { onSlashAction?.("settings"); } },
      { name: "shortcuts", desc: "Keyboard shortcuts", group: "Navigate", run: () => { onSlashAction?.("shortcuts"); } },
    ];
    // /compact and /fork run headlessly (verified) and land as timeline
    // separators in the transcript
    const cliBuiltins: Cmd[] = [
      { name: "compact", desc: "Summarize the conversation to free context", group: "Run in session", sendThrough: true, run: () => {} },
      { name: "fork", desc: "Fork the session from the last checkpoint", group: "Run in session", sendThrough: true, run: () => {} },
    ];
    const custom: Cmd[] = customCommands.map((c) => ({
      name: c.name,
      desc: c.description || "Custom command",
      group: c.scope === "user" ? "Custom (user)" : "Custom (project)",
      sendThrough: true,
      run: () => {},
    }));
    return [...local, ...cliBuiltins, ...custom];
  }, [modes, customCommands, onSlashAction]);
  // palette shows while the draft is exactly "/query" (no space yet) and
  // wasn't dismissed with Escape for this draft
  const [cmdDismissed, setCmdDismissed] = useState(false);
  const cmdQuery = !cmdDismissed && input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  const cmdMatches = useMemo(
    () => (cmdQuery == null ? [] : commandList.filter((c) => c.name.toLowerCase().startsWith(cmdQuery))),
    [cmdQuery, commandList]
  );
  useEffect(() => { setCmdDismissed(false); }, [input]);
  useEffect(() => { setCmdIndex((i) => Math.min(i, Math.max(0, cmdMatches.length - 1))); }, [cmdMatches.length]);
  const stopRunRef = useRef<(() => void) | null>(null);
  const pickCommand = useCallback((c: Cmd) => {
    if (c.sendThrough) {
      // insert and keep focus — commands can take args after the name; Enter
      // then sends it as the prompt and the CLI expands/executes it
      setInput(`/${c.name} `);
      touchDraft();
      setCmdDismissed(true);
      textarea.current?.focus();
      return;
    }
    c.run();
    setInput("");
    touchDraft();
    saveDraft(draftKey, "");
    setCmdDismissed(true);
    textarea.current?.focus();
  }, [draftKey]);

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      onNotify("Clipboard is unavailable in this browser.", "error");
    }
  }

  // multi-file attach: upload each, keep the local File for click-to-preview
  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.onerror = () => reject(new Error("could not read file"));
          r.readAsDataURL(file);
        });
        const saved = await client.upload(file.name, data);
        setAttachments((a) => [...a, { name: saved.name, path: saved.path, file }]);
        touchDraft();
      } catch (e) {
        onNotify(`${file.name}: ${(e as Error).message}`, "error");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }, [client, onNotify]);

  const removeAttachment = useCallback((path: string) => {
    setAttachments((a) => {
      const gone = a.find((x) => x.path === path);
      // nothing to revoke yet — object URLs are created lazily on preview
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      touchDraft();
      return a.filter((x) => x.path !== path);
    });
  }, []);

  // preview a pending attachment (image inline, pdf in a frame, text as text)
  const previewAttachment = useCallback(async (att: Attachment) => {
    if (!att.file) return;
    const t = att.file.type;
    if (t.startsWith("image/")) {
      att.previewUrl = att.previewUrl || URL.createObjectURL(att.file);
      setPreview({ kind: "image", title: att.name, src: att.previewUrl });
    } else if (t === "application/pdf") {
      att.previewUrl = att.previewUrl || URL.createObjectURL(att.file);
      setPreview({ kind: "pdf", title: att.name, src: att.previewUrl });
    } else if (t.startsWith("text/") || /\.(txt|md|json|csv|log|ya?ml|toml|html?|css|js|jsx|ts|tsx|py|sh|xml)$/i.test(att.name)) {
      setPreview({ kind: "text", title: att.name, text: (await att.file.text()).slice(0, 200_000) });
    } else {
      onNotify(`No preview for ${att.name}`, "error");
    }
  }, [onNotify]);

  // preview a transcript artifact (server sniffs content type); pasted
  // attachments stored as plain host paths go through the files route
  const previewArtifact = useCallback(async (f: FileCard) => {
    const a = artifactArgs(f.url);
    if (!a) {
      if (f.url && f.url.startsWith("/")) {
        try {
          const r = await fetch(`/api/files/${encodeURIComponent(f.url)}`, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } });
          if (!r.ok) throw new Error(r.status === 403 ? "This file is outside the shared roots." : "Could not load attachment.");
          const j = await r.json();
          setPreview({ kind: "text", title: f.url.split("/").pop() || "Attachment", text: String(j.content || "").slice(0, 200_000) });
        } catch (e) { onNotify(e instanceof Error ? e.message : "Could not load attachment.", "error"); }
      } else {
        onNotify("This attachment can't be previewed here.", "error");
      }
      return;
    }
    const route = artifactUrl(a);
    if (f.mime.startsWith("image/") || f.mime === "application/pdf") {
      try {
        const token = localStorage.getItem("zcode-web-token") || "";
        const r = await fetch(route, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (!r.ok) throw new Error("Could not load media");
        const blob = await r.blob();
        const objUrl = URL.createObjectURL(blob);
        if (f.mime.startsWith("image/")) setPreview({ kind: "image", title: f.mime.replace("image/", "").toUpperCase() + " artifact", src: objUrl });
        else setPreview({ kind: "pdf", title: "PDF artifact", src: objUrl });
      } catch {
        onNotify("Could not load artifact.", "error");
      }
    } else {
      try {
        const text = await fetch(route, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } }).then((r) => r.text());
        setPreview({ kind: "text", title: "Artifact content", text: text.slice(0, 200_000) });
      } catch { onNotify("Could not load artifact.", "error"); }
    }
  }, [onNotify]);

  // scrollback: prepend the next older page, keeping the reading position.
  // The restore must run AFTER React commits the prepended nodes — a single
  // rAF can beat the commit and leave the viewport at the top of the newly
  // loaded history. Anchor on the previously-first node's offset instead of
  // raw scrollHeight diffs.
  const loadOlder = useCallback(async () => {
    if (!sessionId || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroll.current;
    // anchor the first TURN node (not the load-older button — it unmounts
    // while loading). Id-stable keys keep this exact node mounted as the
    // prepend shifts it down.
    const anchor = (el?.querySelector(".messages-scroll > article, .messages-scroll > .timeline-stack") ??
      (el?.firstElementChild && el.firstElementChild.tagName !== "BUTTON" ? el.firstElementChild : null)) as HTMLElement | null;
    const anchorTop = anchor?.offsetTop ?? 0;
    const anchorDelta = el && anchor ? el.scrollTop - anchorTop : 0;
    const settle = (deadline = performance.now() + 3000) => {
      requestAnimationFrame(() => {
        if (!el || !anchor || !anchor.isConnected) return;
        // keep the anchor at the same viewport offset while the prepend
        // commits and layout settles (real-API fetches can land slower than
        // a fixed frame budget)
        el.scrollTop = anchor.offsetTop + anchorDelta;
        if (performance.now() < deadline) settle(deadline);
      });
    };
    const epoch = sessionEpochRef.current;
    try {
      const d = await client.session(sessionId, 10, history.turns.length);
      // the reader may have switched conversations while the page was in
      // flight — a stale prepend must never land in the new view
      if (sessionEpochRef.current !== epoch) return;
      setHistory((h) => ({ turns: [...d.transcript, ...h.turns], total: d.total, hasMore: d.hasMore }));
      settle();
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : String(e), "error");
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, loadingOlder, history.turns.length, client, onNotify]);

  const stopRun = useCallback(() => {
    if (!run.jobId) return;
    runs.cancelRun(`${cwd}::${runKey}`);
  }, [run.jobId, cwd, runKey]);
  stopRunRef.current = stopRun;

  // ZWUI-050: the manager owns the POST, the stream and the poll; this panel
  // only supplies view concerns. Submissions are immutable snapshots built
  // from the composer AT CALL TIME (ZWUI-041) — retries/reruns never re-read
  // the live composer, and acceptance may only clear the draft revision that
  // was actually submitted (mayClearDraft).
  const submitWith = useCallback((sub: Submission, opts: { clearDraft: boolean; submitView: string }) => {
    void runs.submitRun(`${cwd}::${opts.submitView}`, sub, client, {
      onAccepted: (accepted, acceptedSub) => {
        if (opts.clearDraft && mayClearDraft({ draftKey, revision: draftRevRef.current }, acceptedSub)) {
          setInput(""); setAttachments([]); touchDraft();
        }
        // navigation follows the run only from the view that submitted it
        if (accepted.sessionId && viewKeyRef.current === opts.submitView) {
          onSessionCreated?.(accepted.sessionId);
        }
      },
    });
  }, [cwd, client, draftKey, touchDraft, onSessionCreated]);

  const guard = busy || uploading > 0 || !providerLive;

  // composer send: the submitted record IS the draft
  const send = useCallback(() => {
    if (guard) return;
    const text = input.trim();
    if (!text && !attachments.length) return;
    submitWith(snapshotSubmission({
      draftKey, revision: draftRevRef.current,
      projectKey: cwd, cwd, sessionId,
      text, model: model || "", mode,
      attachments: attachments.map((a) => ({ uploadRef: a.path, name: a.name })),
    }, randomUUID()), { clearDraft: true, submitView: runKey });
  }, [guard, input, attachments, draftKey, cwd, sessionId, mode, model, runKey, submitWith]);

  // ambiguous delivery: the POST threw, so the server may have already
  // accepted the request. Reuse the SAME request id and exact payload — the
  // server's idempotency key adopts the accepted job (or starts it once).
  const retryDelivery = useCallback(() => {
    if (guard) return;
    const sub = runs.lastSubmission(`${cwd}::${runKey}`);
    if (!sub || sub.requestId !== run.requestId) return;
    submitWith(sub, { clearDraft: false, submitView: runKey });
  }, [guard, cwd, runKey, run.requestId, submitWith]);

  // deliberate new execution after a terminal failure: NEW request identity,
  // exact original payload — the server replaying the dead job would be
  // useless, so a fresh id starts a fresh run
  const retryFailedRun = useCallback(() => {
    if (guard) return;
    runs.retryFailedRun(`${cwd}::${runKey}`, {
      onAccepted: (accepted) => {
        if (accepted.sessionId && viewKeyRef.current === runKey) onSessionCreated?.(accepted.sessionId);
      },
    });
  }, [guard, cwd, runKey, onSessionCreated]);

  // "Run again" on a historical prompt: a new execution of THAT text — no
  // borrow of the composer's attachments, and the draft stays untouched
  const runAgain = useCallback((text: string) => {
    if (guard) return;
    submitWith(snapshotSubmission({
      draftKey, revision: draftRevRef.current,
      projectKey: cwd, cwd, sessionId,
      text, model: model || "", mode, attachments: [],
    }, randomUUID()), { clearDraft: false, submitView: runKey });
  }, [guard, draftKey, cwd, sessionId, mode, model, runKey, submitWith]);

  // "Edit and resend" loads a historical prompt into the composer — an
  // explicit replace of the draft, surfaced to the user when one existed
  const editResend = useCallback((text: string) => {
    const hadDraft = input.trim().length > 0 && input.trim() !== text.trim();
    setInput(text);
    touchDraft();
    textarea.current?.focus();
    if (hadDraft) onNotify("Loaded this prompt into the composer — your draft was replaced.");
  }, [input, onNotify, touchDraft]);

  // models grouped by provider in server order (same-provider models are adjacent)
  const modelGroups = useMemo(() => {
    const groups: { provider: string; models: ModelInfo[] }[] = [];
    for (const m of models) {
      const last = groups[groups.length - 1];
      if (last && last.provider === m.providerName) last.models.push(m);
      else groups.push({ provider: m.providerName, models: [m] });
    }
    return groups;
  }, [models]);

  // tokens reported by the latest turn.completed envelope
  const liveTokens = useMemo(() => {
    for (let i = run.events.length - 1; i >= 0; i--) {
      const e = run.events[i];
      if (e.kind !== "line") continue;
      const line = e.line as { type?: string; payload?: { usage?: { totalTokens?: number } } } | undefined;
      if (line?.type === "turn.completed" && typeof line.payload?.usage?.totalTokens === "number") {
        return line.payload.usage.totalTokens;
      }
    }
    return null;
  }, [run.events]);

  // session-wide token count for the context-bar chip: the server's
  // pagination-independent total when available, else the loaded turns
  const [sessionTokensTotal, setSessionTokensTotal] = useState<number | null>(null);
  const sessionTokens = useMemo(
    () => (sessionTokensTotal ?? history.turns.reduce((a, t) => a + (t.tokens || 0), 0)) + (liveTokens && !isTerminal(run.phase) ? liveTokens : 0),
    [sessionTokensTotal, history.turns, liveTokens, run.phase]
  );

  // ZWUI-046: Bash evidence keyed by TOOL-CALL IDENTITY (callID) — repeated
  // commands stay distinct entries, object inputs are never stringified into
  // "[object Object]", and a completed live call is shown completed
  const normalizeCommand = (input: unknown, toolName: string): string => {
    if (typeof input === "string") return input.slice(0, 200);
    if (input && typeof input === "object") {
      const cmd = (input as Record<string, unknown>).command;
      if (typeof cmd === "string" && cmd.trim()) return cmd.slice(0, 200);
      try { return JSON.stringify(input).slice(0, 200); } catch { return toolName; }
    }
    return toolName;
  };
  const terminalEntries = useMemo<TerminalEntry[]>(() => {
    const isBash = (name: string) => /bash|shell/i.test(name);
    const out: TerminalEntry[] = [];
    history.turns.forEach((t, ti) => {
      (t.tools || []).forEach((tool, oi) => {
        if (isBash(tool.name)) out.push({ key: `h-${t.id || ti}-${oi}`, command: normalizeCommand(tool.detail, tool.name), status: tool.status || "completed", source: "history" });
      });
    });
    const live = new Map<string, TerminalEntry>();
    run.events.forEach((e) => {
      if (e.kind !== "line") return;
      const line = e.line as { type?: string; payload?: { toolName?: string; callID?: string; input?: unknown } } | undefined;
      if (!line?.type?.startsWith("tool.call.") || !line.payload?.toolName || !isBash(String(line.payload.toolName))) return;
      const callId = String(line.payload.callID || `ev${e.id}`);
      const status = line.type.split(".").pop() || "";
      const existing = live.get(callId);
      if (existing) existing.status = status;
      else live.set(callId, { key: `l-${callId}`, command: normalizeCommand(line.payload.input, String(line.payload.toolName)), status, source: "live" });
    });
    return [...out, ...live.values()];
  }, [history.turns, run.events]);
  const terminalSignature = terminalEntries.map((e) => e.key).join("|");
  const visibleTerminalEntries = terminalClearedSig === terminalSignature ? [] : terminalEntries;

  // derived live message bits
  const liveTools = run.events
    .filter((e) => e.kind === "line" && (e.line as { type?: string })?.type?.startsWith("tool.call."))
    .map((e) => {
      const line = e.line as { type: string; payload: Record<string, unknown> };
      return { name: String(line.payload.toolName || "tool"), status: line.type.split(".").pop() || "", detail: String(line.payload.input || "").slice(0, 400) };
    });
  const liveError = run.events.reduce<string | null>((acc, e) => {
    if (e.kind === "line") {
      const line = e.line as { type?: string; payload?: { error?: { message?: string } } };
      if (line.type === "turn.failed" && line.payload?.error?.message) return line.payload.error.message;
    }
    return acc;
  }, null);

  const empty = !sessionId && !history.turns.length && !run.answer && run.phase === "idle";

  // transport label under the composer — separate from run phase: a run can
  // be alive while its stream is reconnecting or fully detached
  function streamLabel(): string {
    if (run.phase === "submitting") return "sending…";
    if (localBusy) {
      if (run.transportLost) return "connection lost — work may still be running";
      if (run.streamAttached) return "stream live";
      return "reconnecting…";
    }
    if (externalActive) return "streaming in the Zcode app";
    return "idle";
  }

  return (
    <section className="chat-panel" aria-label="Agent conversation">
      <div className="chat-context">
        <div className="composer-menu-wrap project-menu-wrap">
          <button
            className="project-chip"
            onClick={openProjectMenu}
            title="Switch project"
            aria-haspopup="listbox"
            aria-expanded={menu === "project"}
          >
            <span className="project-dot" /><span>{cwd.split("/").filter(Boolean).pop()}</span>
            <ChevronDown size={12} className={menu === "project" ? "rotate-180" : ""} />
          </button>
          {menu === "project" && (
            <div className="popover project-popover" role="listbox" aria-label="Projects">
              <div className="popover-label">SWITCH PROJECT</div>
              {projectsByRoot === null && <div className="popover-label">loading…</div>}
              {projectsByRoot && (roots || []).map((root) => (
                <div key={root} className="project-group-list">
                  <div className="popover-label">{root.split("/").filter(Boolean).pop()?.toUpperCase()} ROOT</div>
                  <button role="option" aria-selected={cwd === root} onClick={() => { setMenu(null); onNavigateCwd?.(root); }}>
                    <FolderClosed size={15} /><span><b>{root.split("/").filter(Boolean).pop()}</b><small>{root}</small></span>
                    {cwd === root && <Check size={13} className="success-text" />}
                  </button>
                  {(projectsByRoot[root] || []).map((d) => {
                    const dir = root.replace(/\/$/, "") + "/" + d;
                    return (
                      <button key={dir} role="option" aria-selected={cwd === dir} onClick={() => { setMenu(null); onNavigateCwd?.(dir); }}>
                        <FolderClosed size={15} /><span><b>{d}</b><small>{dir}</small></span>
                        {cwd === dir && <Check size={13} className="success-text" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        {branch && <span className="branch-chip" title="git branch (read-only)"><GitBranch size={12} />{branch}</span>}
        <span className="agent-active" title={busy ? "A turn is running" : "No turn running"}>
          <span className={`pulse-dot ${busy ? "" : "idle"}`} />
          <span>{busy ? `Agent active · ${(models.find((m) => m.ref === model)?.model || "GLM").split("/").pop()?.toUpperCase()}` : "Idle"}</span>
        </span>
        {/* the single usage entry point — REF2-06 keeps detailed numbers here,
            not repeated across composer and messages */}
        <button className="details-toggle token-chip" onClick={() => setTokenDialog(true)} title="Token telemetry — totals cover every message of this session">
          <Coins size={12} />
          <span>{sessionTokens ? `${sessionTokens >= 10_000 ? `${Math.round(sessionTokens / 1000)}k` : sessionTokens.toLocaleString()} tokens` : "Tokens"}</span>
        </button>
        <div className="composer-menu-wrap context-menu-wrap">
          <button
            className={`details-toggle ${menu === "view" ? "context-active" : ""}`}
            onClick={() => setMenu(menu === "view" ? null : "view")}
            aria-haspopup="menu"
            aria-expanded={menu === "view"}
            title="View options"
          >
            <SlidersHorizontal size={12} /><span>View</span><ChevronDown size={11} />
          </button>
          {menu === "view" && (
            <div className="popover view-popover" role="menu" aria-label="View options">
              <button role="menuitemcheckbox" aria-checked={terminalOpen} onClick={() => setTerminalOpen((v) => !v)}>
                {terminalOpen ? <SquareTerminal size={15} /> : <Terminal size={15} />}
                <span><b>Agent terminal</b><small>Commands Zcode ran in this workspace</small></span>
                {terminalOpen && <Check size={13} className="success-text" />}
              </button>
              <button role="menuitemcheckbox" aria-checked={exactTimes} onClick={() => setExactTimes((v) => !v)}>
                <Clock3 size={15} />
                <span><b>Exact times</b><small>{exactTimes ? "HH:MM bylines" : "Relative bylines (5m ago)"}</small></span>
                {exactTimes && <Check size={13} className="success-text" />}
              </button>
              <button role="menuitemcheckbox" aria-checked={!detailsHidden} onClick={() => setDetailsHidden((v) => !v)}>
                {detailsHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                <span><b>Thinking & steps</b><small>{detailsHidden ? "Hidden behind Details toggles" : "Shown under each answer"}</small></span>
                {!detailsHidden && <Check size={13} className="success-text" />}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="messages-scroll" ref={scroll} onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        stickToBottom.current = atBottom;
        setShowJumpLatest(!atBottom && el.scrollHeight > el.clientHeight + 200);
      }}>
        {empty && (
          <div className="empty-conversation">
            <div className="empty-logo"><ZLogo size={35} /></div>
            <span className="eyebrow">FROM AN IDEA TO WHAT'S NEXT</span>
            <h2>Let's build something.</h2>
            <p>Describe what you have in mind.<br />I'll help you take it from here.</p>
            <div className="prompt-suggestions">
              {["Explain this project", "Write tests for the API", "Make a refactor plan"].map((text) => (
                <button key={text} onClick={() => { setInput(text); touchDraft(); textarea.current?.focus(); }}><Sparkles size={13} />{text}<ArrowUpRight size={12} /></button>
              ))}
            </div>
          </div>
        )}

        {sessionId && historyLoading && (
          <div className="chat-loader" role="status" aria-label="Loading conversation">
            <LoaderCircle size={16} className="spin" />
            <span>Loading conversation…</span>
          </div>
        )}

        {!historyLoading && history.hasMore && (
          <button className="load-older" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? <LoaderCircle size={12} className="spin" /> : <ChevronUp size={12} />}
            <span>{loadingOlder ? "Loading…" : `Load older turns`}</span>
          </button>
        )}
        {!historyLoading && history.turns.map((t, i) => {
          const events = t.timeline || [];
          const menuKey = t.id || `h${i}`;
          const timelineOnly = events.length > 0 && !t.text.trim() && !(t.tools || []).length && !(t.files || []).length && !t.reasoning;
          if (timelineOnly) {
            return <div className="timeline-stack" key={t.id || `h${i}`}>{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>;
          }
          return t.role === "user" ? (
            <article className="user-message-block" key={t.id || `h${i}`}>
              {events.length > 0 && <div className="timeline-stack">{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>}
              <div className="message-byline">
                <strong>You</strong>
                {t.createdAt ? <Time createdAt={t.createdAt} exact={exactTimes} /> : null}
                <span className="message-footer-actions user-turn-actions">
                  <IconButton label="Copy prompt" onClick={() => void copyText(`u${i}`, t.text)}>
                    {copied === `u${i}` ? <Check size={12} /> : <Copy size={12} />}
                  </IconButton>
                  <div className="composer-menu-wrap turn-menu-wrap">
                    <IconButton
                      label="Prompt actions"
                      aria-haspopup="menu"
                      aria-expanded={turnMenu === menuKey}
                      onClick={() => setTurnMenu(turnMenu === menuKey ? null : menuKey)}
                    >
                      <MoreHorizontal size={12} />
                    </IconButton>
                    {turnMenu === menuKey && (
                      <div className="popover turn-popover" role="menu" aria-label="Prompt actions">
                        <button role="menuitem" onClick={() => { setTurnMenu(null); editResend(t.text); }}>
                          <SquarePen size={15} />
                          <span><b>Edit and resend</b><small>Loads this prompt into the composer — history stays</small></span>
                        </button>
                        <button role="menuitem" disabled={busy} onClick={() => { setTurnMenu(null); runAgain(t.text); }}>
                          <RotateCcw size={15} />
                          <span><b>Run again</b><small>Starts a new execution of this prompt</small></span>
                        </button>
                      </div>
                    )}
                  </div>
                </span>
              </div>
              <div className="user-message">{t.text}</div>
              {(t.files || []).length > 0 && (
                <FileCards files={t.files || []} onPreview={(f) => void previewArtifact(f)} />
              )}
            </article>
          ) : (
            <article className={`agent-message ${detailsHidden ? "details-hidden" : ""}`} key={t.id || `h${i}`}>
              {events.length > 0 && <div className="timeline-stack">{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>}
              <div className="agent-byline">
  <strong>Zcode</strong>
                {t.createdAt ? <Time createdAt={t.createdAt} exact={exactTimes} /> : null}
                {t.tokens ? (
                  <button className="tk-pill" onClick={() => setTokenDialog(true)} title="Token telemetry for this session">
                    <Zap size={9} />{(t.tokens / 1000).toFixed(1)}k tk
                  </button>
                ) : null}
                <button className="message-details-toggle" onClick={() => setDetailsHidden((v) => !v)} aria-expanded={!detailsHidden}>
                  {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Details" : "Hide"}</span>
                </button>
              </div>
              {!detailsHidden && (t.reasoning || (t.tools || []).length > 0) && (
                <details className="thinking-block history-thinking">
                  <summary className="thinking-heading">
                    <Brain size={13} />
                    <span>
                      {t.reasoning ? "Thinking" : "Steps"}
                      {t.durationMs ? ` · ${formatDuration(t.durationMs)}` : ""}
                      {(t.tools || []).length ? ` · ${(t.tools || []).length} step${(t.tools || []).length === 1 ? "" : "s"}` : ""}
                    </span>
                    <span className="thinking-hint">How I approached this</span>
                  </summary>
                  {t.reasoning && <p>{t.reasoning}</p>}
                </details>
              )}
              {!detailsHidden && (t.tools || []).length > 0 && (
                <div className="activity-stack">
                  {(t.tools || []).map((tool, j) => (
                    <ToolActivity key={j} name={tool.name} status={tool.status} detail={tool.detail} />
                  ))}
                </div>
              )}
              {!detailsHidden && (t.files || []).length > 0 && (
                <FileCards files={t.files || []} onPreview={(f) => void previewArtifact(f)} />
              )}
              <Markdown text={t.text} />
              {t.durationMs || t.tokens || t.error ? (
                <div className="message-footer">
                  <span className="task-completed" title={t.error || undefined}>
                    <CheckMark />
                    {t.durationMs ? `Worked for ${formatDuration(t.durationMs)}` : t.error ? "Turn failed" : "Completed"}
                    {t.error ? <span className="failed-chip">failed</span> : null}
                    {t.tokens ? (
                      <button className="turn-tokens" onClick={() => setTokenDialog(true)} title="Token telemetry">
                        · {(t.tokens / 1000).toFixed(1)}k tokens
                      </button>
                    ) : null}
                  </span>
                  <span className="message-footer-actions">
                    <IconButton label="Copy response" onClick={() => void copyText(`h${i}`, t.text)}>
                      {copied === `h${i}` ? <CheckCheck size={13} /> : <Copy size={13} />}
                    </IconButton>
                  </span>
                </div>
              ) : null}
              {t.error && (
                <details className="turn-error">
                  <summary>Why it failed</summary>
                  <pre>{t.error}</pre>
                </details>
              )}
            </article>
          );
        })}

        {/* instant echo of the prompt just sent — the transcript only
            commits it when the run's messages land */}
        {echoVisible && (
          <article className="user-message-block echo" key={`echo-${run.requestId}`}>
            <div className="message-byline">
              <strong>You</strong>
            </div>
            <div className="user-message">{run.submittedText}</div>
          </article>
        )}

        {/* a turn running in the desktop/CLI: progress row, no send */}
        {externalActive && !localBusy && (
          <article className="agent-message">
            <div className="agent-byline">
<strong>Zcode</strong>
            </div>
            <div className="working-message external-working">
              <LoaderCircle size={13} className="spin" />
              <span>Working{externalStartedAt && externalTick ? <span className="working-elapsed">{formatDuration(Math.max(1000, externalTick - externalStartedAt))}</span> : null}<span className="thinking-dots"><i /><i /><i /></span></span>
            </div>
          </article>
        )}

        {/* live block is for runs attached HERE; external activity has its own row */}
        {(run.answer || run.reasoning || localBusy || run.error) && (
          <article className="agent-message">
            <div className="agent-byline">
<strong>Zcode</strong>
              <span className="agent-model">{(models.find((m) => m.ref === model)?.model || "GLM").split("/").pop()?.toUpperCase()}</span>
              {run.phase !== "idle" && <span className="message-duration"><Clock3 size={11} />{run.phase}</span>}
              <button className="message-details-toggle" onClick={() => setDetailsHidden((v) => !v)} aria-expanded={!detailsHidden}>
                {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Details" : "Hide"}</span>
              </button>
            </div>
            {/* answer first: while running, the CURRENT activity streams
                visibly; once terminal, routine details collapse (REF2-03) —
                failures below always stay visible */}
            {!detailsHidden && localBusy && run.reasoning && (
              <div className="thinking-block"><Brain size={13} /><p>{run.reasoning}</p></div>
            )}
            {!detailsHidden && localBusy && liveTools.length > 0 && (
              <div className="activity-stack">
                {liveTools.map((t, i) => (
                  <ToolActivity key={i} name={t.name} status={t.status} detail={t.detail || ""} live />
                ))}
              </div>
            )}
            {!localBusy && !detailsHidden && (run.reasoning || liveTools.length > 0) && (
              <details className="thinking-block history-thinking">
                <summary className="thinking-heading">
                  <Brain size={13} />
                  <span>
                    {run.reasoning ? "Thinking" : "Steps"}
                    {liveTools.length ? ` · ${liveTools.length} step${liveTools.length === 1 ? "" : "s"}` : ""}
                  </span>
                  <span className="thinking-hint">How I approached this</span>
                </summary>
                {run.reasoning && <p>{run.reasoning}</p>}
                {liveTools.length > 0 && (
                  <div className="activity-stack">
                    {liveTools.map((t, i) => (
                      <ToolActivity key={i} name={t.name} status={t.status} detail={t.detail || ""} live />
                    ))}
                  </div>
                )}
              </details>
            )}
            {run.answer
              ? <span className="stream-wrap"><Markdown text={run.answer} />{localBusy && <span className="stream-caret" aria-hidden="true" />}</span>
              : null}
            {liveError && <div className="danger-text">{liveError}</div>}
            {run.error && <div className="danger-text">{run.error}</div>}
            {run.error && isTerminal(run.phase) && run.submittedText && !busy && (
              <div className="message-footer">
                <button
                  className="retry-button"
                  onClick={run.submitFailed ? retryDelivery : retryFailedRun}
                  title={run.submitFailed
                    ? "The send never confirmed — retry reuses the same request so the server cannot run it twice"
                    : "Run this prompt again"}
                >
                  <RotateCcw size={12} />{run.submitFailed ? "Retry sending" : "Retry this prompt"}
                </button>
              </div>
            )}
            {!busy && run.phase === "succeeded" && (
              <div className="message-footer">
                <span className="task-completed">
                  <CheckMark />{mode === "plan" ? "Plan ready" : "Task completed"}
                  {liveTokens ? (
                    <button className="turn-tokens" onClick={() => setTokenDialog(true)} title="Token telemetry">
                      · {(liveTokens / 1000).toFixed(1)}k tokens
                    </button>
                  ) : null}
                </span>
                {mode === "plan" && (
                  <button className="plan-apply" onClick={() => { setMode("build"); savePrefs({ mode: "build" }); textarea.current?.focus(); }}>
                    <SquarePen size={12} />Switch to Build to apply
                  </button>
                )}
              </div>
            )}
          </article>
        )}

        {localBusy && (
          <div className="working-message" role="status">
            <span>Zcode is working<span className="thinking-dots"><i /><i /><i /></span></span>
          </div>
        )}
      </div>

      <AgentTerminalDrawer
        open={terminalOpen}
        entries={visibleTerminalEntries}
        onClose={() => setTerminalOpen(false)}
        onClear={() => setTerminalClearedSig(terminalSignature)}
      />

      <div className="composer-zone">
        {localBusy && run.transportLost && (
          <div className="stream-status-banner" role="status">
            <Unplug size={13} />
            <span>Connection lost — your work is still running. This page will catch up when it finishes.</span>
          </div>
        )}
        {showJumpLatest && (
          <button
            className="jump-latest"
            aria-label="Jump to latest messages"
            onClick={() => {
              const el = scroll.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              stickToBottom.current = true;
              setShowJumpLatest(false);
            }}
          >
            <ChevronDown size={13} />Latest
          </button>
        )}
      <div
        className="composer-shell"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void attachFiles(e.dataTransfer.files); }}
      >
        {cmdQuery != null && cmdMatches.length > 0 && (
          <div className="command-menu" role="listbox" id="command-menu" aria-label="Slash commands">
            {cmdMatches.map((c, i) => (
              <button
                key={`${c.group}:${c.name}`}
                id={`cmd-option-${i}`}
                role="option"
                aria-selected={i === cmdIndex}
                className={`command-row ${i === cmdIndex ? "active" : ""}`}
                onMouseEnter={() => setCmdIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); pickCommand(c); }}
              >
                <span className="command-name">/{c.name}</span>
                <span className="command-desc">{c.desc}</span>
                {c.sendThrough
                  ? <kbd className="command-kbd">runs in session</kbd>
                  : <kbd className="command-kbd">action</kbd>}
              </button>
            ))}
          </div>
        )}
        <div className={`composer ${busy ? "composer-working" : ""}`}>
          {attachments.length > 0 && (
            <div className="attached-files">
              {attachments.map((a) => (
                <span className="attached-file" key={a.path}>
                  <button className="attached-file-name" onClick={() => void previewAttachment(a)} title="Preview attachment">
                    <FileText size={12} /><span>{a.name}</span>
                  </button>
                  <IconButton label={`Remove ${a.name}`} onClick={() => removeAttachment(a.path)}><X size={11} /></IconButton>
                </span>
              ))}
              {uploading > 0 && <span className="attached-file"><LoaderCircle size={12} className="spin" /><span>uploading {uploading}…</span></span>}
            </div>
          )}
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => { setInput(e.target.value); touchDraft(); }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files || []);
              if (files.length) { e.preventDefault(); void attachFiles(files); }
            }}
            placeholder={!providerLive
              ? "No model provider configured on this host — set one up before sending"
              : sessionId ? "Ask for follow-up changes…" : "What would you like to build?"}
            aria-label="Message Zcode"
            role="combobox"
            aria-expanded={cmdQuery != null && cmdMatches.length > 0}
            aria-controls="command-menu"
            aria-autocomplete="list"
            aria-activedescendant={cmdQuery != null && cmdMatches.length > 0 ? `cmd-option-${cmdIndex}` : undefined}
            rows={2}
            onKeyDown={(e) => {
              // "/" palette navigation takes precedence while it is open
              if (cmdQuery != null && cmdMatches.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setCmdIndex((i) => (i + 1) % cmdMatches.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setCmdIndex((i) => (i - 1 + cmdMatches.length) % cmdMatches.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickCommand(cmdMatches[cmdIndex] || cmdMatches[0]); return; }
                if (e.key === "Escape") { e.preventDefault(); setCmdDismissed(true); return; }
              }
              // Shift+Tab stays native (reverse focus navigation); IME-safe Enter
              if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); send(); }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-left">
              <div className="composer-menu-wrap">
                <IconButton label="Attach a file" onClick={() => fileInput.current?.click()}><Plus size={17} /></IconButton>
              </div>
              <div className="composer-menu-wrap">
                <button className="mode-picker" onClick={() => setMenu(menu === "mode" ? null : "mode")}>
                  <ShieldCheck size={13} /><span>{mode}</span><ChevronDown size={11} />
                </button>
                {menu === "mode" && (
                  <div className="popover mode-popover">
                    <div className="popover-label">EXECUTION MODE</div>
                    {modes.map((m) => ({
                      id: m,
                      label: m.charAt(0).toUpperCase() + m.slice(1),
                      description: ({
                        plan: "Think it through before building",
                        build: "Make changes to project files",
                        edit: "Edit files with confirmation",
                        yolo: "Run without asking (trusted repos)",
                      } as Record<string, string>)[m] || "Server-advertised execution mode",
                    })).map((item) => (
                      <button key={item.id} onClick={() => { setMode(item.id); savePrefs({ mode: item.id }); setMenu(null); }}>
                        {item.id === "plan" ? <MessageSquare size={15} /> : <SquarePen size={15} />}
                        <span><b>{item.label}</b><small>{item.description}</small></span>
                        {mode === item.id && <Check size={13} className="success-text" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="composer-right">
              <div className="composer-menu-wrap">
                <button className="model-picker" onClick={() => setMenu(menu === "model" ? null : "model")}>
                  <Sparkles size={12} /><span>{(models.find((m) => m.ref === model)?.model || "model").split("/").pop()?.toUpperCase()}</span><ChevronDown size={11} />
                </button>
                {menu === "model" && (
                  <div className="popover model-popover">
                    {modelGroups.map((g) => (
                      <div className="model-provider-group" key={g.provider}>
                        <div className="popover-label">{g.provider.toUpperCase()}</div>
                        {g.models.map((m) => (
                          <button key={m.ref} onClick={() => { setModel(m.ref); savePrefs({ model: m.ref }); setMenu(null); }}>
                            <Sparkles size={15} /><span><b>{(m.model.split("/").pop() || m.model).toUpperCase()}</b><small>{[m.model.includes("/") ? m.model : "", m.isDefault ? "default" : ""].filter(Boolean).join(" · ")}</small></span>
                            {model === m.ref && <Check size={13} className="success-text" />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {busy && run.jobId && (
                <IconButton label="Stop run" onClick={stopRun}><Square size={13} /></IconButton>
              )}
              <button
                className="send-button"
                disabled={busy || uploading > 0 || !providerLive || (!input.trim() && !attachments.length)}
                aria-label="Send message"
                title={!providerLive ? "No model provider is configured on this host" : "Send message (Enter)"}
                onClick={() => send()}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
              </button>
            </div>
          </div>
        </div>
        <div className="composer-hint">
          <span><kbd>↵</kbd> send <span className="hint-dot">·</span> <kbd>shift ↵</kbd> new line <span className="hint-dot">·</span> <kbd>/</kbd> commands</span>
          <span className="composer-status"><span className={`tiny-dot ${run.streamAttached ? "green" : localBusy ? "amber" : ""}`} />{streamLabel()}</span>
        </div>
      </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        aria-label="Attach files"
        className="visually-hidden"
        onChange={async (e) => {
          if (e.target.files?.length) await attachFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {preview && <PreviewOverlay preview={preview} onClose={() => setPreview(null)} />}
      {tokenDialog && (
        <TokenTelemetryDialog
          sessionId={sessionId || "draft"}
          title={sessionTitle || "New chat"}
          turns={history.turns}
          totalTurns={history.total}
          sessionTotal={sessionTokensTotal}
          liveTokens={liveTokens && !isTerminal(run.phase) ? liveTokens : null}
          onClose={() => setTokenDialog(false)}
        />
      )}
    </section>
  );
}

// byline time — relative ("5m") by default, exact HH:MM when toggled
function Time({ createdAt, exact }: { createdAt: number; exact: boolean }) {
  const d = new Date(createdAt);
  const label = exact
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : relativeTime(createdAt);
  return <time title={d.toLocaleString()}>{label}</time>;
}


// Reference-pattern collapsible tool evidence (activity-stack classes).
function ToolActivity({ name, status, detail, live = false }: { name: string; status: string; detail?: string; live?: boolean }) {
  const [openItem, setOpenItem] = useState(false);
  const done = status === "completed" || status === "succeeded";
  return (
    <div className={`activity-item ${openItem ? "is-open" : ""}`}>
      <button className="activity-trigger" onClick={() => setOpenItem(!openItem)} aria-expanded={openItem}>
        <ChevronRight size={12} className="activity-chevron" />
        {name === "Bash" ? <Terminal size={14} /> : <Wrench size={14} />}
        <span>{name}</span>
        <small>{live && !done ? "running" : status}</small>
        {done && <Check size={13} className="success-text" />}
      </button>
      {openItem && detail && <div className="activity-content"><pre className="diff-content"><code>{detail}</code></pre></div>}
    </div>
  );
}

// The desktop's per-turn footer reads "Worked for 6s" (turn_usage duration).
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Desktop timeline separators: hairline rows marking model switches,
// context compactions, forks and goal-verification marks in the transcript.
function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon = event.kind === "model_change" ? ArrowLeftRight : event.kind === "compaction" ? FoldVertical : event.kind === "session_fork" ? GitBranch : BadgeCheck;
  return (
    <div className="timeline-separator" data-kind={event.kind}>
      <Icon size={12} />
      <span className="timeline-label">{event.label}</span>
      {event.detail && <span className="timeline-detail">{event.detail}</span>}
    </div>
  );
}

// Transcript artifacts (screenshots, PDFs, text saved by desktop tools) —
// images render as thumbnails; everything else is a chip. Click → preview.
// The CLI prunes old artifact files, so a referenced artifact can be gone;
// the thumbnail falls back to a chip instead of a broken image.
function FileCards({ files, onPreview }: { files: FileCard[]; onPreview: (f: FileCard) => void }) {
  return (
    <div className="file-cards">
      {files.map((f, i) => (
        <FileChip key={`${f.url}-${i}`} file={f} onPreview={onPreview} />
      ))}
    </div>
  );
}

function FileChip({ file: f, onPreview }: { file: FileCard; onPreview: (f: FileCard) => void }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const a = artifactArgs(f.url);
  const isImage = f.mime.startsWith("image/");

  useEffect(() => {
    let alive = true;
    if (!isImage || !a) return;
    const route = artifactUrl(a);
    const token = localStorage.getItem("zcode-web-token") || "";
    fetch(route, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.blob();
      })
      .then((blob) => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        setThumbSrc(url);
      })
      .catch(() => {
        if (alive) setThumbFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [f.url, isImage]);

  // desktop shows the pasted filename; artifact-protocol URLs have none, so
  // those fall back to the mime label
  const base = f.url ? (f.url.split("/").pop() || "") : "";
  const label = base && base.includes(".") ? base.slice(0, 48) : isImage ? f.mime.replace("image/", "").toUpperCase() : (f.mime === "application/pdf" ? "PDF" : f.mime.split("/").pop()?.toUpperCase() || "FILE");
  return (
    <button className={`file-card ${isImage && !thumbFailed ? "is-image" : ""}`} onClick={() => onPreview(f)} title="Preview attachment">
      {isImage && thumbSrc && !thumbFailed ? <img src={thumbSrc} alt="attached screenshot" loading="lazy" onError={() => setThumbFailed(true)} /> : <FileText size={12} />}
      <span>{label}{f.size ? ` · ${(f.size / 1024).toFixed(0)}KB` : ""}</span>
    </button>
  );
}

// Full-panel preview used by both pending attachments and transcript
// artifacts: images inline, PDFs in a sandboxed frame, text as scrollable
// preformatted content. Missing artifacts (the CLI prunes old ones) show a
// notice instead of a broken frame.
function PreviewOverlay({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  useEffect(() => {
    setImgFailed(false);
    return () => {
      if (preview.kind !== "text" && preview.src.startsWith("blob:")) {
        URL.revokeObjectURL(preview.src);
      }
    };
  }, [preview]);
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label={`Preview ${preview.title}`} ref={ref} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="preview-panel-light">
        <header className="preview-light-header">
          <FileText size={13} />
          <strong>{preview.title}</strong>
          <span className="preview-light-hint">esc to close</span>
          <IconButton label="Close preview" onClick={onClose}><X size={15} /></IconButton>
        </header>
        {preview.kind === "image" && (imgFailed
          ? <div className="preview-missing">This artifact is no longer stored — the CLI prunes old attachments.</div>
          : <img className="preview-light-image" src={preview.src} alt={preview.title} onError={() => setImgFailed(true)} />)}
        {preview.kind === "pdf" && <iframe className="preview-light-frame" src={preview.src} title={preview.title} />}
        {preview.kind === "text" && <pre className="preview-light-text"><code>{preview.text}</code></pre>}
      </div>
    </div>
  );
}
