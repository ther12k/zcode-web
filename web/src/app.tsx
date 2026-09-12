// App shell: header (project picker, model/mode, status dot, palette trigger),
// sidebar (sessions), main outlet, inspector — ZWUI-009 responsive shell.

import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace";
import { SessionList } from "./components/SessionList";
import { CommandPalette } from "./components/CommandPalette";
import { ProjectPicker } from "./components/ProjectPicker";
import { ActivityInspector } from "./components/ActivityInspector";
import { WorkspaceInspector } from "./components/WorkspaceInspector";

export function App() {
  const { caps, token, setToken, prefs } = useWorkspace();
  const cwd = prefs.rootPath || caps?.allowedRoots[0] || "";
  const params = useParams({ strict: false }) as { workspace?: string };
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needsToken = caps?.authRequired && !token;

  return (
    <div className="shell">
      <header className="header">
        <span className="brand">
          zcode<span className="accent">-web</span>
        </span>
        <ProjectPicker />
        <button onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)">
          ⌘K
        </button>
        <span style={{ flex: 1 }} />
        <span
          className={`dot ${caps ? "on" : "off"}`}
          title={caps ? "server reachable" : "server unreachable"}
        />
      </header>

      <aside className="sidebar">
        <button
          className="primary"
          onClick={() => {
            const ws = params.workspace || "default";
            navigate({ to: "/w/$workspace", params: { workspace: ws } });
          }}
        >
          New chat
        </button>
        <div className="muted" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: 1 }}>
          Sessions
        </div>
        {params.workspace && <SessionList workspace={params.workspace} />}
      </aside>

      <main className="main">
        {needsToken ? (
          <div className="overlay">
            <div className="card">
              <strong>Access token required</strong>
              <input
                ref={inputRef}
                type="password"
                placeholder="ZCODE_WEB_TOKEN"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setToken(tokenDraft.trim());
                }}
              />
              <button className="primary" onClick={() => setToken(tokenDraft.trim())}>
                Continue
              </button>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <aside className="inspector">
        <div className="muted" style={{ marginBottom: 8 }}>
          {caps
            ? `${caps.runtime} · jobs ${caps.maxJobs} · cli ${caps.cliPresent ? "ok" : "missing"}`
            : "connecting…"}
        </div>
        <ActivityInspector />
        {cwd && <WorkspaceInspector cwd={cwd} />}
        <button className="ghost" onClick={() => navigate({ to: "/settings" })}>
          Settings & diagnostics
        </button>
        {prefs.mode && <div className="muted">mode: {prefs.mode}</div>}
      </aside>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

