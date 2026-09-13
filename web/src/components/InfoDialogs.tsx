// Reference-style utility dialogs: keyboard shortcuts and workspace tools.
import { useEffect, useRef } from "react";
import { BookOpen, Check, Database, FileCode2, FolderClosed, Globe, ShieldCheck, TerminalSquare } from "lucide-react";
import type { AppConfig } from "../api/client";

type ToolsCaps = Pick<AppConfig, "allowedRoots" | "cliPresent" | "providerConfigured">;

function DialogShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    }, 30);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", onKey); previouslyFocused?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="dialog-header">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    { label: "Find a session", keys: ["⌘ / Ctrl", "K"] },
    { label: "Start a new chat", keys: ["⌘ / Ctrl", "N"] },
    { label: "Toggle the sidebar", keys: ["⌘ / Ctrl", "B"] },
    { label: "Toggle the preview panel", keys: ["⌘ / Ctrl", "J"] },
    { label: "Cycle execution mode", keys: ["Shift", "Tab"] },
    { label: "A new line in your message", keys: ["Shift", "↵"] },
    { label: "Close a dialog", keys: ["Esc"] },
  ];
  return (
    <DialogShell title="Less clicking. More creating." subtitle="A few shortcuts for staying in your flow." onClose={onClose}>
      <div className="dialog-body">
        <div className="shortcut-list">
          {rows.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <span>{item.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
            </div>
          ))}
        </div>
        <a className="help-link" href="https://zcode.z.ai/en/docs" target="_blank" rel="noopener noreferrer">
          <BookOpen size={17} />
          <span><strong>Explore the original Zcode docs</strong><small>Learn about the app that inspired this workspace.</small></span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </DialogShell>
  );
}

export function ToolsDialog({ caps, onClose }: { caps: ToolsCaps; onClose: () => void }) {
  const rows = [
    {
      icon: <FolderClosed size={21} />, tone: "",
      title: "Workspace roots",
      body: caps.allowedRoots.length
        ? `Sessions run inside ${caps.allowedRoots.length} allowed root${caps.allowedRoots.length === 1 ? "" : "s"} on this machine.`
        : "No workspace roots are configured on the server.",
      badge: <span className="connection-badge">{caps.allowedRoots.length} root{caps.allowedRoots.length === 1 ? "" : "s"}</span>,
    },
    {
      icon: <FileCode2 size={21} />, tone: "sage",
      title: "Inspector panel",
      body: "Preview, code and working-tree changes for the active project, straight from the CLI's workspace.",
      badge: <span className="connection-badge">Read-only</span>,
    },
    {
      icon: <TerminalSquare size={21} />, tone: "violet",
      title: "Agent runtime",
      body: caps.cliPresent
        ? "The ZCode CLI runs sessions headlessly with streaming output."
        : "The ZCode CLI was not found on the server.",
      badge: <span className={`connection-badge ${caps.cliPresent ? "connected" : ""}`}>{caps.cliPresent ? <Check size={11} /> : null}{caps.cliPresent ? "Ready" : "Missing"}</span>,
    },
    {
      icon: <Database size={21} />, tone: "orange",
      title: "Session storage",
      body: "Sessions, messages and attachments come from the CLI's own SQLite database — nothing is duplicated.",
      badge: <span className="connection-badge connected"><Check size={11} />Synced</span>,
    },
    {
      icon: <Globe size={21} />, tone: "blue",
      title: "Z.AI models",
      body: caps.providerConfigured
        ? "Providers are configured; pick a model in the composer to start a task."
        : "No provider is configured on the server yet.",
      badge: <span className={`connection-badge ${caps.providerConfigured ? "connected" : ""}`}><span className="tiny-dot" />{caps.providerConfigured ? "API enabled" : "Not configured"}</span>,
    },
  ];
  return (
    <DialogShell title="Everything, in its place." subtitle="The tools available inside your web workspace." onClose={onClose}>
      <div className="dialog-body tools-list">
        {rows.map((row) => (
          <div className="tool-row" key={row.title}>
            <span className={`tool-icon ${row.tone}`}>{row.icon}</span>
            <div><h3>{row.title}</h3><p>{row.body}</p></div>
            {row.badge}
          </div>
        ))}
        <div className="tools-safety">
          <ShieldCheck size={16} />
          <p>Tools operate only inside the allowed workspace roots. Nothing else on this machine is exposed.</p>
        </div>
      </div>
    </DialogShell>
  );
}
