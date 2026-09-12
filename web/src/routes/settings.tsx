// Settings & diagnostics: readiness states + device-local preferences (ZWUI-022).
import { useNavigate } from "@tanstack/react-router";
import { useWorkspace } from "../workspace";

export function SettingsView() {
  const { client, caps, prefs, updatePrefs, logout } = useWorkspace();
  const navigate = useNavigate();

  const rows: [string, string][] = caps
    ? [
        ["Runtime", caps.runtime],
        ["CLI bundle", caps.cliPresent ? "present" : "MISSING (jobs will fail)"],
        ["Model provider", caps.providerConfigured ? "configured" : "NOT configured"],
        ["Session DB", caps.dbPresent ? "present" : "not found yet"],
        ["Workspace roots", caps.allowedRoots.join("  ·  ")],
        ["Permission modes", caps.modes.join(", ")],
        ["Max concurrent jobs", String(caps.maxJobs)],
      ]
    : [["Server", "unreachable"]];

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ fontSize: "var(--fs-xl)" }}>Settings & diagnostics</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "6px 12px 6px 0", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{k}</td>
              <td style={{ padding: 6 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: "var(--fs-lg)" }}>Preferences (device-local)</h3>
      <label style={{ display: "block", margin: "8px 0" }}>
        Default permission mode
        <select
          style={{ marginLeft: 8 }}
          value={prefs.mode}
          onChange={(e) => updatePrefs({ mode: e.target.value })}
        >
          {(caps?.modes || ["plan"]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
        <button onClick={() => navigate({ to: "/w/$workspace", params: { workspace: "default" } })}>Back to workspace</button>
        <button className="danger" onClick={logout}>
          Sign out (clear token)
        </button>
        <button
          className="ghost"
          onClick={() => void client.health()}
          title="Re-check server health"
        >
          Ping server
        </button>
      </div>
    </div>
  );
}
