// Workspace context: one app-wide instance of the API client + capabilities
// + the run registry. Runs live OUTSIDE the router so selecting another
// session never retargets or cancels a job (ZWUI-006 state ownership).

import { createContext, useContext, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import { ApiClient } from "./api/client";
import { loadPrefs, savePrefs, type Preferences } from "./state/prefs";
import { loadToken, saveToken, clearToken } from "./auth/token";
import { discoverCapabilities, type Capabilities } from "./auth/bootstrap";
import { runReducer, initialRun, type RunState } from "./state/run";
import { useEffect, useState } from "react";

type RunRegistry = Map<string, RunState>; // jobId → run (survives navigation)

type WorkspaceCtx = {
  client: ApiClient;
  token: string;
  setToken: (t: string) => void;
  logout: () => void;
  caps: Capabilities | null;
  reloadCaps: () => void;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => void;
  runs: RunRegistry;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(loadToken);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsTick, setCapsTick] = useState(0);
  const [prefsState, setPrefsState] = useState(loadPrefs);
  const runs = useMemo(() => new Map<string, RunState>() as RunRegistry, []);
  const [_, force] = useReducer((x: number) => x + 1, 0); // rerun subscribers on registry change

  const client = useMemo(
    () => new ApiClient(() => loadToken()),
    []
  );

  useEffect(() => {
    let alive = true;
    discoverCapabilities(client)
      .then((c) => alive && setCaps(c))
      .catch(() => alive && setCaps(null));
    return () => {
      alive = false;
    };
  }, [client, capsTick, token]);

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
      reloadCaps: () => setCapsTick((t) => t + 1),
      prefs: prefsState,
      updatePrefs: (patch) => setPrefsState(savePrefs(patch)),
      runs,
    }),
    [client, token, caps, capsTick, prefsState, runs]
  );

  // expose forceRefresh so reducers can trigger rerenders on registry mutation
  (value as WorkspaceCtx & { __refresh?: () => void }).__refresh = force;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

export { initialRun, runReducer };
