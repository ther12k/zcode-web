// Reference-style utility dialogs: keyboard shortcuts, workspace tools,
// and the skills launcher backed by the CLI's real skill registry.
import { useMemo, useRef, useState } from "react";
import { BookOpen, Check, Database, FileCode2, FolderClosed, Globe, Search, ShieldCheck, Sparkles, TerminalSquare, WandSparkles } from "lucide-react";
import type { AppConfig, SkillInfo } from "../api/client";
import { useDialogA11y } from "../ui";

type ToolsCaps = Pick<AppConfig, "allowedRoots" | "cliPresent" | "providerConfigured">;

const TONES = ["sage", "violet", "blue", "orange"];
function toneFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

function DialogShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
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
    { label: "Toggle the sidebar", keys: ["⌘ / Ctrl", "B"] },
    { label: "Toggle the preview panel", keys: ["⌘ / Ctrl", "J"] },
    { label: "Send your message", keys: ["↵"] },
    { label: "A new line in your message", keys: ["Shift", "↵"] },
    { label: "Browse slash commands", keys: ["/"] },
    { label: "Queue a follow-up while working", keys: ["↵"] },
    { label: "Interrupt the running turn", keys: ["Esc"] },
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

export function SkillsDialog({ skills, loading, error, onSelect, onClose }: {
  skills: SkillInfo[];
  loading: boolean;
  error: string | null;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
  }, [skills, query]);
  return (
    <DialogShell title="A little expertise, on demand." subtitle="Your real ZCode skills — reusable prompts to get you into your flow." onClose={onClose}>
      <div className="dialog-body">
        <div className="search-field">
          <Search size={15} />
          <input aria-label="Search skills" placeholder="Find a skill…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        {loading && <p className="empty-search">Listing your skills…</p>}
        {error && <p className="empty-search danger-text">{error}</p>}
        <div className="skill-grid">
          {filtered.map((s) => (
            <button className="skill-card" key={s.name + s.scope} onClick={() => onSelect(s.name)} title={s.description}>
              <span className={`skill-icon ${toneFor(s.name)}`}><WandSparkles size={21} /></span>
              <span className="skill-tag">{(s.scope || "skill").toUpperCase()}</span>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <span className="skill-action">Use skill <Sparkles size={13} /></span>
            </button>
          ))}
        </div>
        {!loading && !filtered.length && !error && <p className="empty-search">No skills match that search.</p>}
      </div>
    </DialogShell>
  );
}
