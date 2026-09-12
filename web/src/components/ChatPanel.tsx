// ChatPanel: the composer (ZWUI-013) + run streaming (ZWUI-016/017) +
// attachment uploads (ZWUI-014). This is the live surface — for an existing
// session it appends the live run below the paginated history.
import { useEffect, useReducer, useRef, useState } from "react";
import { randomUUID } from "../lib/uuid";
import { ApiError, type ApiClient } from "../api/client";
import { runReducer, initialRun, isTerminal } from "../state/run";
import { StreamController } from "../state/stream";
import { loadDraft, saveDraft, loadPrefs } from "../state/prefs";
import { Markdown } from "./Markdown";

type Attachment = { name: string; size: number; path?: string; failed?: string; file?: File };

export function ChatPanel({
  client,
  cwd,
  sessionKey,
  sessionId,
  emptyHint,
}: {
  client: ApiClient;
  cwd: string;
  sessionKey: string;
  sessionId: string | null;
  emptyHint?: string;
}) {
  const [run, dispatch] = useReducer(runReducer, undefined, initialRun);
  const [draft, setDraft] = useState(loadDraft(sessionKey));
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const esRef = useRef<StreamController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prefs = loadPrefs();

  // isolated drafts (ZWUI-012)
  useEffect(() => {
    setDraft(loadDraft(sessionKey));
  }, [sessionKey]);
  useEffect(() => {
    const t = setTimeout(() => saveDraft(sessionKey, draft), 250);
    return () => clearTimeout(t);
  }, [draft, sessionKey]);

  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [run.answer, run.reasoning, run.activity]);

  async function uploadFiles(list: Attachment[]): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const att of list) {
      const f = att.file;
      if (!f) { out.push(att); continue; }
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.onerror = () => reject(new Error("read failed"));
          r.readAsDataURL(f);
        });
        const saved = await client.upload(f.name, data);
        out.push({ name: saved.name, size: saved.size, path: saved.path });
      } catch (e) {
        out.push({ name: f.name, size: f.size, failed: (e as Error).message });
      }
    }
    return out;
  }

  async function submit() {
    if (run.phase !== "idle" && !isTerminal(run.phase)) return;
    const text = draft.trim();
    if (!text && !files.length) return;

    const requestId = randomUUID();
    dispatch({ type: "submit", requestId });

    try {
      let attachmentPaths: string[] = [];
      if (files.length) {
        setUploading(true);
        const uploaded = await uploadFiles(files);
        setUploading(false);
        attachmentPaths = uploaded.filter((u) => u.path).map((u) => u.path!);
        if (uploaded.some((u) => u.failed)) {
          dispatch({ type: "submit-failed", error: "upload failed: " + uploaded.find((u) => u.failed)!.failed });
          return;
        }
      }
      const accepted = await client.chat({
        text,
        sessionId,
        cwd,
        mode: prefs.mode || "plan",
        model: prefs.model || undefined,
        attachments: attachmentPaths,
        requestId,
      });
      dispatch({ type: "accepted", jobId: accepted.jobId, sessionId: accepted.sessionId, replayed: accepted.replayed });
      saveDraft(sessionKey, "");

      // attach the stream (ZWUI-017): disconnect never finalizes the run —
      // the reducer finalizes only on done/timeout or a terminal job-status.
      const controller = new StreamController(client, accepted.jobId, {
        onEvents: (events) => dispatch({ type: "events", events }),
        onAttached: () => dispatch({ type: "stream-attached" }),
        onDetached: () => dispatch({ type: "stream-detached" }),
        onFatal: (message) => dispatch({ type: "submit-failed", error: message }),
      });
      esRef.current?.close();
      esRef.current = controller;
      controller.start();

      // background reconciliation: if the stream is lost, job status still
      // finalizes the run truthfully
      const poll = setInterval(async () => {
        if (isTerminal(run.phase)) {
          clearInterval(poll);
          return;
        }
        try {
          const st = await client.job(accepted.jobId);
          dispatch({ type: "job-status", status: st.status as never, timedOut: st.timedOut });
          if (["succeeded", "failed", "cancelled", "timeout"].includes(st.status)) clearInterval(poll);
        } catch {
          /* transient */
        }
      }, 5000);
      setTimeout(() => clearInterval(poll), config_jobTimeoutMs());
    } catch (e) {
      dispatch({
        type: "submit-failed",
        error: e instanceof ApiError ? e.message : String(e),
      });
    }
  }

  const busy = run.phase !== "idle" && !isTerminal(run.phase);
  const showEmpty = emptyHint && run.phase === "idle" && !run.answer;

  return (
    <div className="composer">
      {showEmpty && <div className="empty" style={{ marginTop: 0 }}>{emptyHint}</div>}
      <div className="activity" role="status" aria-live="polite">
        {run.error ? <span className="error">{run.activity || run.error}</span> : run.activity}
        {run.phase !== "idle" && (
          <span className="muted"> · {run.phase}{run.streamAttached ? "" : " (stream detached — reconnecting)"}</span>
        )}
        {uploading && <span> · uploading…</span>}
      </div>
      {run.reasoning && (
        <details className="reasoning" open={false}>
          <summary>thinking</summary>
          <div className="reasoning-body">{run.reasoning}</div>
        </details>
      )}
      {run.answer && (
        <div className="msg assistant">
          <div className="role">assistant</div>
          <div className="answer">
            <Markdown text={run.answer} />
          </div>
        </div>
      )}
      {files.length > 0 && (
        <div style={{ margin: "6px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {files.map((f, i) => (
            <span key={i} className="attach-chip" title={f.failed || String(f.size) + " bytes"}>
              {f.failed ? "⚠ " : "📎 "}
              {f.name} ✕
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button
          aria-label="Attach files"
          title="Attach files"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.onchange = () => {
              setFiles((prev) => [
                ...prev,
                ...Array.from(input.files || []).map((f) => ({ name: f.name, size: f.size, file: f })),
              ]);
            };
            input.click();
          }}
        >
          📎
        </button>
        <textarea
          aria-label="Ask zcode"
          placeholder="Ask zcode… (Enter to send, Shift+Enter for newline)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {busy ? (
          <button
            className="danger"
            onClick={async () => {
              if (run.jobId) await client.cancel(run.jobId);
            }}
          >
            Stop
          </button>
        ) : (
          <button className="primary" onClick={() => void submit()} disabled={!draft.trim() && !files.length}>
            Send
          </button>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function config_jobTimeoutMs() {
  // poll window: server default job timeout + slack
  return 16 * 60_000;
}
