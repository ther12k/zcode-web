// ChatPanel ported to the reference design: context strip, messages-scroll
// with byline blocks, thinking + tool evidence, bottom composer with
// mode/model pickers, live-run "working" message. Run state comes from the
// ZWUI-016 reducer; transport from the ZWUI-017 controller.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeftRight, ArrowUp, ArrowUpRight, BadgeCheck, Brain, ChevronUp, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Coins, Copy, Eye, EyeOff, FileText, FoldVertical, FolderClosed, GitBranch, LoaderCircle, MessageSquare, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Square, SquarePen, SquareTerminal, Terminal, Unplug, Wrench, X, Zap } from "lucide-react";
import { ZLogo, IconButton, Markdown, CheckMark, useDialogA11y, overlayOpen, relativeTime, formatBytes } from "../ui";
import { randomUUID } from "../lib/uuid";
import { ApiError, type ApiClient, type CommandInfo, type FileCard, type ModelInfo, type SessionDetail, type SessionInfo, type TimelineEvent, type TodoItem, type TranscriptTurn } from "../api/client";
import { isTerminal } from "../state/run";
import * as runs from "../state/runManager";
import { snapshotSubmission, mayClearDraft, dequeueAfterSuccess, type Submission } from "../lib/submission";
import { scanIssueRefs, issueKey, parseIssueKey, type IssueIdentity, type ScannedIssueRef } from "../lib/issueRefs";
import { loadDraft, saveDraft, loadPrefs, savePrefs, rememberRecentModel } from "../state/prefs";
import { compactModelRef, compactProviderId, filterModels, groupModels, modelLabel, recentModels } from "../lib/modelPicker";
import type { TerminalEntry } from "./Telemetry";
// ZWUI-069: telemetry surfaces (token audit dialog, terminal drawer) load on
// demand — off the initial parse tree until first opened
const AgentTerminalDrawer = lazy(() => import("./Telemetry").then((m) => ({ default: m.AgentTerminalDrawer })));
const TokenTelemetryDialog = lazy(() => import("./Telemetry").then((m) => ({ default: m.TokenTelemetryDialog })));

// transcript page size: big enough that the user's own recent prompts are in
// view when opening an agent-heavy session (tool runs chain many turns per
// prompt; 10-turn pages routinely hid them)
const HISTORY_PAGE = 30;

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
  client, cwd, sessionId, sessionTitle, modes, defaultMode, branch, roots, onNavigateCwd, providerLive = true, newChatNonce = 0, reloadKey = 0, injectedDraft, onNotify, onSessionCreated, onBusyChange, onSlashAction, onSessionMeta, repoBinding, onOpenIssue, onIssuesChange, maxUploadBytes = 15 * 1024 * 1024, maxAttachments = 5,
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
  onSessionMeta?: (s: { id: string; title: string; directory?: string; goal?: SessionInfo["goal"]; todos?: TodoItem[]; workedMs?: number }) => void;
  /** GitHub repo bound to this project (origin remote) — bare #N resolves here */
  repoBinding?: { host: string; owner: string; repo: string } | null;
  /** an issue reference was clicked in the conversation */
  onOpenIssue?: (identity: IssueIdentity) => void;
  /** issue references currently visible in this conversation */
  onIssuesChange?: (refs: ScannedIssueRef[]) => void;
  /** server-advertised attachment caps (/api/config) — preflight at pick time */
  maxUploadBytes?: number;
  maxAttachments?: number;
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
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [modelActiveIndex, setModelActiveIndex] = useState(0);
  const [recentModelRefs, setRecentModelRefs] = useState(() => loadPrefs().recentModels);
  const modelSearchInput = useRef<HTMLInputElement>(null);
  const modelLoadSeq = useRef(0);
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
    // timestamps are the default reading mode; the View toggle restores
    // compact relative bylines ("5m ago")
    try { return localStorage.getItem("zcode-exact-times") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("zcode-exact-times", exactTimes ? "1" : "0"); } catch {}
  }, [exactTimes]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  // Desktop keeps follow-up prompts in a small client-side queue while the
  // current turn owns the session. They are immutable snapshots, so edits to
  // the next draft cannot mutate work that will be sent later.
  const [queuedSubmissions, setQueuedSubmissions] = useState<Submission[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [history, setHistory] = useState<{ turns: TranscriptTurn[]; total: number; hasMore: boolean }>({ turns: [], total: 0, hasMore: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastKey = useRef(draftKey);

  // Models are read from the live CLI config. Refreshing here is intentional:
  // a user can add a provider/model in Zcode Desktop without restarting this UI.
  const loadModels = useCallback(async () => {
    const seq = ++modelLoadSeq.current;
    setModelsLoading(true);
    setModelError(null);
    try {
      const r = await client.models();
      if (seq !== modelLoadSeq.current) return;
      setModels(r.models);
      const prefs = loadPrefs();
      const savedModel = r.models.find((m) => m.ref === prefs.model);
      const availableRefs = new Set(r.models.map((m) => m.ref));
      const prunedRecent = prefs.recentModels.filter((ref) => availableRefs.has(ref));
      setRecentModelRefs((current) => current.join("\u0000") === prunedRecent.join("\u0000") ? current : prunedRecent);
      if (prunedRecent.length !== prefs.recentModels.length) savePrefs({ recentModels: prunedRecent });
      if (prefs.model && !savedModel) savePrefs({ model: "" });
      setModel((current) => {
        if (r.models.some((m) => m.ref === current)) return current;
        return (savedModel || r.models.find((m) => m.isDefault) || r.models[0])?.ref || "";
      });
    } catch (e) {
      if (seq === modelLoadSeq.current) setModelError(e instanceof Error ? e.message : "Could not load models");
    } finally {
      if (seq === modelLoadSeq.current) setModelsLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadModels(); }, [loadModels]);

  // load transcript for an existing session
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  // a turn running from another writer (desktop/CLI): the composer locks and
  // the view shows progress until the store says the turn ended
  const [externalActive, setExternalActive] = useState(false);
  const [externalStartedAt, setExternalStartedAt] = useState<number | null>(null);
  const externalActiveRef = useRef(false);
  useEffect(() => { externalActiveRef.current = externalActive; }, [externalActive]);
  // ZWUI-075: server-reported in-flight job for this session. The loaders
  // only RECORD it (they must stay identity-stable — the initial history load
  // depends on applySessionPage and must not re-run on every run phase
  // change); the adoption itself runs in a dedicated effect below.
  const pendingAdoptionRef = useRef<{ jobId: string; sessionId: string } | null>(null);
  const [adoptTick, setAdoptTick] = useState(0);
  const considerAdoption = useCallback((d: SessionDetail) => {
    // record the server-reported job — and CLEAR a stale record when the
    // server no longer reports one: a finished follow-up must never be
    // hijacked back onto the previous (dead) job id
    const next = d.activeJobId && d.session?.id ? { jobId: d.activeJobId, sessionId: d.session.id } : null;
    if (next?.jobId === pendingAdoptionRef.current?.jobId) return;
    pendingAdoptionRef.current = next;
    if (next) setAdoptTick((t) => t + 1);
  }, []);
  const applySessionPage = useCallback((d: SessionDetail) => {
    setHistory({ turns: d.transcript, total: d.total, hasMore: d.hasMore });
    setSessionTokensTotal(d.tokensTotal ?? null);
    setContextTokens(d.contextTokens ?? null);
    setExternalActive(!!d.runActive);
    setExternalStartedAt(d.runStartedAt ?? null);
    setWorkedMs(d.workedMs ?? 0);
    if (d.session?.id && d.session?.title) onSessionMeta?.({ id: d.session.id, title: d.session.title, directory: d.session.directory, goal: d.session.goal ?? undefined, todos: d.todos ?? [], workedMs: d.workedMs ?? undefined });
    considerAdoption(d);
  }, [onSessionMeta, considerAdoption]);
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
    if (d.workedMs != null) setWorkedMs(d.workedMs);
    if (d.tokensTotal != null) setSessionTokensTotal(d.tokensTotal);
    if (d.contextTokens != null) setContextTokens(d.contextTokens);
    if (d.session?.id && d.session?.title) onSessionMeta?.({ id: d.session.id, title: d.session.title, directory: d.session.directory, goal: d.session.goal ?? undefined, todos: d.todos ?? [], workedMs: d.workedMs ?? undefined });
    considerAdoption(d);
  }, [onSessionMeta, considerAdoption]);
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
    void client.session(sessionId, HISTORY_PAGE, 0)
      .then((d) => { if (alive) applySessionPage(d); })
      .catch((e) => { if (alive) onNotify(e instanceof ApiError ? e.message : String(e), "error"); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [sessionId, client, onNotify, reloadKey, applySessionPage]);
  // a session switch invalidates any recorded adoption — it belonged to the
  // previous conversation and must never attach a stream to another one
  useEffect(() => { pendingAdoptionRef.current = null; }, [sessionId]);
  // ZWUI-075: adopt the server-reported in-flight job once this view has no
  // live locally-known run for the session (fresh reload, or the previous
  // local job already reached a terminal state). adoptRunningJob itself is
  // idempotent for a job this conversation already owns.
  useEffect(() => {
    const pending = pendingAdoptionRef.current;
    if (!pending) return;
    // a local submission supersedes any recorded adoption — the POST that is
    // in flight will attach its own job; adopting here would race it
    if (run.phase === "submitting") { pendingAdoptionRef.current = null; return; }
    if (run.phase !== "idle" && !isTerminal(run.phase)) return;
    runs.adoptRunningJob(`${cwd}::${pending.sessionId}`, pending.jobId, pending.sessionId, client);
  }, [adoptTick, run.jobId, run.phase, cwd, client]);
  // visibility refresh merges instead of reloading — coming back to the tab
  // must not clear the view or drop paged-in history
  useEffect(() => {
    if (!syncTick || !sessionId) return;
    let alive = true;
    void client.session(sessionId, HISTORY_PAGE, 0)
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
        const d = await client.session(sessionId, HISTORY_PAGE, 0);
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
  // already typed; the saved draft follows so it survives a remount.
  // Re-injecting text already in the composer (picking the same skill twice)
  // must not duplicate it — just refocus at the end.
  const lastInjected = useRef(0);
  useEffect(() => {
    if (!injectedDraft || injectedDraft.key === lastInjected.current) return;
    lastInjected.current = injectedDraft.key;
    const text = injectedDraft.text.trim();
    const base = input.trimEnd();
    const next = !text || base.includes(text) ? input : (base ? base + " " : "") + injectedDraft.text;
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
  // first-turn identity of the previous history commit — a CHANGED first id
  // means turns were PREPENDED (load older), not appended: never chase the
  // bottom then; the anchor restore in loadOlder owns the scroll position
  const prevFirstTurnId = useRef<string | null>(null);
  useEffect(() => {
    const firstId = history.turns[0]?.id ?? null;
    const isPrepend = prevFirstTurnId.current !== null && firstId !== prevFirstTurnId.current;
    prevFirstTurnId.current = firstId;
    if (isPrepend) return;
    requestAnimationFrame(() => {
      const el = scroll.current;
      // snap, not smooth: an animated stream-scroll fights native scroll
      // anchoring during prepends and piles up in-flight animations
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
  }, [run.answer, run.activity, run.submittedText, history]);
  useEffect(() => {
    // live elapsed timers: the desktop's in-progress turns AND this view's
    // own runs — a long provider wait must visibly progress in time instead
    // of reading as a silent hang
    if ((!externalActive || !externalStartedAt) && !localBusyRef.current) return;
    const t = setInterval(() => {
      setExternalTick(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [externalActive, externalStartedAt, run.phase]);
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
  // mid-turn on this session. The composer remains editable while busy: Enter
  // adds an immutable follow-up to the desktop-style client queue.
  const busy = localBusy || externalActive;
  const localBusyRef = useRef(false);
  useEffect(() => { localBusyRef.current = localBusy; }, [localBusy]);
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

  // multi-file attach: preflight against the server-advertised caps BEFORE
  // any base64 read — an oversized file must fail in a millisecond, not after
  // a full FileReader round trip — then upload the valid remainder
  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const accepted: File[] = [];
    for (const file of list) {
      if (file.size === 0) onNotify(`${file.name}: empty file`, "error");
      else if (file.size > maxUploadBytes) onNotify(`${file.name}: too large (${formatBytes(file.size)} — limit ${formatBytes(maxUploadBytes)})`, "error");
      else accepted.push(file);
    }
    // the server rejects sends beyond maxAttachments with an explicit error
    // (ZWUI-072) — mirror the cap here so a sixth file never shows as attached
    const room = maxAttachments - attachments.length;
    if (accepted.length > Math.max(0, room)) {
      const overflow = accepted.splice(Math.max(0, room));
      onNotify(`${maxAttachments} attachments max — skipped ${overflow.map((f) => f.name).join(", ")}`, "error");
    }
    if (!accepted.length) return;
    setUploading((n) => n + accepted.length);
    for (const file of accepted) {
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
  }, [client, onNotify, maxUploadBytes, maxAttachments, attachments.length]);

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
    // anchor the FIRST turn node (descendant query — el is itself the scroll
    // container; the load-older button contains no articles so tree order
    // gives the topmost turn). Keyed by turn id, this exact node survives
    // the prepend — its offsetTop grows by the prepended height.
    const anchor = el?.querySelector("article, .timeline-stack") as HTMLElement | null;
    const anchorTop = anchor?.offsetTop ?? 0;
    const delta = el ? el.scrollTop - anchorTop : 0;
    try {
      const d = await client.session(sessionId, HISTORY_PAGE, history.turns.length);
      setHistory((h) => {
        // ZWUI-062: prepend by stable id — a shifted page (new turns landed
        // server-side between loads) must not duplicate rows already held
        const known = new Set(h.turns.map((t) => t.id));
        const fresh = d.transcript.filter((t) => !known.has(t.id));
        return { turns: [...fresh, ...h.turns], total: d.total, hasMore: d.hasMore };
      });
      // restore after the prepend COMMITS: double-rAF puts the first read
      // past React's commit, then the loop only writes while off-target and
      // exits after settling (covers late layout shifts like the button
      // re-render — without fighting anything: scroll-behavior is instant)
      let frames = 0;
      let stable = 0;
      const restore = () => {
        if (!el || !anchor || !anchor.isConnected || frames++ > 90 || stable >= 3) return;
        const target = anchor.offsetTop + delta;
        if (Math.abs(el.scrollTop - target) > 1) {
          el.scrollTop = target;
          stable = 0;
        } else {
          stable += 1;
        }
        requestAnimationFrame(restore);
      };
      requestAnimationFrame(() => requestAnimationFrame(restore));
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

  useEffect(() => {
    const interrupt = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !busy || overlayOpen() || menu || turnMenu || cmdQuery != null) return;
      e.preventDefault();
      stopRunRef.current?.();
    };
    window.addEventListener("keydown", interrupt);
    return () => window.removeEventListener("keydown", interrupt);
  }, [busy, menu, turnMenu, cmdQuery]);

  const queueCurrentDraft = useCallback(() => {
    const text = input.trim();
    if ((!text && !attachments.length) || uploading > 0 || !providerLive) return false;
    const sub = snapshotSubmission({
      draftKey, revision: draftRevRef.current,
      projectKey: cwd, cwd, sessionId,
      text, model: model || "", mode,
      attachments: attachments.map((a) => ({ uploadRef: a.path, name: a.name })),
    }, randomUUID());
    setQueuedSubmissions((q) => [...q, sub]);
    setInput("");
    setAttachments([]);
    touchDraft();
    saveDraft(draftKey, "");
    return true;
  }, [input, attachments, uploading, providerLive, draftKey, cwd, sessionId, model, mode, touchDraft]);

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

  const submitQueued = useCallback((sub: Submission) => {
    // A follow-up may have been queued before a fresh chat received its
    // session id. Bind it to the now-authoritative conversation at flush time
    // rather than accidentally opening a second session.
    const bound = sub.sessionId ? sub : { ...sub, sessionId };
    submitWith(bound, { clearDraft: false, submitView: runKey });
  }, [submitWith, runKey, sessionId]);

  // Once this turn reaches a terminal state, send exactly one queued item.
  // Failed/cancelled turns retain the queue so the user can retry deliberately.
  // External desktop/CLI turns have no local phase, so their busy transition is
  // part of the same flush signal.
  const previousBusy = useRef(busy);
  const flushingQueue = useRef(false);
  useEffect(() => {
    const wasBusy = previousBusy.current;
    previousBusy.current = busy;
    if (!queuedSubmissions.length || flushingQueue.current) return;
    // A locally attached job is authoritative for this view. The shared
    // session store can remain "active" briefly after the same job has
    // completed, so waiting for the aggregate busy flag would strand the
    // follow-up indefinitely during that commit window.
    const localFinished = !!run.jobId && isTerminal(run.phase);
    if ((!localFinished && (!wasBusy || busy))) return;
    const picked = dequeueAfterSuccess(queuedSubmissions, run.phase === "idle" ? "succeeded" : run.phase);
    if (!picked.next) return;
    flushingQueue.current = true;
    setQueuedSubmissions([...picked.rest]);
    queueMicrotask(() => {
      flushingQueue.current = false;
      submitQueued(picked.next!);
    });
  }, [busy, run.jobId, run.phase, queuedSubmissions.length, submitQueued]);

  const guard = uploading > 0 || !providerLive;

  // ZWUI-082: steer — interrupt the current turn and send the drafted message
  // the moment the interrupt settles. Kept apart from the follow-up queue on
  // purpose: the queue retains work after a cancellation for a deliberate
  // retry, while a steered message is sent as soon as the run has stopped.
  const [steerPending, setSteerPending] = useState<Submission | null>(null);
  const steer = useCallback(() => {
    const text = input.trim();
    if ((!text && !attachments.length) || uploading > 0 || !providerLive || !busy || !run.jobId) return;
    const sub = snapshotSubmission({
      draftKey, revision: draftRevRef.current,
      projectKey: cwd, cwd, sessionId,
      text, model: model || "", mode,
      attachments: attachments.map((a) => ({ uploadRef: a.path, name: a.name })),
    }, randomUUID());
    setSteerPending(sub);
    setInput(""); setAttachments([]); touchDraft(); saveDraft(draftKey, "");
    stopRun();
  }, [input, attachments, uploading, providerLive, busy, run.jobId, draftKey, cwd, sessionId, model, mode, touchDraft, stopRun]);

  const steerSettling = useRef(false);
  useEffect(() => {
    if (!steerPending) return;
    // same authority rule as the queue flush: the locally attached job is
    // terminal ⇒ send now. The aggregate busy flag lags the store's
    // recency-windowed activity marker right after a cancel.
    const settled = !!run.jobId && isTerminal(run.phase);
    if (!settled || steerSettling.current) return;
    steerSettling.current = true;
    const sub = steerPending;
    setSteerPending(null);
    queueMicrotask(() => {
      steerSettling.current = false;
      submitQueued(sub);
    });
  }, [steerPending, run.jobId, run.phase, submitQueued]);

  // composer send: the submitted record IS the draft, or a queued follow-up
  // when the current turn still owns the session.
  const send = useCallback(() => {
    const text = input.trim();
    if (!text && !attachments.length) return;
    if (busy) { queueCurrentDraft(); return; }
    if (guard) return;
    submitWith(snapshotSubmission({
      draftKey, revision: draftRevRef.current,
      projectKey: cwd, cwd, sessionId,
      text, model: model || "", mode,
      attachments: attachments.map((a) => ({ uploadRef: a.path, name: a.name })),
    }, randomUUID()), { clearDraft: true, submitView: runKey });
  }, [guard, busy, queueCurrentDraft, input, attachments, draftKey, cwd, sessionId, mode, model, runKey, submitWith]);

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

  const selectedModel = useMemo(() => models.find((item) => item.ref === model) || null, [models, model]);
  const filteredModels = useMemo(() => filterModels(models, modelQuery), [models, modelQuery]);
  const modelGroups = useMemo(() => groupModels(filteredModels), [filteredModels]);
  const recentVisibleModels = useMemo(
    () => modelQuery.trim() ? [] : recentModels(filteredModels, recentModelRefs),
    [filteredModels, recentModelRefs, modelQuery],
  );
  const recentModelRefSet = useMemo(() => new Set(recentVisibleModels.map((item) => item.ref)), [recentVisibleModels]);
  const visibleModelGroups = useMemo(
    () => modelGroups
      .map((group) => ({ ...group, models: group.models.filter((item) => !recentModelRefSet.has(item.ref)) }))
      .filter((group) => group.models.length > 0),
    [modelGroups, recentModelRefSet],
  );
  const pickerModels = useMemo(
    () => [...recentVisibleModels, ...visibleModelGroups.flatMap((group) => group.models)],
    [recentVisibleModels, visibleModelGroups],
  );
  const selectModel = useCallback((next: ModelInfo) => {
    setModel(next.ref);
    savePrefs({ model: next.ref });
    const nextRecent = rememberRecentModel(next.ref);
    setRecentModelRefs(nextRecent);
    setModelQuery("");
    setMenu(null);
  }, []);
  const openModelMenu = useCallback(() => {
    const opening = menu !== "model";
    setMenu(opening ? "model" : null);
    if (!opening) return;
    setModelQuery("");
    const selectedIndex = pickerModels.findIndex((item) => item.ref === model);
    setModelActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    if (!models.length && !modelsLoading) void loadModels();
    window.setTimeout(() => modelSearchInput.current?.focus(), 0);
  }, [loadModels, menu, model, models.length, modelsLoading, pickerModels]);
  const modelOptionId = (ref: string) => `model-option-${ref.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const handleModelSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!pickerModels.length) {
      if (event.key === "Escape") setMenu(null);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setModelActiveIndex((index) => (index + 1) % pickerModels.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setModelActiveIndex((index) => (index - 1 + pickerModels.length) % pickerModels.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectModel(pickerModels[modelActiveIndex] || pickerModels[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
    }
  }, [pickerModels, modelActiveIndex, selectModel]);
  useEffect(() => {
    if (menu !== "model") return;
    setModelActiveIndex((index) => {
      const selectedIndex = pickerModels.findIndex((item) => item.ref === model);
      if (selectedIndex >= 0 && (index < 0 || !pickerModels[index])) return selectedIndex;
      return Math.min(index, Math.max(0, pickerModels.length - 1));
    });
  }, [menu, model, pickerModels]);

  // ZWUI-051: bare #N resolves against THIS project's origin remote —
  // switching projects never reinterprets an old reference (resolution is
  // per-scan, against the conversation's own binding)
  const resolveBare = useCallback(() => repoBinding ?? null, [repoBinding]);
  const conversationIssueRefs = useMemo(() => {
    const texts = history.turns.filter((t) => t.text).map((t) => t.text);
    if (run.answer) texts.push(run.answer);
    if (run.submittedText) texts.push(run.submittedText);
    return scanIssueRefs(texts.join("\n\n"), { resolveBare });
  }, [history.turns, run.answer, run.submittedText, resolveBare]);
  const issueRefSig = conversationIssueRefs.map(issueKey).join("|");
  useEffect(() => {
    if (onIssuesChange) onIssuesChange(conversationIssueRefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueRefSig]);

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
  // ZWUI-077: completed-turn working time (turn_usage sum) — the desktop's
  // "Worked for 12m 26s". The live turn's elapsed time is added on top.
  const [workedMs, setWorkedMs] = useState(0);
  // ZWUI-067 (live QA): step-finish tokens.total is per-STEP usage (each call
  // re-feeds the context), so the sum across a long session is a billing
  // figure, not a size. The chip shows the CURRENT CONTEXT — freshest
  // source first: the live stream's turn.completed usage, then the last
  // loaded turn's step total, then the server's store-level latest. The
  // cumulative figure stays in the token audit dialog, labeled honestly.
  const [contextTokens, setContextTokens] = useState<number | null>(null);
  const contextNow = useMemo(() => {
    if (liveTokens && !isTerminal(run.phase)) return liveTokens;
    const lastWithTokens = [...history.turns].reverse().find((t) => (t.tokens || 0) > 0);
    return lastWithTokens?.tokens ?? contextTokens ?? null;
  }, [liveTokens, run.phase, history.turns, contextTokens]);
  const sessionTokens = contextNow;

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
  // ZWUI-064: live tool evidence is keyed by TOOL-CALL IDENTITY (callID) —
  // one card per call that progresses through statuses, not one card per
  // event (the terminal drawer below already uses this keying; both views
  // now agree). Events without a callID get a synthetic key but stay stable.
  const liveTools = useMemo(() => {
    const byCall = new Map<string, { name: string; status: string; detail: string }>();
    for (const e of run.events) {
      if (e.kind !== "line") continue;
      const line = e.line as { type?: string; payload?: { toolName?: string; callID?: string; input?: unknown } };
      if (!line?.type?.startsWith("tool.call.")) continue;
      const callId = String(line.payload?.callID || `ev-${e.id}`);
      const status = String(line.type.split(".").pop() || "");
      const existing = byCall.get(callId);
      if (existing) {
        existing.status = status;
      } else {
        byCall.set(callId, {
          name: String(line.payload?.toolName || "tool"),
          status,
          detail: normalizeCommand(line.payload?.input, String(line.payload?.toolName || "tool")).slice(0, 400),
        });
      }
    }
    return [...byCall.values()];
  }, [run.events]);
  const liveError = run.events.reduce<string | null>((acc, e) => {
    if (e.kind === "line") {
      const line = e.line as { type?: string; payload?: { error?: { message?: string } } };
      if (line.type === "turn.failed" && line.payload?.error?.message) return line.payload.error.message;
    }
    return acc;
  }, null);

  // ZWUI-063: once the transcript carries the persisted form of the run's
  // answer, the live block duplicates it below the real turn. Fold ONLY when
  // a matching persisted assistant turn exists — delayed persistence keeps
  // the live copy visible; matching is by run answer prefix + created after
  // submit (persistence may normalize whitespace, exact === is too strict).
  const liveFolded = useMemo(() => {
    if (!isTerminal(run.phase) || !run.answer) return false;
    const prefix = run.answer.trim().slice(0, 60);
    if (!prefix) return false;
    return history.turns.some(
      (t) => t.role === "assistant" && t.text.trim().startsWith(prefix) && (t.createdAt || 0) >= (run.submittedAt || 0) - 2000
    );
  }, [run.phase, run.answer, run.submittedAt, history.turns]);

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
        {/* ZWUI-077: the desktop's session-level "Worked for 12m 26s" —
            completed-turn time from turn_usage plus the live turn's elapsed.
            Shown only while the agent is actually working; once the turn ends
            the transcript's own Completed summary takes over */}
        {(() => {
          if (!busy) return null;
          const live = localBusy && run.submittedAt
            ? workedMs + Math.max(1000, (externalTick || run.submittedAt) - run.submittedAt)
            : workedMs;
          if (live < 1000) return null;
          return (
            <span className="worked-chip" title="Cumulative agent working time (completed turns + the live turn)">
              <Clock3 size={12} />
              <span>Worked for {formatDuration(live)}</span>
            </span>
          );
        })()}
        {/* the single usage entry point — REF2-06 keeps detailed numbers here,
            not repeated across composer and messages. Shows the CURRENT
            CONTEXT (what the next call re-feeds), matching the desktop; the
            cumulative all-steps figure lives in the audit dialog */}
        <button className="details-toggle token-chip" onClick={() => setTokenDialog(true)} title="Current context size — open the token audit for cumulative usage">
          <Coins size={12} />
          <span>{sessionTokens != null ? `${sessionTokens >= 10_000 ? `${Math.round(sessionTokens / 1000)}k` : sessionTokens.toLocaleString()} context` : "Context"}</span>
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
      <div className="messages-scroll" ref={scroll}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest("[data-issue-ref]");
          if (!el) return;
          e.preventDefault();
          const identity = parseIssueKey(el.getAttribute("data-issue-ref") || "");
          if (identity) onOpenIssue?.(identity);
        }}
        onScroll={(e) => {
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
                {/* no sender name — the brand is the app itself; the byline
                    carries only recency, tokens and the details toggle */}
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
                  {/* the turn's tool calls live INSIDE the collapsible — after
                      completion only the summary row shows, like the app */}
                  {(t.tools || []).length > 0 && (
                    <div className="activity-stack">
                      {(t.tools || []).map((tool, j) => (
                        <ToolActivity key={j} name={tool.name} status={tool.status} detail={tool.detail} />
                      ))}
                    </div>
                  )}
                </details>
              )}
              {!detailsHidden && (t.files || []).length > 0 && (
                <FileCards files={t.files || []} onPreview={(f) => void previewArtifact(f)} />
              )}
              <Markdown text={t.text} issueResolver={resolveBare} />
              {t.durationMs || t.tokens || t.error ? (
                <div className="message-footer">
                  {/* ZWUI-063: a failed turn is a failure indicator, never a
                      success checkmark with "failed" appended */}
                  {t.error ? (
                    <span className="task-completed failed-state" title={t.error}>
                      <X size={12} className="danger-text" />Turn failed
                      {t.durationMs ? ` · after ${formatDuration(t.durationMs)}` : ""}
                    </span>
                  ) : (
                    <span className="task-completed">
                      <CheckMark />
                      {/* the app's completion summary — duration lives in the
                          byline time and the collapsed "Thinking · Xs" row */}
                      Completed
                      {t.tokens ? (
                        <button className="turn-tokens" onClick={() => setTokenDialog(true)} title="Token telemetry">
                          · {(t.tokens / 1000).toFixed(1)}k tokens
                        </button>
                      ) : null}
                    </span>
                  )}
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
            <div className="working-message external-working">
              <LoaderCircle size={13} className="spin" />
              <span>Working for {externalStartedAt && externalTick ? <span className="working-elapsed">{formatDuration(Math.max(1000, externalTick - externalStartedAt))}</span> : "…"}<span className="thinking-dots"><i /><i /><i /></span></span>
            </div>
          </article>
        )}

        {/* live block is for runs attached HERE; external activity has its own
            row. ZWUI-063: a folded run (its persisted turn is in the history
            above) drops its duplicated content — the persisted turn owns the
            byline, footer and details now. Failures never fold: the error and
            its retry must stay visible */ }
        {(run.answer || run.reasoning || localBusy || run.error) && (!liveFolded || run.error) && (
          <article className="agent-message">
            <div className="agent-byline">
              {/* no sender name — the chip carries only LIVE state:
                  the running timer, or the interrupted verdict after a stop.
                  A finished turn shows just the Completed footer summary */}
              {(localBusy || run.phase === "cancelled") && (
                <span className="message-duration" title={localBusy ? "running" : run.phase}>
                  <Clock3 size={11} />
                  {localBusy && run.submittedAt
                    ? `running · ${formatDuration(Math.max(1000, (externalTick || run.submittedAt) - run.submittedAt))}`
                    : run.phase}
                </span>
              )}
              <button className="message-details-toggle" onClick={() => setDetailsHidden((v) => !v)} aria-expanded={!detailsHidden}>
                {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Details" : "Hide"}</span>
              </button>
            </div>
            {/* answer first: while running, the CURRENT activity streams
                visibly; once terminal, routine details collapse (REF2-03) —
                failures below always stay visible */}
            {!detailsHidden && localBusy && run.reasoning && (
              <div className="thinking-block live">
                <div className="thinking-heading">
                  <Brain size={13} />
                  <span>Thinking{run.submittedAt ? ` · ${formatDuration(Math.max(1000, (externalTick || run.submittedAt) - run.submittedAt))}` : ""}</span>
                  <span className="thinking-dots"><i /><i /><i /></span>
                  <span className="thinking-hint">How I approached this</span>
                </div>
                <p>{run.reasoning}</p>
              </div>
            )}
            {!detailsHidden && localBusy && liveTools.length > 0 && (
              <div className="activity-stack">
                {liveTools.map((t, i) => (
                  <ToolActivity key={i} name={t.name} status={t.status} detail={t.detail || ""} live />
                ))}
              </div>
            )}
            {!localBusy && !detailsHidden && !liveFolded && (run.reasoning || liveTools.length > 0) && (
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
            {run.answer && !liveFolded
              ? <span className="stream-wrap"><Markdown text={run.answer} issueResolver={resolveBare} />{localBusy && <span className="stream-caret" aria-hidden="true" />}</span>
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
            {/* ZWUI-063: neutral completion language — a successful process
                exit does not prove a plan artifact exists or the task is done */}
            {!busy && !liveFolded && run.phase === "succeeded" && (
              <div className="message-footer">
                <span className="task-completed">
                  <CheckMark />Completed
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
            {!busy && !liveFolded && run.phase === "cancelled" && (
              <div className="message-footer">
                <span className="task-completed">Run stopped</span>
              </div>
            )}
          </article>
        )}

        {localBusy && (
          <div className="working-message" role="status">
            <span>Working for {run.submittedAt ? formatDuration(Math.max(1000, (externalTick || run.submittedAt) - run.submittedAt)) : "…"}<span className="thinking-dots"><i /><i /><i /></span></span>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <AgentTerminalDrawer
          open={terminalOpen}
          entries={visibleTerminalEntries}
          onClose={() => setTerminalOpen(false)}
          onClear={() => setTerminalClearedSig(terminalSignature)}
        />
      </Suspense>

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
          {queuedSubmissions.length > 0 && (
            <div className="queued-prompts" aria-live="polite">
              <span className="queued-prompts-label">
                <Clock3 size={12} />
                {queuedSubmissions.length} queued follow-up{queuedSubmissions.length === 1 ? "" : "s"}
              </span>
              <div className="queued-prompts-list">
                {queuedSubmissions.map((q, idx) => (
                  <span className="queued-prompt-chip" key={q.requestId} title={q.text}>
                    <Clock3 size={11} />
                    <span className="queued-prompt-text">{q.text.slice(0, 48)}{q.text.length > 48 ? "…" : ""}</span>
                    <button
                      type="button"
                      className="queued-item-remove"
                      aria-label={`Remove queued follow-up: ${q.text.slice(0, 20)}`}
                      onClick={() => setQueuedSubmissions((all) => all.filter((_, i) => i !== idx))}
                    >✕</button>
                  </span>
                ))}
              </div>
              <button
                className="queued-clear"
                type="button"
                onClick={() => setQueuedSubmissions([])}
                title="Clear all queued follow-ups"
              >Clear all</button>
            </div>
          )}
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
              // Shift+Tab stays native (reverse focus navigation); IME-safe Enter.
              // While busy this is a queue action, not a disabled composer.
              if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); send(); }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-left">
              <div className="composer-menu-wrap">
                <IconButton label="Attach a file" onClick={() => fileInput.current?.click()}><Plus size={17} /></IconButton>
              </div>
              <div className="composer-menu-wrap">
                <button className="mode-picker" aria-haspopup="menu" aria-expanded={menu === "mode"} onClick={() => setMenu(menu === "mode" ? null : "mode")}>
                  <ShieldCheck size={13} /><span>{mode === "yolo" ? "Full access" : mode}</span><ChevronDown size={11} />
                </button>
                {menu === "mode" && (
                  <div className="popover mode-popover" role="menu" aria-label="Execution mode">
                    <div className="popover-label">EXECUTION MODE</div>
                    {modes.map((m) => ({
                      id: m,
                      // the desktop's display name for the unrestricted mode
                      label: m === "yolo" ? "Full access" : m.charAt(0).toUpperCase() + m.slice(1),
                      description: ({
                        plan: "Think it through before building",
                        build: "Make changes to project files",
                        edit: "Edit files with confirmation",
                        yolo: "Run without asking (trusted repos)",
                      } as Record<string, string>)[m] || "Server-advertised execution mode",
                    })).map((item) => (
                      <button key={item.id} role="menuitemradio" aria-checked={mode === item.id} onClick={() => { setMode(item.id); savePrefs({ mode: item.id }); setMenu(null); }}>
                        {item.id === "plan" ? <MessageSquare size={15} /> : item.id === "yolo" ? <ShieldCheck size={15} /> : <SquarePen size={15} />}
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
                <button
                  className="model-picker"
                  aria-haspopup="dialog"
                  aria-expanded={menu === "model"}
                  aria-label={`Model: ${selectedModel ? `${modelLabel(selectedModel)} from ${selectedModel.providerName}` : "Choose model"}`}
                  title={selectedModel ? `${modelLabel(selectedModel)} · ${selectedModel.ref}` : "Choose model"}
                  onClick={openModelMenu}
                >
                  <Sparkles size={12} /><span>{selectedModel ? modelLabel(selectedModel) : modelsLoading ? "Loading…" : "Choose model"}</span><ChevronDown size={11} />
                </button>
                {menu === "model" && (
                  <div className="popover model-popover" role="dialog" aria-label="Select model">
                    <div className="model-picker-header">
                      <div>
                        <strong>Select model</strong>
                        <small>{models.length ? `${models.length} configured model${models.length === 1 ? "" : "s"}` : "From your CLI providers"}</small>
                      </div>
                      <button className="model-refresh" type="button" aria-label="Refresh models" title="Refresh models" onClick={() => void loadModels()} disabled={modelsLoading}>
                        <RefreshCw size={13} className={modelsLoading ? "spin" : ""} />
                      </button>
                    </div>
                    <label className="model-search-field">
                      <Search size={14} />
                      <input
                        ref={modelSearchInput}
                        value={modelQuery}
                        onChange={(event) => { setModelQuery(event.target.value); setModelActiveIndex(0); }}
                        onKeyDown={handleModelSearchKeyDown}
                        placeholder="Search models or providers…"
                        aria-label="Search models or providers"
                        role="combobox"
                        aria-controls="model-options"
                        aria-expanded="true"
                        aria-autocomplete="list"
                        aria-activedescendant={pickerModels[modelActiveIndex] ? modelOptionId(pickerModels[modelActiveIndex].ref) : undefined}
                      />
                      {modelQuery && <button type="button" aria-label="Clear model search" onClick={() => { setModelQuery(""); setModelActiveIndex(0); modelSearchInput.current?.focus(); }}><X size={13} /></button>}
                    </label>
                    {modelError && (
                      <div className="model-picker-error" role="alert">
                        <span>{modelError}</span>
                        <button type="button" onClick={() => void loadModels()}>Retry</button>
                      </div>
                    )}
                    <div className="model-picker-results" id="model-options" role="menu" aria-label="Available models">
                      {modelsLoading && !models.length && <div className="model-picker-state"><LoaderCircle size={15} className="spin" />Loading models…</div>}
                      {!modelsLoading && !modelError && !models.length && <div className="model-picker-state">No configured models found.</div>}
                      {!modelsLoading && !pickerModels.length && models.length > 0 && <div className="model-picker-state">No models match “{modelQuery}”.<button type="button" onClick={() => setModelQuery("")}>Clear search</button></div>}
                      {recentVisibleModels.length > 0 && (
                        <div className="model-provider-group model-recent-group">
                          <div className="model-section-label">RECENT <span>{recentVisibleModels.length}</span></div>
                          {recentVisibleModels.map((item) => {
                            const index = pickerModels.findIndex((candidate) => candidate.ref === item.ref);
                            return (
                                <button id={modelOptionId(item.ref)} key={`recent-${item.ref}`} role="menuitemradio" aria-checked={model === item.ref} className={index === modelActiveIndex ? "is-active" : ""} onMouseEnter={() => setModelActiveIndex(index)} onClick={() => selectModel(item)}>
                                <Sparkles size={15} /><span><b>{modelLabel(item)}</b><small>{compactModelRef(item.ref)}</small></span>{item.isDefault && <span className="model-default-badge">Default</span>}<span className="model-row-meta">Recent</span>{model === item.ref && <Check size={13} className="success-text" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {visibleModelGroups.map((group) => (
                        <div className="model-provider-group" key={group.key}>
                          <div className="model-section-label"><span>{group.providerName}</span><small>{compactProviderId(group.provider)} · {group.models.length}</small></div>
                          {group.models.filter((item) => !recentModelRefSet.has(item.ref)).map((item) => {
                            const index = pickerModels.findIndex((candidate) => candidate.ref === item.ref);
                            return (
                              <button id={modelOptionId(item.ref)} key={item.ref} role="menuitemradio" aria-checked={model === item.ref} className={index === modelActiveIndex ? "is-active" : ""} onMouseEnter={() => setModelActiveIndex(index)} onClick={() => selectModel(item)}>
                                <Sparkles size={15} /><span><b>{modelLabel(item)}</b><small>{compactModelRef(item.ref)}</small></span>{item.isDefault && <span className="model-default-badge">Default</span>}{model === item.ref && <Check size={13} className="success-text" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* ONE morphing primary action, like the desktop: Send when
                  idle; once the job is accepted it becomes Stop (a spinner
                  alone only while the POST is still in flight) */}
              {busy && run.jobId && (input.trim() || attachments.length > 0) && (
                <button className="composer-stop-button" type="button" aria-label="Stop run" title="Stop run (Escape)" onClick={stopRun}>
                  <Square size={13} />
                </button>
              )}
              {/* steer: interrupt the current turn and send the draft now */}
              {busy && run.jobId && (input.trim() || attachments.length > 0) && (
                <IconButton
                  label="Steer — interrupt and send now"
                  className="steer-button"
                  title="Steer — interrupt the current turn and send this message now"
                  onClick={steer}
                ><Zap size={14} /></IconButton>
              )}
              <button
                className={`send-button ${busy && run.jobId && !input.trim() && !attachments.length ? "stop" : ""}`}
                disabled={busy
                  ? !run.jobId && (!input.trim() && !attachments.length) // submitting: queue once text exists
                  : uploading > 0 || !providerLive || (!input.trim() && !attachments.length)}
                aria-label={busy && run.jobId && !input.trim() && !attachments.length ? "Stop run" : busy ? "Queue message" : "Send message"}
                title={busy && run.jobId && !input.trim() && !attachments.length ? "Stop run (Escape)"
                  : busy ? "Queue follow-up (Enter)"
                  : !providerLive ? "No model provider is configured on this host"
                  : "Send message (Enter)"}
                onClick={() => (busy && run.jobId && !input.trim() && !attachments.length ? stopRun() : send())}
              >
                {busy && run.jobId && !input.trim() && !attachments.length
                  ? <Square size={15} />
                  : busy && !run.jobId
                    ? <LoaderCircle size={16} className="spin" />
                    : <ArrowUp size={17} strokeWidth={2.2} />}
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
        <Suspense fallback={null}>
          <TokenTelemetryDialog
            sessionId={sessionId || "draft"}
            title={sessionTitle || "New chat"}
            turns={history.turns}
            totalTurns={history.total}
            sessionTotal={sessionTokensTotal}
            contextTokens={contextNow}
            liveTokens={liveTokens && !isTerminal(run.phase) ? liveTokens : null}
            onClose={() => setTokenDialog(false)}
          />
        </Suspense>
      )}
    </section>
  );
}

// byline time — exact HH:MM by default (with a short date for older
// messages), relative ("5m") when the Exact times toggle is off
function Time({ createdAt, exact }: { createdAt: number; exact: boolean }) {
  const d = new Date(createdAt);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const label = exact
    ? (new Date().toDateString() === d.toDateString() ? hhmm : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${hhmm}`)
    : relativeTime(createdAt);
  return <time title={d.toLocaleString()}>{label}</time>;
}


// Reference-pattern collapsible tool evidence (activity-stack classes).
function ToolActivity({ name, status, detail, live = false }: { name: string; status: string; detail?: string; live?: boolean }) {
  const [openItem, setOpenItem] = useState(false);
  const done = status === "completed" || status === "succeeded";
  // desktop-style collapsed row: the tool plus a one-line preview of what it
  // touched (command, file, URL); the full detail still expands. MCP tools
  // shorten to their server.tool form (mcp__node_repl__js → node_repl.js).
  const label = name.startsWith("mcp__") ? name.split("__").slice(1).join(".") : name;
  const summary = detail?.split("\n").map((l) => l.trim()).find((l) => l.length > 0)?.slice(0, 90) ?? "";
  return (
    <div className={`activity-item ${openItem ? "is-open" : ""}`}>
      <button className="activity-trigger" onClick={() => setOpenItem(!openItem)} aria-expanded={openItem} title={summary || name}>
        <ChevronRight size={12} className="activity-chevron" />
        {name === "Bash" ? <Terminal size={14} /> : <Wrench size={14} />}
        <span>{label}</span>
        {summary && <span className="activity-summary">{summary}</span>}
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
