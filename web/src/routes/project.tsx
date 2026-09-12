// Project view: the composer for a new chat within a workspace (ZWUI-010/013).
import { useParams } from "@tanstack/react-router";
import { useWorkspace } from "../workspace";
import { ChatPanel } from "../components/ChatPanel";

export function ProjectView() {
  const { workspace = "default" } = useParams({ strict: false }) as { workspace?: string };
  const { client, caps } = useWorkspace();
  // resolve workspace alias → first allowed root containing it; full picker
  // flow is ZWUI-010's concern, this keeps the route honest meanwhile.
  const root =
    caps?.allowedRoots.find((r) => r.toLowerCase().endsWith("/" + workspace)) ||
    caps?.allowedRoots[0] ||
    "";

  return (
    <ChatPanel
      client={client}
      cwd={root}
      sessionKey={`new:${workspace}`}
      sessionId={null}
      emptyHint="New session — it will be created in this project on your first message."
    />
  );
}
