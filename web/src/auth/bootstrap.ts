// Auth bootstrap: capability contract discovery (ZWUI-004). Token
// persistence lives in ./token — one implementation, no duplicated keys.
import { ApiClient } from "../api/client";

export { loadToken, saveToken, clearToken } from "./token";

// Capability contract: what this deployment supports, discovered from
// /api/health + /api/config. UI gates (inspector panes, degraded banners)
// read this instead of guessing.
export type Capabilities = {
  authRequired: boolean;
  /** ZWUI-065: why capabilities are degraded — an explicit auth verdict,
      not a guessed one (the old heuristic read `!workspaceRoot`) */
  authState: "ok" | "unauthorized" | "unreachable";
  cliPresent: boolean;
  providerConfigured: boolean;
  dbPresent: boolean;
  modes: string[];
  allowedRoots: string[];
  workspaceRoot: string;
  maxJobs: number;
  runtime: "node" | "lugas/bun" | "unknown";
};

export async function discoverCapabilities(client: ApiClient): Promise<Capabilities> {
  try {
    const [health, cfg] = await Promise.all([client.health(), client.config()]);
    return {
      authRequired: cfg.authRequired,
      authState: "ok",
      cliPresent: cfg.cliPresent,
      providerConfigured: cfg.providerConfigured,
      dbPresent: health.db?.present ?? false,
      modes: cfg.modes?.length ? cfg.modes : ["plan"],
      allowedRoots: cfg.allowedRoots || [cfg.workspaceRoot],
      workspaceRoot: cfg.workspaceRoot,
      maxJobs: health.maxJobs || 3,
      runtime: (health as { runtime?: string }).runtime === "lugas/bun" ? "lugas/bun" : "node",
    };
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return {
        authRequired: true,
        authState: "unauthorized",
        cliPresent: false,
        providerConfigured: false,
        dbPresent: false,
        modes: ["plan"],
        allowedRoots: [],
        workspaceRoot: "",
        maxJobs: 1,
        runtime: "node",
      };
    }
    try {
      const b = await fetch("/api/bootstrap").then((r) => r.json());
      if (b && typeof b.authRequired === "boolean") {
        // the server answers /api/bootstrap but rejected the authed probes:
        // a token is required and the stored one does not work
        return {
          authRequired: b.authRequired,
          authState: b.authRequired ? "unauthorized" : "unreachable",
          cliPresent: false,
          providerConfigured: false,
          dbPresent: false,
          modes: ["plan"],
          allowedRoots: [],
          workspaceRoot: "",
          maxJobs: 1,
          runtime: "node",
        };
      }
    } catch {}
    throw err;
  }
}
