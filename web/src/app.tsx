// App shell: header (project picker, model/mode, status dot, palette trigger),
// sidebar (sessions), main outlet, inspector — ZWUI-009 responsive shell.

import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace";
import { SessionList } from "./components/SessionList";
import { CommandPalette } from "./components/CommandPalette";

export function App() {
  const { caps, token, setToken, prefs } = useWorkspace();
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
        <select
          aria-label="Project directory (cwd)"
          value={params.workspace ? `w/${params.workspace}` : ""}
          onChange={(e) => {
            const v = e.target.value; // e.g. "w/default" | "w2/home%2F..."
            navigate({ to: `/${v}` });
          }}
        >
          {(caps?.allowedRoots || []).flatMap((root) =>
            safeList(root).map((p) => (
              <option key={p.path} value={p.routeValue}>
                {p.label}
              </option>
            ))
          )}
        </select>
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
        <button className="ghost" onClick={() => navigate({ to: "/settings" })}>
          Settings & diagnostics
        </button>
        {prefs.mode && <div className="muted">mode: {prefs.mode}</div>}
      </aside>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

// project options: enumerate root dirs client-side from caps; deep listing is
// /api/projects' job — kept in sync by the picker issue (ZWUI-010).
function safeList(root: string): { path: string; label: string; routeValue: string }[] {
  // routeValue encodes a workspace alias; real enumeration lands with ZWUI-010.
  const label = root.split("/").filter(Boolean).pop() || root;
  return [{ path: root, label, routeValue: root === "/" ? "default" : label.toLowerCase() }];
}
