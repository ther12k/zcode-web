// Settings dialog — reference structure: settings-tabs + settings-body with
// provider/environment sections (adapted to our real capabilities).
import { useState } from "react";
import { Check, LoaderCircle, LockKeyhole, ArrowUpRight, Database, FolderClosed } from "lucide-react";
import { Dialog, ZLogo } from "../ui";

type Caps = {
  runtime: string; cliPresent: boolean; providerConfigured: boolean; dbPresent: boolean;
  allowedRoots: string[]; modes: string[]; maxJobs: number;
};

export function SettingsDialog({ caps, onClose, onLogout }: {
  caps: Caps | null;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<"workspace" | "provider">("workspace");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="Make yourself at home." subtitle="Your workspace, your way." onClose={onClose} wide>
      <div className="settings-tabs">
        {([["workspace", "Workspace"], ["provider", "AI provider"]] as const).map(([id, title]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{title}</button>
        ))}
      </div>
      <div className="dialog-body settings-body">
        {tab === "workspace" && caps && (
          <>
            <div className="settings-section-heading">
              <h3>Where things stand.</h3>
              <p>Live readiness of this deployment.</p>
            </div>
            <div className="tool-row">
              <span className="tool-icon sage"><FolderClosed size={21} /></span>
              <div><h3>Workspace roots</h3><p>{caps.allowedRoots.join(" · ")}</p></div>
              <span className="connection-badge connected"><Check size={11} />{caps.allowedRoots.length} roots</span>
            </div>
            <div className="tool-row">
              <span className="tool-icon blue"><Database size={21} /></span>
              <div><h3>Session history</h3><p>Read from the CLI's own SQLite store ({caps.runtime} runtime).</p></div>
              <span className={`connection-badge ${caps.dbPresent ? "connected" : ""}`}><span className="tiny-dot" />{caps.dbPresent ? "Synced" : "Not found"}</span>
            </div>
            <div className="settings-info">
              <LockKeyhole size={18} />
              <div>
                <strong>Private by default</strong>
                <p>Sessions live on your machine in the CLI's database. The web layer reads them read-only; your token never leaves the browser except to this server.</p>
              </div>
            </div>
          </>
        )}
        {tab === "provider" && (
          <>
            <div className="provider-card">
              <div className="provider-icon"><ZLogo size={27} /></div>
              <div><h3>Z.AI</h3><p>GLM models, made for building.</p></div>
              <span className={`connection-badge ${caps?.providerConfigured ? "connected" : ""}`}>
                <span className="tiny-dot" />{caps?.providerConfigured ? "API enabled" : "Demo mode"}
              </span>
            </div>
            <div className="provider-description">
              <h3>{caps?.providerConfigured ? "You're ready to build with GLM." : "No provider configured."}</h3>
              <p>{caps?.providerConfigured
                ? "Your server-side Z.AI configuration is enabled. Choose a model in the conversation composer to start a task."
                : "Set up a provider with an API key in ~/.zcode/cli/config.json (scripts/setup-host.sh can derive it from the desktop app), then refresh this workspace."}</p>
              {!caps?.providerConfigured && (
                <div className="environment-note">
                  <span>TO ENABLE LIVE AI</span>
                  <p>Run <code>scripts/setup-host.sh</code> on the host, or add a provider entry with an <code>apiKey</code> to the CLI config.</p>
                  <small><LockKeyhole size={11} />Your API key is never sent to the browser.</small>
                </div>
              )}
            </div>
            <div className="provider-bottom">
              <a href="https://docs.z.ai/guides/llm/glm-5.3" target="_blank" rel="noopener noreferrer">Provider documentation <ArrowUpRight size={13} /></a>
              <button className="secondary-button" disabled={busy} onClick={() => { setBusy(true); setTimeout(() => { setBusy(false); location.reload(); }, 400); }}>
                {busy && <LoaderCircle size={12} className="spin" />}Refresh connection
              </button>
            </div>
          </>
        )}
      </div>
      <footer className="dialog-footer">
        <button className="danger-button" onClick={onLogout}>Sign out</button>
        <span style={{ flex: 1 }} />
        <button className="primary-button" onClick={onClose}><Check size={13} />Done</button>
      </footer>
    </Dialog>
  );
}
