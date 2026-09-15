// ZWUI-012: isolated per-session drafts + versioned local preferences.
// Drafts are keyed by session id ("new" for the composer of a fresh chat) so
// switching sessions never leaks text between them. Preferences are versioned
// so future migrations can upgrade stored keys without data loss.

const PREFS_KEY = "zcode-web-prefs";
const PREFS_VERSION = 1;
const DRAFT_PREFIX = "zcode-web-draft:";

export type FontSize = "xs" | "s" | "m" | "l";

export type Preferences = {
  version: number;
  model: string;
  mode: string;
  rootPath: string;
  fontSize: FontSize;         // chat text scale, device-local
  hiddenSessions: string[];   // device-local hide, ZWUI-028
  pinnedSessions: string[];   // device-local pin, ZWUI-028
  displayAliases: Record<string, string>; // sessionId → local alias, ZWUI-028
};

const DEFAULT_PREFS: Preferences = {
  version: PREFS_VERSION,
  model: "",
  mode: "plan",
  rootPath: "",
  fontSize: "m",
  hiddenSessions: [],
  pinnedSessions: [],
  displayAliases: {},
};

export function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    if (parsed.version !== PREFS_VERSION) {
      // future: migrate older shapes; today only v1 exists — reset quietly
      return { ...DEFAULT_PREFS };
    }
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

// Fired on every successful save so React state (the workspace provider)
// stays in sync with ANY writer (App menu actions, Settings, other dialogs).
export const PREFS_EVENT = "zcode-prefs";

export function savePrefs(patch: Partial<Preferences>) {
  const next = { ...loadPrefs(), ...patch, version: PREFS_VERSION };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  } catch { /* non-browser context: state sync is best-effort */ }
  return next;
}

export function loadDraft(sessionKey: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + sessionKey) || "";
  } catch {
    return "";
  }
}

export function saveDraft(sessionKey: string, text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + sessionKey, text);
    else localStorage.removeItem(DRAFT_PREFIX + sessionKey);
  } catch {}
}
