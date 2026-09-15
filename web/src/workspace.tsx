// Workspace context: one app-wide instance of the API client + capabilities
// + preferences. Runs live OUTSIDE the router (in the run manager's external
// store) so selecting another session never retargets or cancels a job
// (ZWUI-006 state ownership).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiClient } from "./api/client";
import { loadPrefs, savePrefs, PREFS_EVENT, type Preferences } from "./state/prefs";
import { loadToken, saveToken, clearToken } from "./auth/token";
import { discoverCapabilities, type Capabilities } from "./auth/bootstrap";

type WorkspaceCtx = {
  client: ApiClient;
  token: string;
  setToken: (t: string) => void;
  logout: () => void;
  caps: Capabilities | null;
  /** set when capability discovery itself failed (server unreachable) —
      distinct from caps=null-while-loading so the shell can show a retry */
  capsError: string | null;
  reloadCaps: () => void;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => void;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(loadToken);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [capsTick, setCapsTick] = useState(0);
  const [prefsState, setPrefsState] = useState(loadPrefs);

  const client = useMemo(
    () => new ApiClient(() => loadToken()),
    []
  );

  useEffect(() => {
    let alive = true;
    setCapsError(null);
    discoverCapabilities(client)
      .then((c) => { if (alive) { setCaps(c); setCapsError(null); } })
      .catch((e) => { if (alive) setCapsError(e instanceof Error ? e.message : String(e)); });
    return () => {
      alive = false;
    };
  }, [client, capsTick, token]);

  // prefs are saved from several surfaces — stay current with all of them
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const next = (e as CustomEvent<Preferences>).detail;
      if (next) setPrefsState(next);
    };
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);

  const value = useMemo<WorkspaceCtx>(
    () => ({
      client,
      token,
      setToken: (t) => {
        saveToken(t);
        setTokenState(t);
      },
      logout: () => {
        clearToken();
        setTokenState("");
      },
      caps,
      capsError,
      reloadCaps: () => setCapsTick((t) => t + 1),
      prefs: prefsState,
      updatePrefs: (patch) => savePrefs(patch),
    }),
    [client, token, caps, capsError, capsTick, prefsState]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}
