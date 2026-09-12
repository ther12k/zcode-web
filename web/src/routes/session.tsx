// Session view: paginated logical transcript + composer continuing the session.
import { useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import type { SessionDetail, TranscriptTurn } from "../api/client";
import { ApiError } from "../api/client";
import { useWorkspace } from "../workspace";
import { ChatPanel } from "../components/ChatPanel";
import { Markdown } from "../components/Markdown";

const PAGE = 5;

export function SessionView() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const { client } = useWorkspace();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load(limit = PAGE, offset = 0, replace = true) {
    if (!sessionId) return;
    setLoading(true);
    try {
      const d = await client.session(sessionId, limit, offset);
      setDetail((prev) =>
        replace
          ? d
          : {
              ...prev!,
              transcript: [...d.transcript, ...(prev?.transcript || [])],
              total: d.total,
              hasMore: d.hasMore,
            }
      );
      setError(null);
    } catch (e) {
      // ZWUI-018: DB failures are real errors, shown as such
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    void load(PAGE, 0, true);
    bottomRef.current?.scrollIntoView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const turns: TranscriptTurn[] = detail?.transcript || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="transcript">
        <div className="messages" aria-live="polite">
          {detail?.hasMore && (
            <button
              className="ghost"
              onClick={() => void load(PAGE, turns.length, false)}
              disabled={loading}
            >
              Load earlier messages ({detail.total - turns.length} more)
            </button>
          )}
          {loading && !detail && <div className="empty">Loading…</div>}
          {error && <div className="error-text">{error}</div>}
          {!loading && !error && !turns.length && (
            <div className="empty">Session is empty — send a message to continue it.</div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role}`}>
              <div className="role">{t.role}</div>
              {t.text && (t.role === "assistant" ? <Markdown text={t.text} /> : <span>{t.text}</span>)}
              {(t.tools || []).map((tool, j) => (
                <div key={`t${j}`} className={`tool-card ${tool.status === "completed" ? "done" : tool.status}`}>
                  🔧 {tool.name} — {tool.status}
                  {tool.detail ? `: ${tool.detail.slice(0, 120)}` : ""}
                </div>
              ))}
              {(t.files || []).map((f, j) => (
                <div key={`f${j}`} className="artifact-card">
                  {(f.mime || "").startsWith("image/") ? "🖼" : "📄"} artifact · {f.mime}
                  {f.size ? ` · ${Math.ceil(f.size / 1024)} KB` : ""} · {f.storageKind}
                </div>
              ))}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <ChatPanel
        client={client}
        cwd={detail?.session.directory || ""}
        sessionKey={sessionId || "new"}
        sessionId={sessionId || null}
      />
    </div>
  );
}
