// ChatPanel ported to the reference design: context strip, messages-scroll
// with byline blocks, thinking + tool evidence, bottom composer with
// mode/model pickers, live-run "working" message. Run state comes from the
// ZWUI-016 reducer; transport from the ZWUI-017 controller.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, ArrowUpRight, AtSign, BadgeCheck, Brain, ChevronUp, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Copy, Eye, EyeOff, FileText, FoldVertical, GitBranch, LoaderCircle, MessageSquare, Plus, ShieldCheck, Sparkles, Square, SquarePen, Terminal, Wrench, X } from "lucide-react";
import { ZLogo, IconButton, Markdown, CheckMark } from "../ui";
import { randomUUID } from "../lib/uuid";
import { ApiError, type ApiClient, type FileCard, type ModelInfo, type TimelineEvent, type TranscriptTurn } from "../api/client";
import { runReducer, initialRun, isTerminal, type StoredEvent } from "../state/run";
import { StreamController } from "../state/stream";
import { loadDraft, saveDraft, loadPrefs, savePrefs } from "../state/prefs";

// One pending attachment: uploaded path for --attach plus the local File for
// in-composer preview (object URL created lazily, revoked on removal)
type Attachment = { name: string; path: string; file?: File; previewUrl?: string };
type PreviewState =
  | { kind: "image"; title: string; src: string }
  | { kind: "pdf"; title: string; src: string }
  | { kind: "text"; title: string; text: string };

// zcode-artifact://<sessionId>/tool-result-<uuid> → server route args
function artifactArgs(url: string): { sessionId: string; uuid: string } | null {
  const m = url.match(/zcode-artifact:\/\/(sess_[A-Za-z0-9-]+)\/tool-result-([A-Za-z0-9-]+)$/);
  return m ? { sessionId: m[1], uuid: m[2] } : null;
}
const artifactUrl = (a: { sessionId: string; uuid: string }) => `/api/artifacts/${a.sessionId}/${a.uuid}`;


export function ChatPanel({
  client, cwd, sessionId, modes, defaultMode, branch, newChatNonce = 0, reloadKey = 0, injectedDraft, onNotify, onSessionCreated, onBusyChange,
}: {
  client: ApiClient;
  cwd: string;
  sessionId: string | null;
  modes: string[];
  defaultMode: string;
  branch?: string | null;
  newChatNonce?: number;
  reloadKey?: number;
  injectedDraft?: { text: string; key: number } | null;
  onNotify: (text: string, type?: "success" | "error") => void;
  onSessionCreated?: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const draftKey = `${cwd}::${sessionId || "new"}`;
  const [run, dispatch] = useReducer(runReducer, undefined, initialRun);
  const [input, setInput] = useState(loadDraft(draftKey));
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mode, setMode] = useState(defaultMode);
  const [model, setModel] = useState("");
  const [menu, setMenu] = useState<"mode" | "model" | null>(null);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [history, setHistory] = useState<{ turns: TranscriptTurn[]; total: number; hasMore: boolean }>({ turns: [], total: 0, hasMore: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const esRef = useRef<StreamController | null>(null);
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
        // server default first: a persisted ref may point at a provider that
        // is currently rate-limited or gone; the saved pick still wins over a
        // plain first-model fallback
        const saved = loadPrefs().model;
        setModel((cur) => cur || (r.models.find((m) => m.isDefault) || r.models.find((m) => m.ref === saved) || r.models[0])?.ref || "");
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  // load transcript for an existing session
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!sessionId) { setHistory({ turns: [], total: 0, hasMore: false }); setHistoryLoading(false); return; }
    // selecting a session: clear the previous view and show a loader until
    // the transcript arrives
    setHistory({ turns: [], total: 0, hasMore: false });
    setHistoryLoading(true);
    void client.session(sessionId, 10, 0)
      .then((d) => { if (alive) setHistory({ turns: d.transcript, total: d.total, hasMore: d.hasMore }); })
      .catch((e) => { if (alive) onNotify(e instanceof ApiError ? e.message : String(e), "error"); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [sessionId, client, onNotify, syncTick, reloadKey]);
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
  // shared store as they commit, so an open web view follows along (10s,
  // silent — the view only updates when the transcript actually changed)
  useEffect(() => {
    if (!sessionId) return;
    if (run.phase !== "idle" && !isTerminal(run.phase)) return;
    let alive = true;
    let fetching = false;
    const tick = setInterval(async () => {
      if (fetching || document.visibilityState !== "visible") return;
      fetching = true;
      try {
        const d = await client.session(sessionId, 10, 0);
        if (!alive) return;
        setHistory((cur) => {
          const next = { turns: d.transcript, total: d.total, hasMore: d.hasMore };
          return JSON.stringify(cur) === JSON.stringify(next) ? cur : next;
        });
      } catch { /* transient */ }
      finally { fetching = false; }
    }, 10_000);
    return () => { alive = false; clearInterval(tick); };
  }, [sessionId, run.phase, client]);

  useEffect(() => {
    if (lastKey.current !== draftKey) { setInput(loadDraft(draftKey)); setAttachments([]); setMenu(null); lastKey.current = draftKey; }
  }, [draftKey]);
  // injected drafts (skills launcher) land in the composer, keeping what's
  // already typed; the saved draft follows so it survives a remount
  const lastInjected = useRef(0);
  useEffect(() => {
    if (!injectedDraft || injectedDraft.key === lastInjected.current) return;
    lastInjected.current = injectedDraft.key;
    const next = (input ? input.trimEnd() + " " : "") + injectedDraft.text;
    setInput(next);
    saveDraft(draftKey, next);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.length, next.length); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedDraft?.key]);
  useEffect(() => {
    const t = setTimeout(() => saveDraft(draftKey, input), 250);
    return () => clearTimeout(t);
  }, [input, draftKey]);
  // switching conversations detaches this panel from any live run (the job
  // itself keeps running server-side) — except when the run just created the
  // session we are navigating to, so a fresh chat keeps its live stream
  const activeJob = useRef<string | null>(null);
  // the view identity a run was submitted under ("new" for a fresh chat);
  // adoption re-points it at the created session so the URL catching up is
  // not mistaken for a switch. undefined = no run attached to this view.
  const runViewKey = useRef<string | null | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detachRun = useCallback(() => {
    if (runViewKey.current === undefined) return;
    esRef.current?.close();
    esRef.current = null;
    activeJob.current = null;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    runViewKey.current = undefined;
    dispatch({ type: "reset" });
  }, []);
  // unmount (cwd switch remounts this panel): stop the stream subscription
  // and the reconciliation poll — the job itself keeps running server-side
  useEffect(() => () => {
    esRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);
  useEffect(() => {
    const viewKey = sessionId ?? "new";
    if (runViewKey.current !== undefined && runViewKey.current !== viewKey) detachRun();
  }, [sessionId, detachRun]);
  // New chat detaches any run — including one still awaiting its first
  // envelope under the same "new" view key; the job keeps running server-side
  const lastNonce = useRef(newChatNonce);
  useEffect(() => {
    if (lastNonce.current === newChatNonce) return;
    lastNonce.current = newChatNonce;
    detachRun();
  }, [newChatNonce, detachRun]);
  // a new chat learns its session from stream envelopes (the POST /api/chat
  // response has none yet) — surface it so the URL and sidebar catch up
  useEffect(() => {
    if (!sessionId && run.sessionId && run.phase !== "idle") {
      runViewKey.current = run.sessionId;
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
  useEffect(() => {
    requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight }));
  }, [run.answer, run.activity, history.turns.length]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".composer-menu-wrap")) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [menu]);

  const busy = run.phase !== "idle" && !isTerminal(run.phase);
  useEffect(() => { onBusyChange?.(busy); }, [busy]);

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

  // preview a transcript artifact (server sniffs content type)
  const previewArtifact = useCallback(async (f: FileCard) => {
    const a = artifactArgs(f.url);
    if (!a) { onNotify("This attachment can't be previewed here.", "error"); return; }
    const route = artifactUrl(a);
    if (f.mime.startsWith("image/")) setPreview({ kind: "image", title: f.mime.replace("image/", "").toUpperCase() + " artifact", src: route });
    else if (f.mime === "application/pdf") setPreview({ kind: "pdf", title: "PDF artifact", src: route });
    else {
      try {
        const text = await fetch(route, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } }).then((r) => r.text());
        setPreview({ kind: "text", title: "Artifact content", text: text.slice(0, 200_000) });
      } catch { onNotify("Could not load artifact.", "error"); }
    }
  }, [onNotify]);

  // scrollback: prepend the next older page, keeping the reading position
  const loadOlder = useCallback(async () => {
    if (!sessionId || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroll.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const d = await client.session(sessionId, 10, history.turns.length);
      setHistory((h) => ({ turns: [...d.transcript, ...h.turns], total: d.total, hasMore: d.hasMore }));
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : String(e), "error");
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, loadingOlder, history.turns.length, client, onNotify]);

  const stopRun = useCallback(() => {
    if (!run.jobId) return;
    void client.cancel(run.jobId).catch(() => onNotify("Could not stop the run.", "error"));
  }, [run.jobId, client, onNotify]);

  const send = useCallback(async () => {
    if (busy || uploading > 0) return;
    const text = input.trim();
    if (!text && !attachments.length) return;
    const requestId = randomUUID();
    const submitView = sessionId ?? "new";
    runViewKey.current = submitView;
    dispatch({ type: "submit", requestId });
    try {
      const accepted = await client.chat({
        text: text || "Analyze the attached file(s).",
        sessionId, cwd, mode, model: model || undefined,
        attachments: attachments.length ? attachments.map((a) => a.path) : undefined,
        requestId,
      });
      // the user may have switched views (or hit New chat) while the POST
      // was in flight — a detached panel must not adopt this job
      if (runViewKey.current !== submitView) return;
      dispatch({ type: "accepted", jobId: accepted.jobId, sessionId: accepted.sessionId ?? sessionId });
      activeJob.current = accepted.jobId;
      setInput(""); setAttachments([]);
      if (accepted.sessionId && accepted.sessionId !== sessionId) onSessionCreated?.(accepted.sessionId);
      const controller = new StreamController(client, accepted.jobId, {
        onEvents: (events: StoredEvent[]) => { if (activeJob.current === accepted.jobId) dispatch({ type: "events", events }); },
        onAttached: () => { if (activeJob.current === accepted.jobId) dispatch({ type: "stream-attached" }); },
        onDetached: () => { if (activeJob.current === accepted.jobId) dispatch({ type: "stream-detached" }); },
        onFatal: (message) => { if (activeJob.current === accepted.jobId) dispatch({ type: "submit-failed", error: message }); },
      });
      esRef.current?.close();
      esRef.current = controller;
      controller.start();
      // reconciliation poll: finalizes truthfully if the stream dies
      if (pollRef.current) clearInterval(pollRef.current);
      const poll = pollRef.current = setInterval(async () => {
        if (activeJob.current !== accepted.jobId) { clearInterval(poll); pollRef.current = null; return; }
        try {
          const st = await client.job(accepted.jobId);
          dispatch({ type: "job-status", status: st.status as never });
          if (["succeeded", "failed", "cancelled", "timeout"].includes(st.status)) { clearInterval(poll); pollRef.current = null; }
        } catch { /* transient */ }
      }, 5000);
      setTimeout(() => { clearInterval(poll); if (pollRef.current === poll) pollRef.current = null; }, 17 * 60_000);
    } catch (e) {
      if (runViewKey.current === submitView) {
        dispatch({ type: "submit-failed", error: e instanceof ApiError ? e.message : String(e) });
      }
    }
  }, [busy, uploading, input, attachments, client, sessionId, cwd, mode, model, onSessionCreated]);

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

  return (
    <section className="chat-panel" aria-label="Agent conversation">
      <div className="chat-context">
        <span title={cwd}><span className="project-dot" /><span>{cwd.split("/").filter(Boolean).pop()}</span><ChevronDown size={12} /></span>
        {branch && <span className="branch-chip" title="git branch (read-only)"><GitBranch size={12} />{branch}</span>}
        <button className="details-toggle" onClick={() => setDetailsHidden((v) => !v)} title="Toggle thinking and tool details for messages">
          {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Show details" : "Hide details"}</span>
        </button>
      </div>
      <div className="messages-scroll" ref={scroll}>
        {empty && (
          <div className="empty-conversation">
            <div className="empty-logo"><ZLogo size={35} /></div>
            <span className="eyebrow">FROM AN IDEA TO WHAT'S NEXT</span>
            <h2>Let's build something.</h2>
            <p>Describe what you have in mind.<br />I'll help you take it from here.</p>
            <div className="prompt-suggestions">
              {["Explain this project", "Write tests for the API", "Make a refactor plan"].map((text) => (
                <button key={text} onClick={() => { setInput(text); textarea.current?.focus(); }}><Sparkles size={13} />{text}<ArrowUpRight size={12} /></button>
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
          const timelineOnly = events.length > 0 && !t.text.trim() && !(t.tools || []).length && !(t.files || []).length && !t.reasoning;
          if (timelineOnly) {
            return <div className="timeline-stack" key={`h${i}`}>{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>;
          }
          return t.role === "user" ? (
            <article className="user-message-block" key={`h${i}`}>
              {events.length > 0 && <div className="timeline-stack">{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>}
              <div className="message-byline">
                <span className="user-avatar">Y</span><strong>You</strong>
                <IconButton label="Copy prompt" onClick={() => void copyText(`u${i}`, t.text)}>
                  {copied === `u${i}` ? <Check size={12} /> : <Copy size={12} />}
                </IconButton>
              </div>
              <div className="user-message">{t.text}</div>
              {(t.files || []).length > 0 && (
                <FileCards files={t.files || []} onPreview={(f) => void previewArtifact(f)} />
              )}
            </article>
          ) : (
            <article className={`agent-message ${detailsHidden ? "details-hidden" : ""}`} key={`h${i}`}>
              {events.length > 0 && <div className="timeline-stack">{events.map((ev, j) => <TimelineRow key={j} event={ev} />)}</div>}
              <div className="agent-byline">
                <span className="agent-avatar"><ZLogo size={18} /></span><strong>Zcode</strong>
                <button className="message-details-toggle" onClick={() => setDetailsHidden((v) => !v)} aria-expanded={!detailsHidden}>
                  {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Details" : "Hide"}</span>
                </button>
              </div>
              {!detailsHidden && t.reasoning && (
                <details className="thinking-block history-thinking">
                  <summary className="thinking-heading"><Brain size={13} /><span>Thinking</span><span className="thinking-hint">How I approached this</span></summary>
                  <p>{t.reasoning}</p>
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
              {t.text.startsWith("⚠") ? <div className="danger-text">{t.text}</div> : <Markdown text={t.text} />}
              <div className="message-footer">
                <span className="task-completed"><CheckMark />{t.text.startsWith("⚠") ? "Turn failed" : "Task completed"}{t.tokens ? <span className="turn-tokens">· {(t.tokens / 1000).toFixed(1)}k tokens</span> : null}</span>
                <span className="message-footer-actions">
                  <IconButton label="Copy response" onClick={() => void copyText(`h${i}`, t.text)}>
                    {copied === `h${i}` ? <CheckCheck size={13} /> : <Copy size={13} />}
                  </IconButton>
                </span>
              </div>
            </article>
          );
        })}

        {(run.answer || run.reasoning || busy || run.error) && (
          <article className="agent-message">
            <div className="agent-byline">
              <span className="agent-avatar"><ZLogo size={18} /></span><strong>Zcode</strong>
              <span className="agent-model">{(models.find((m) => m.ref === model)?.model || "GLM").split("/").pop()?.toUpperCase()}</span>
              {run.phase !== "idle" && <span className="message-duration"><Clock3 size={11} />{run.phase}</span>}
              <button className="message-details-toggle" onClick={() => setDetailsHidden((v) => !v)} aria-expanded={!detailsHidden}>
                {detailsHidden ? <Eye size={12} /> : <EyeOff size={12} />}<span>{detailsHidden ? "Details" : "Hide"}</span>
              </button>
            </div>
            {!detailsHidden && run.reasoning && (
              <div className="thinking-block"><Brain size={13} /><p>{run.reasoning}</p></div>
            )}
            {liveTools.length > 0 && (
              <div className="activity-stack">
                {liveTools.map((t, i) => (
                  <ToolActivity key={i} name={t.name} status={t.status} detail={t.detail || ""} live />
                ))}
              </div>
            )}
            {run.answer ? <Markdown text={run.answer} /> : null}
            {liveError && <div className="danger-text">{liveError}</div>}
            {run.error && <div className="danger-text">{run.error}</div>}
            {!busy && run.phase === "succeeded" && (
              <div className="message-footer">
                <span className="task-completed">
                  <CheckMark />{mode === "plan" ? "Plan ready" : "Task completed"}
                  {liveTokens ? <span className="turn-tokens">· {(liveTokens / 1000).toFixed(1)}k tokens</span> : null}
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

        {busy && (
          <div className="working-message" role="status">
            <span className="agent-avatar"><ZLogo size={18} /></span>
            <span>Zcode is working<span className="thinking-dots"><i /><i /><i /></span></span>
          </div>
        )}
      </div>

      <div
        className="composer-shell"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void attachFiles(e.dataTransfer.files); }}
      >
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
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files || []);
              if (files.length) { e.preventDefault(); void attachFiles(files); }
            }}
            placeholder={sessionId ? "Ask for follow-up changes…" : "What would you like to build?"}
            aria-label="Message Zcode"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); void send(); }
              if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                const i = modes.indexOf(mode);
                const next = modes[(i + 1 + modes.length) % modes.length] || modes[0] || mode;
                setMode(next);
                savePrefs({ mode: next });
              }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-left">
              <div className="composer-menu-wrap">
                <IconButton label="Attach a file" onClick={() => fileInput.current?.click()}><Plus size={17} /></IconButton>
              </div>
              <IconButton label="Mention a file" onClick={() => fileInput.current?.click()}><AtSign size={15} /></IconButton>
              <div className="composer-menu-wrap">
                <button className="mode-picker" onClick={() => setMenu(menu === "mode" ? null : "mode")}>
                  <ShieldCheck size={13} /><span>{mode}</span><ChevronDown size={11} />
                </button>
                {menu === "mode" && (
                  <div className="popover mode-popover">
                    <div className="popover-label">EXECUTION MODE <kbd>⇧ Tab</kbd></div>
                    {(modes.includes("plan") || modes.includes("build") ? [
                      { id: "plan", label: "Plan", description: "Think it through before building" },
                      { id: "build", label: "Build", description: "Make changes to project files" },
                      { id: "edit", label: "Edit", description: "Edit files with confirmation" },
                      { id: "yolo", label: "Yolo", description: "Run without asking (trusted repos)" },
                    ] : modes.map((m) => ({ id: m, label: m, description: "" }))).map((item) => (
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
              <button className="send-button" disabled={busy || uploading > 0 || (!input.trim() && !attachments.length)} aria-label="Send message" title="Send message (Enter)" onClick={() => void send()}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
              </button>
            </div>
          </div>
        </div>
        <div className="composer-hint">
          <span><kbd>↵</kbd> to send <span className="hint-dot">·</span> <kbd>shift ↵</kbd> for a new line</span>
          <span><span className={`tiny-dot ${run.streamAttached ? "green" : ""}`} />{run.streamAttached ? "stream live" : busy ? "reconnecting" : "idle"}</span>
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
    </section>
  );
}

function useStickyModel(models: ModelInfo[]) {
  const prefs = loadPrefs();
  return models.some((m) => m.ref === prefs.model) ? prefs.model : models.find((m) => m.isDefault)?.ref || models[0]?.ref || "";
}
void useStickyModel;


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
function FileCards({ files, onPreview }: { files: FileCard[]; onPreview: (f: FileCard) => void }) {
  return (
    <div className="file-cards">
      {files.map((f, i) => {
        const a = artifactArgs(f.url);
        const route = a ? artifactUrl(a) : null;
        const isImage = f.mime.startsWith("image/");
        const label = isImage ? f.mime.replace("image/", "").toUpperCase() : (f.mime === "application/pdf" ? "PDF" : f.mime.split("/").pop()?.toUpperCase() || "FILE");
        return (
          <button key={`${f.url}-${i}`} className={`file-card ${isImage ? "is-image" : ""}`} onClick={() => onPreview(f)} title="Preview attachment">
            {isImage && route ? <img src={route} alt="attached screenshot" loading="lazy" /> : <FileText size={12} />}
            <span>{label}{f.size ? ` · ${(f.size / 1024).toFixed(0)}KB` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

// Full-panel preview used by both pending attachments and transcript
// artifacts: images inline, PDFs in a sandboxed frame, text as scrollable
// preformatted content.
function PreviewOverlay({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label={`Preview ${preview.title}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="preview-panel-light">
        <header className="preview-light-header">
          <FileText size={13} />
          <strong>{preview.title}</strong>
          <span className="preview-light-hint">esc to close</span>
          <IconButton label="Close preview" onClick={onClose}><X size={15} /></IconButton>
        </header>
        {preview.kind === "image" && <img className="preview-light-image" src={preview.src} alt={preview.title} />}
        {preview.kind === "pdf" && <iframe className="preview-light-frame" src={preview.src} title={preview.title} />}
        {preview.kind === "text" && <pre className="preview-light-text"><code>{preview.text}</code></pre>}
      </div>
    </div>
  );
}
