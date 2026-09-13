// ChatPanel ported to the reference design: context strip, messages-scroll
// with byline blocks, thinking + tool evidence, bottom composer with
// mode/model pickers, live-run "working" message. Run state comes from the
// ZWUI-016 reducer; transport from the ZWUI-017 controller.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowUp, AtSign, Brain, Check, ChevronDown, ChevronRight, Clock3, FileText, LoaderCircle, MessageSquare, Plus, ShieldCheck, Sparkles, SquarePen, Terminal, Wrench, X } from "lucide-react";
import { ZLogo, IconButton, Markdown, CheckMark } from "../ui";
import { randomUUID } from "../lib/uuid";
import { ApiError, type ApiClient, type ModelInfo, type TranscriptTurn } from "../api/client";
import { runReducer, initialRun, isTerminal, type StoredEvent } from "../state/run";
import { StreamController } from "../state/stream";
import { loadDraft, saveDraft, loadPrefs, savePrefs } from "../state/prefs";

export function ChatPanel({
  client, cwd, sessionId, modes, defaultMode, onNotify,
}: {
  client: ApiClient;
  cwd: string;
  sessionId: string | null;
  modes: string[];
  defaultMode: string;
  onNotify: (text: string, type?: "success" | "error") => void;
}) {
  const draftKey = `${cwd}::${sessionId || "new"}`;
  const [run, dispatch] = useReducer(runReducer, undefined, initialRun);
  const [input, setInput] = useState(loadDraft(draftKey));
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mode, setMode] = useState(defaultMode);
  const [model, setModel] = useState("");
  const [menu, setMenu] = useState<"mode" | "model" | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; path: string } | undefined>();
  const [history, setHistory] = useState<{ turns: TranscriptTurn[]; total: number; hasMore: boolean }>({ turns: [], total: 0, hasMore: false });
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
        const saved = loadPrefs().model;
        setModel((cur) => cur || (r.models.some((m) => m.ref === saved) ? saved : (r.models.find((m) => m.isDefault) || r.models[0])?.ref || ""));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  // load transcript for an existing session
  useEffect(() => {
    let alive = true;
    if (!sessionId) { setHistory({ turns: [], total: 0, hasMore: false }); return; }
    void client.session(sessionId, 10, 0)
      .then((d) => { if (alive) setHistory({ turns: d.transcript, total: d.total, hasMore: d.hasMore }); })
      .catch((e) => { if (alive) onNotify(e instanceof ApiError ? e.message : String(e), "error"); });
    return () => { alive = false; };
  }, [sessionId, client]);

  useEffect(() => {
    if (lastKey.current !== draftKey) { setInput(loadDraft(draftKey)); setAttachment(undefined); setMenu(null); lastKey.current = draftKey; }
  }, [draftKey]);
  useEffect(() => {
    const t = setTimeout(() => saveDraft(draftKey, input), 250);
    return () => clearTimeout(t);
  }, [input, draftKey]);
  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => {
    requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight }));
  }, [run.answer, run.activity, history.turns.length]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".composer-menu-wrap")) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const busy = run.phase !== "idle" && !isTerminal(run.phase);

  const attachFile = useCallback(async (file: File) => {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] || "");
        r.onerror = () => reject(new Error("could not read file"));
        r.readAsDataURL(file);
      });
      const saved = await client.upload(file.name, data);
      setAttachment({ name: saved.name, path: saved.path });
    } catch (e) {
      onNotify((e as Error).message, "error");
    }
  }, [client, onNotify]);

  const send = useCallback(async () => {
    if (busy) return;
    const text = input.trim();
    if (!text && !attachment) return;
    const requestId = randomUUID();
    dispatch({ type: "submit", requestId });
    try {
      let attachmentPath: string | undefined;
      if (attachment) attachmentPath = attachment.path;
      const accepted = await client.chat({
        text: text || "Analyze the attached file(s).",
        sessionId, cwd, mode, model: model || undefined,
        attachments: attachmentPath ? [attachmentPath] : undefined,
        requestId,
      });
      dispatch({ type: "accepted", jobId: accepted.jobId, sessionId: accepted.sessionId ?? sessionId });
      setInput(""); setAttachment(undefined);
      const controller = new StreamController(client, accepted.jobId, {
        onEvents: (events: StoredEvent[]) => dispatch({ type: "events", events }),
        onAttached: () => dispatch({ type: "stream-attached" }),
        onDetached: () => dispatch({ type: "stream-detached" }),
        onFatal: (message) => dispatch({ type: "submit-failed", error: message }),
      });
      esRef.current?.close();
      esRef.current = controller;
      controller.start();
      // reconciliation poll: finalizes truthfully if the stream dies
      const poll = setInterval(async () => {
        try {
          const st = await client.job(accepted.jobId);
          dispatch({ type: "job-status", status: st.status as never });
          if (["succeeded", "failed", "cancelled", "timeout"].includes(st.status)) clearInterval(poll);
        } catch { /* transient */ }
      }, 5000);
      setTimeout(() => clearInterval(poll), 17 * 60_000);
    } catch (e) {
      dispatch({ type: "submit-failed", error: e instanceof ApiError ? e.message : String(e) });
    }
  }, [busy, input, attachment, client, sessionId, cwd, mode, model]);

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
        <span title={cwd}><span className="project-dot" /><span>{cwd.split("/").filter(Boolean).pop()}</span></span>
        <button className="details-toggle" title={run.reasoning ? "Reasoning captured this run" : "No reasoning captured yet"}>
          <Brain size={12} /><span>{run.reasoning ? `${run.reasoning.length} chars thinking` : "No thinking yet"}</span>
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
                <button key={text} onClick={() => { setInput(text); textarea.current?.focus(); }}><Sparkles size={13} />{text}</button>
              ))}
            </div>
          </div>
        )}

        {history.turns.map((t, i) => (
          t.role === "user" ? (
            <article className="user-message-block" key={`h${i}`}>
              <div className="message-byline"><span className="user-avatar">Y</span><strong>You</strong></div>
              <div className="user-message">{t.text}</div>
            </article>
          ) : (
            <article className="agent-message" key={`h${i}`}>
              <div className="agent-byline"><span className="agent-avatar"><ZLogo size={18} /></span><strong>Zcode</strong></div>
              {(t.tools || []).length > 0 && (
                <div className="activity-stack">
                  {(t.tools || []).map((tool, j) => (
                    <ToolActivity key={j} name={tool.name} status={tool.status} detail={tool.detail} />
                  ))}
                </div>
              )}
              {t.text.startsWith("⚠") ? <div className="danger-text">{t.text}</div> : <Markdown text={t.text} />}
            </article>
          )
        ))}

        {(run.answer || run.reasoning || busy || run.error) && (
          <article className="agent-message">
            <div className="agent-byline">
              <span className="agent-avatar"><ZLogo size={18} /></span><strong>Zcode</strong>
              <span className="agent-model">{(models.find((m) => m.ref === model)?.model || "GLM").toUpperCase()}</span>
              {run.phase !== "idle" && <span className="message-duration"><Clock3 size={11} />{run.phase}</span>}
            </div>
            {run.reasoning && (
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
              <div className="message-footer"><span className="task-completed"><CheckMark />Task completed</span></div>
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

      <div className="composer-shell">
        <div className={`composer ${busy ? "composer-working" : ""}`}>
          {attachment && (
            <div className="attached-file"><FileText size={12} /><span>{attachment.name}</span><IconButton label="Remove attachment" onClick={() => setAttachment(undefined)}><X size={11} /></IconButton></div>
          )}
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={sessionId ? "Ask for follow-up changes…" : "What would you like to build?"}
            aria-label="Message Zcode"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); void send(); }
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
                    <div className="popover-label">EXECUTION MODE</div>
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
                  <Sparkles size={12} /><span>{(models.find((m) => m.ref === model)?.model || "model").toUpperCase()}</span><ChevronDown size={11} />
                </button>
                {menu === "model" && (
                  <div className="popover model-popover">
                    <div className="popover-label">SELECT MODEL</div>
                    {models.map((m) => (
                      <button key={m.ref} onClick={() => { setModel(m.ref); savePrefs({ model: m.ref }); setMenu(null); }}>
                        <Sparkles size={15} /><span><b>{m.model.toUpperCase()}</b><small>{m.providerName}</small></span>
                        {model === m.ref && <Check size={13} className="success-text" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="send-button" disabled={busy || (!input.trim() && !attachment)} aria-label="Send message" title="Send message (Enter)" onClick={() => void send()}>
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
        aria-label="Attach a file"
        className="visually-hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await attachFile(file);
          e.target.value = "";
        }}
      />
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
