// Auth bootstrap: token persistence + capability contract discovery (ZWUI-004).

import { ApiClient } from "../api/client";

const TOKEN_KEY = "zcode-web-token";

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: token lives only for this page load */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// Capability contract: what this deployment supports, discovered from
// /api/health + /api/config. UI gates (inspector panes, degraded banners)
// read this instead of guessing.
export type Capabilities = {
  authRequired: boolean;
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
        return {
          authRequired: b.authRequired,
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
