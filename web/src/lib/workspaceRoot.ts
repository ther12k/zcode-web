// ZWUI-010 helper: workspace alias → absolute cwd.
// Aliases are the last path segment lowercased (matches App shell picker).
import type { Capabilities } from "../auth/bootstrap";

export function discoverWorkspaceRoot(_alias: string): string {
  // stored prefs carry the resolved root when set via the picker
  try {
    const raw = localStorage.getItem("zcode-web-prefs");
    if (raw) {
      const prefs = JSON.parse(raw) as { rootPath?: string; workspaceRoot?: string };
      if (prefs.rootPath) return prefs.rootPath;
      if (prefs.workspaceRoot) return prefs.workspaceRoot;
    }
  } catch {}
  return "";
}

export function resolveRoot(caps: Capabilities | null, alias?: string): string {
  if (!caps) return "";
  if (alias && alias !== "default") {
    const hit = caps.allowedRoots.find((r) => r.toLowerCase().endsWith("/" + alias.toLowerCase()));
    if (hit) return hit;
  }
  return caps.allowedRoots[0] || caps.workspaceRoot;
}
