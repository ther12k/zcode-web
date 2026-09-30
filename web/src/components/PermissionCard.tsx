// Held-permission card: an agent tool call the session MODE did not
// pre-approve, escalated to the human mid-turn. The card renders from stream
// lines (permission.request / permission.resolved), so live viewers and
// reloaded viewers (replay) see the same state; picking an option POSTs the
// answer, and the server echoes that option's response to the CLI.

import { useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { ApiClient, PermissionRequestLine, PermissionResolvedLine } from "../api/client";

const RISK_CLASS: Record<string, string> = {
  low: "perm-risk-low",
  medium: "perm-risk-medium",
  high: "perm-risk-high",
  critical: "perm-risk-critical",
};

function isAllowKind(kind: string) {
  return kind === "allow" || kind === "allow_always";
}

export function PermissionCard({
  client,
  sessionId,
  request,
  resolution,
  onNotify,
}: {
  client: ApiClient;
  sessionId: string | null;
  request: PermissionRequestLine;
  resolution: PermissionResolvedLine | null;
  onNotify: (text: string, type?: "success" | "error") => void;
}) {
  const [answering, setAnswering] = useState<string | null>(null);

  const pick = async (optionId: string) => {
    if (!sessionId || answering || resolution) return;
    setAnswering(optionId);
    try {
      await client.resolveSessionPermission(sessionId, request.requestId, optionId);
      // the permission.resolved line arrives on the stream and flips the
      // card; nothing to do here on success
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Answering the permission failed.", "error");
      setAnswering(null);
    }
  };

  const resolved = !!resolution;
  const denied = resolution?.decision === "deny";

  return (
    <section className={`perm-card${resolved ? " perm-card-resolved" : ""}`} data-request-id={request.requestId}>
      <header className="perm-head">
        <span className="perm-head-icon">
          {resolved ? (denied ? <ShieldX size={14} /> : <ShieldCheck size={14} />) : <ShieldAlert size={14} />}
        </span>
        <span className="perm-title">{request.toolName}</span>
        <span className={`perm-risk ${RISK_CLASS[request.riskLevel] || RISK_CLASS.medium}`}>{request.riskLevel}</span>
        {!resolved && <span className="perm-waiting">waiting for your answer</span>}
        {resolved && (
          <span className={`perm-verdict ${denied ? "perm-verdict-deny" : "perm-verdict-allow"}`}>
            {denied ? "Denied" : "Allowed"}
            {resolution?.via && resolution.via !== "user" ? ` · ${resolution.via}` : ""}
          </span>
        )}
      </header>
      {request.reason && <p className="perm-reason">{request.reason}</p>}
      {request.preview.command && <pre className="perm-command">{request.preview.command}</pre>}
      {request.preview.filePaths.length > 0 && (
        <ul className="perm-paths">
          {request.preview.filePaths.map((p) => (
            <li key={p} title={p}>{p}</li>
          ))}
        </ul>
      )}
      {request.preview.fileChanges.length > 0 && (
        <ul className="perm-changes">
          {request.preview.fileChanges.map((c) => (
            <li key={`${c.type}:${c.path}`}>
              <span className={`perm-change-kind perm-change-${c.type}`}>{c.type}</span>
              <span className="perm-change-path" title={c.path}>{c.path}</span>
            </li>
          ))}
        </ul>
      )}
      {!resolved ? (
        <div className="perm-options" role="group" aria-label={`Permission for ${request.toolName}`}>
          {request.options.map((o) => (
            <button
              key={o.optionId}
              type="button"
              className={`perm-option ${isAllowKind(o.kind) ? "perm-option-allow" : o.kind === "deny" ? "perm-option-deny" : ""}`}
              title={o.description || o.name}
              disabled={!!answering}
              onClick={() => void pick(o.optionId)}
            >
              {answering === o.optionId ? "answering…" : o.name}
            </button>
          ))}
        </div>
      ) : resolution?.optionId ? (
        <footer className="perm-picked">answered: {request.options.find((o) => o.optionId === resolution.optionId)?.name || resolution.optionId}</footer>
      ) : null}
    </section>
  );
}
