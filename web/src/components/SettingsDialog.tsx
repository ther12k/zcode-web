// Settings dialog: readiness diagnostics + device-local session management.
import { useState } from "react";
import { useWorkspace } from "../workspace";
import { Dialog } from "../ui";

export function SettingsDialog({ caps, onClose, onLogout }: {
  caps: { runtime: string; cliPresent: boolean; providerConfigured: boolean; dbPresent: boolean; allowedRoots: string[]; modes: string[]; maxJobs: number } | null;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { client } = useWorkspace();
  const [ping, setPing] = useState<string | null>(null);

  async function pingServer() {
    try {
      const h = await client.health();
      setPing(`ok · cli ${h.cli.present ? "present" : "missing"} · db ${h.db.present ? "present" : "missing"} · jobs ${h.activeJobs}/${h.maxJobs}`);
    } catch (e) {
      setPing((e as Error).message);
    }
  }

  const rows: [string, string][] = caps
    ? [
        ["Runtime", caps.runtime],
        ["CLI bundle", caps.cliPresent ? "present" : "MISSING — jobs will fail"],
        ["Model provider", caps.providerConfigured ? "configured" : "not configured"],
        ["Session DB", caps.dbPresent ? "present" : "not found yet"],
        ["Allowed roots", caps.allowedRoots.join("  ·  ")],
        ["Modes", caps.modes.join(", ")],
        ["Max concurrent jobs", String(caps.maxJobs)],
      ]
    : [["Server", "unreachable"]];

  return (
    <Dialog title="Settings & diagnostics" subtitle="Readiness, capabilities and session state" onClose={onClose} wide>
      <table className="settings-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button onClick={() => void pingServer()}>Ping server</button>
        {ping && <span className="muted">{ping}</span>}
        <span style={{ flex: 1 }} />
        <button className="danger-text" onClick={onLogout}>Sign out</button>
        <button className="primary-button" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}
