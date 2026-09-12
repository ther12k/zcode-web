// ZWUI-021: command palette (Ctrl/Cmd+K) — navigation + actions.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspace } from "../workspace";

type Command = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { client, caps } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [sessions, setSessions] = useState<{ id: string; title: string; directory: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    // recent sessions when no query; server-scoped search (ZWUI-029) when typing
    void (async () => {
      try {
        if (query.trim().length >= 2) {
          const r = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
            headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` },
          });
          const j = await r.json();
          if (alive) setSessions((j.results || []).slice(0, 20));
          return;
        }
        const all = await Promise.all(
          (caps?.allowedRoots || []).map(async (root) => {
            try {
              const r = await client.sessions(root);
              return r.sessions.slice(0, 10).map((s) => ({ ...s, directory: root }));
            } catch {
              return [];
            }
          })
        );
        if (alive) setSessions(all.flat().slice(0, 20));
      } catch {
        /* palette still works for commands */
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, caps, query]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: "settings", label: "Open settings & diagnostics", run: () => navigate({ to: "/settings" }) },
      { id: "new", label: "New chat (current workspace)", run: () => navigate({ to: "/w/$workspace", params: { workspace: "default" } }) },
    ];
    for (const root of caps?.allowedRoots || []) {
      const label = root.split("/").filter(Boolean).pop() || root;
      cmds.push({
        id: "ws:" + root,
        label: `Go to workspace ${label}`,
        hint: root,
        run: () => navigate({ to: "/w/$workspace", params: { workspace: label.toLowerCase() } }),
      });
    }
    const q = query.trim().toLowerCase();
    const sessionCmds: Command[] = sessions
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        label: `Session: ${s.title || s.id}`,
        hint: s.directory,
        run: () => {
          const ws = s.directory.split("/").filter(Boolean).pop()?.toLowerCase() || "default";
          navigate({ to: "/w/$workspace/s/$sessionId", params: { workspace: ws, sessionId: s.id } });
        },
      }));
    const filtered = cmds.filter((c) => !q || c.label.toLowerCase().includes(q));
    return [...filtered, ...sessionCmds];
  }, [query, sessions, caps, navigate]);

  return (
    <div
      className="overlay palette"
      role="dialog"
      aria-label="Command palette"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card">
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command or search sessions…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, commands.length - 1));
            if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
            if (e.key === "Enter") {
              commands[selected]?.run();
              onClose();
            }
          }}
        />
        <div className="results">
          {commands.map((c, i) => (
            <button
              key={c.id}
              className={`result ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              {c.label}
              {c.hint && (
                <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>
                  {c.hint}
                </span>
              )}
            </button>
          ))}
          {!commands.length && <div className="muted" style={{ padding: 8 }}>No matches</div>}
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
