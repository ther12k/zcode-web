// Settings dialog — reference structure: settings-tabs + settings-body with
// provider/environment sections (adapted to our real capabilities).
//
// The AI-provider tab is a full provider manager (the upstream web app's
// settings surface, adapted): edit/add providers and models, set the default
// model, save to the server's CLI config. API keys are write-only — the
// server reports apiKeyConfigured, never the key itself.
import { useCallback, useEffect, useState } from "react";
import { Check, Eye, LoaderCircle, LockKeyhole, Database, FolderClosed, Plus, Trash2 } from "lucide-react";
import { Dialog } from "../ui";
import { loadPrefs, savePrefs, PREFS_EVENT, type FontSize, type Preferences } from "../state/prefs";
import { ApiError, type ApiClient, type ProviderSettings, type SettingsDoc } from "../api/client";

type Caps = {
  runtime: string; cliPresent: boolean; providerConfigured: boolean; dbPresent: boolean;
  allowedRoots: string[]; modes: string[]; maxJobs: number;
};

const FONT_SIZES: Array<{ id: FontSize; label: string; hint: string }> = [
  { id: "xs", label: "XS", hint: "Extra small" },
  { id: "s", label: "S", hint: "Small" },
  { id: "m", label: "M", hint: "Default" },
  { id: "l", label: "L", hint: "Large" },
];

const KINDS: Array<ProviderSettings["kind"]> = ["openai-compatible", "openai", "anthropic"];

type EditableProvider = ProviderSettings & { apiKey?: string; isNew?: boolean };

function toEditable(doc: SettingsDoc): EditableProvider[] {
  return doc.providers.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m })) }));
}

export function SettingsDialog({ caps, client, onClose, onLogout, onProvidersSaved }: {
  caps: Caps | null;
  client: ApiClient;
  onClose: () => void;
  onLogout: () => void;
  /** notified after a successful save so the composer's model list refreshes */
  onProvidersSaved?: () => void;
}) {
  const [tab, setTab] = useState<"workspace" | "provider">("workspace");
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>(() => loadPrefs().fontSize);
  // ZWUI-067: hidden sessions are managed here — hide is device-local, so
  // the management surface must make RESTORING discoverable (nothing is ever
  // deleted by hiding)
  const [prefs, setPrefs] = useState<Preferences>(() => loadPrefs());

  // provider manager state
  const [providers, setProviders] = useState<EditableProvider[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const next = (e as CustomEvent<Preferences>).detail;
      if (next) setPrefs(next);
    };
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);

  const loadProviders = useCallback(async () => {
    setProviders(null);
    setLoadError(null);
    try {
      const doc = await client.settings();
      setProviders(toEditable(doc));
      setDefaultModel(doc.defaultModel ?? "");
    } catch (e) {
      setLoadError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    if (tab === "provider" && providers === null && !loadError) void loadProviders();
  }, [tab, providers, loadError, loadProviders]);

  const applyFontSize = (fs: FontSize) => {
    setFontSize(fs);
    savePrefs({ fontSize: fs });
    // the app shell reads this on the storage + custom event it listens for
    window.dispatchEvent(new CustomEvent("zcode-fontsize", { detail: fs }));
  };

  const mutateProvider = (idx: number, patch: Partial<EditableProvider>) => {
    setProviders((all) => (all ? all.map((p, i) => (i === idx ? { ...p, ...patch } : p)) : all));
  };
  const mutateModel = (pidx: number, midx: number, patch: Partial<EditableProvider["models"][number]>) => {
    setProviders((all) => (all
      ? all.map((p, i) => (i === pidx ? { ...p, models: p.models.map((m, j) => (j === midx ? { ...m, ...patch } : m)) } : p))
      : all));
  };
  const addProvider = () => {
    setProviders((all) => [...(all ?? []), {
      id: "", name: "", kind: "openai-compatible", baseURL: "",
      apiKeyConfigured: false, apiKey: "", isNew: true,
      models: [{ id: "", name: "", reasoningVariants: [] }],
    }]);
  };
  const addModel = (pidx: number) => {
    setProviders((all) => (all ? all.map((p, i) => (i === pidx ? { ...p, models: [...p.models, { id: "", name: "", reasoningVariants: [] }] } : p)) : all));
  };

  const saveProviders = async () => {
    if (!providers) return;
    setBusy(true);
    setSaveError(null);
    try {
      await client.saveSettings({
        providers,
        defaultModel: defaultModel || null,
      });
      setSavedAt(Date.now());
      onProvidersSaved?.();
      await loadProviders();
    } catch (e) {
      setSaveError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const modelRefs = (providers ?? []).flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));

  return (
    <Dialog title="Make yourself at home." subtitle="Your workspace, your way." onClose={onClose} wide>
      <div className="settings-tabs">
        {([["workspace", "Workspace"], ["provider", "AI provider"]] as const).map(([id, title]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{title}</button>
        ))}
      </div>
      <div className="dialog-body settings-body">
        {tab === "workspace" && caps && (
          <>
            <div className="settings-section-heading">
              <h3>Text size.</h3>
              <p>How large the conversation reads on this device.</p>
            </div>
            <div className="font-size-row" role="radiogroup" aria-label="Text size">
              {FONT_SIZES.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={fontSize === f.id}
                  className={`font-size-option ${fontSize === f.id ? "active" : ""}`}
                  onClick={() => applyFontSize(f.id)}
                >
                  <span className={`font-size-sample fs-${f.id}`}>Aa</span>
                  <strong>{f.label}</strong>
                  <small>{f.hint}</small>
                </button>
              ))}
            </div>
            {prefs.hiddenSessions.length > 0 && (
              <>
                <div className="settings-section-heading">
                  <h3>Hidden sessions.</h3>
                  <p>Hidden on this device only — the sessions still exist in the store and stay available everywhere else.</p>
                </div>
                <div className="hidden-sessions-list">
                  {prefs.hiddenSessions.map((id) => (
                    <span key={id} className="hidden-session-chip">
                      <span className="mono">{prefs.displayAliases[id] || id.slice(0, 22)}</span>
                      <button
                        className="secondary-button"
                        aria-label={`Restore session ${prefs.displayAliases[id] || id}`}
                        onClick={() => savePrefs({ hiddenSessions: prefs.hiddenSessions.filter((x) => x !== id) })}
                      >
                        <Eye size={12} />Restore
                      </button>
                    </span>
                  ))}
                  <button
                    className="secondary-button"
                    onClick={() => savePrefs({ hiddenSessions: [] })}
                  >
                    <Eye size={12} />Restore all
                  </button>
                </div>
              </>
            )}
            <div className="settings-section-heading">
              <h3>Where things stand.</h3>
              <p>Live readiness of this deployment.</p>
            </div>
            <div className="tool-row">
              <span className="tool-icon sage"><FolderClosed size={21} /></span>
              <div><h3>Workspace roots</h3><p>{caps.allowedRoots.join(" · ")}</p></div>
              <span className="connection-badge connected"><Check size={11} />{caps.allowedRoots.length} roots</span>
            </div>
            <div className="tool-row">
              <span className="tool-icon blue"><Database size={21} /></span>
              <div><h3>Session history</h3><p>Read from the CLI's own SQLite store ({caps.runtime} runtime).</p></div>
              <span className={`connection-badge ${caps.dbPresent ? "connected" : ""}`}><span className="tiny-dot" />{caps.dbPresent ? "Synced" : "Not found"}</span>
            </div>
            <div className="settings-info">
              <LockKeyhole size={18} />
              <div>
                <strong>Private by default</strong>
                <p>Sessions live on your machine in the CLI's database. The web layer reads them read-only; your token never leaves the browser except to this server.</p>
              </div>
            </div>
          </>
        )}
        {tab === "provider" && (
          <>
            <div className="settings-section-heading">
              <h3>Providers.</h3>
              <p>Model providers the CLI can use. Changes write to the server's CLI config and apply to the next run — no restart needed.</p>
            </div>
            {loadError && (
              <div className="provider-editor-error" role="alert">
                Couldn't load provider settings: {loadError}
                <button className="secondary-button" onClick={() => void loadProviders()}>Retry</button>
              </div>
            )}
            {providers === null && !loadError && (
              <div className="provider-editor-loading"><LoaderCircle size={14} className="spin" /> Loading providers…</div>
            )}
            {providers !== null && providers.length === 0 && (
              <div className="provider-editor-empty">
                No providers configured yet — add one with its API key, base URL, and at least one model.
              </div>
            )}
            {providers?.map((p, pidx) => (
              <fieldset className="provider-editor" key={pidx} aria-label={`Provider ${p.id || "new"}`}>
                <legend className="mono">{p.id || "new provider"}</legend>
                <div className="provider-editor-grid">
                  <label>
                    <span>Provider id</span>
                    <input value={p.id} placeholder="my-openrouter" disabled={!p.isNew}
                      onChange={(e) => mutateProvider(pidx, { id: e.target.value })} />
                  </label>
                  <label>
                    <span>Display name</span>
                    <input value={p.name} placeholder="OpenRouter"
                      onChange={(e) => mutateProvider(pidx, { name: e.target.value })} />
                  </label>
                  <label>
                    <span>API type</span>
                    <select value={p.kind} onChange={(e) => mutateProvider(pidx, { kind: e.target.value as ProviderSettings["kind"] })}>
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className="provider-editor-url">
                    <span>Base URL</span>
                    <input value={p.baseURL} placeholder="https://api.example.com/v1"
                      onChange={(e) => mutateProvider(pidx, { baseURL: e.target.value })} />
                  </label>
                  <label className="provider-editor-key">
                    <span>API key {p.apiKeyConfigured && !p.apiKey ? "(configured — leave blank to keep)" : ""}</span>
                    <input type="password" value={p.apiKey ?? ""} placeholder={p.apiKeyConfigured ? "••••••••" : "sk-…"}
                      autoComplete="new-password"
                      onChange={(e) => mutateProvider(pidx, { apiKey: e.target.value })} />
                  </label>
                </div>
                <div className="provider-models">
                  <span className="provider-models-label">Models</span>
                  {p.models.map((m, midx) => (
                    <div className="provider-model-row" key={midx}>
                      <input className="mono" value={m.id} placeholder="glm-5.3" aria-label={`Model id for ${p.id || "new provider"}`}
                        onChange={(e) => mutateModel(pidx, midx, { id: e.target.value })} />
                      <input value={m.name} placeholder="Display name (optional)" aria-label={`Model display name for ${m.id || "new model"}`}
                        onChange={(e) => mutateModel(pidx, midx, { name: e.target.value })} />
                      <input value={m.reasoningVariants.join(", ")} placeholder="Reasoning levels (optional, comma-sep)"
                        aria-label={`Reasoning levels for ${m.id || "new model"}`}
                        onChange={(e) => mutateModel(pidx, midx, { reasoningVariants: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                      <button className="icon-button" aria-label={`Remove model ${m.id || "new model"}`}
                        disabled={p.models.length <= 1}
                        onClick={() => mutateProvider(pidx, { models: p.models.filter((_, j) => j !== midx) })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button className="secondary-button provider-add-model" onClick={() => addModel(pidx)}>
                    <Plus size={12} />Add model
                  </button>
                </div>
                <button className="danger-button provider-remove" aria-label={`Remove provider ${p.id}`}
                  onClick={() => setProviders((all) => (all ? all.filter((_, i) => i !== pidx) : all))}>
                  <Trash2 size={12} />Remove provider
                </button>
              </fieldset>
            ))}
            {providers !== null && (
              <div className="provider-editor-actions">
                <button className="secondary-button" onClick={addProvider}><Plus size={12} />Add provider</button>
                <label className="provider-default-picker">
                  <span>Default model</span>
                  <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                    <option value="">(none)</option>
                    {modelRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="settings-info">
              <LockKeyhole size={18} />
              <div>
                <strong>Keys stay server-side</strong>
                <p>The API key is written to the CLI's config on the server and never sent back to this browser. Leave the key field blank to keep an existing one.</p>
              </div>
            </div>
            {saveError && <div className="provider-editor-error" role="alert">Save failed: {saveError}</div>}
            {savedAt && !saveError && !busy && (
              <div className="provider-editor-saved" role="status"><Check size={12} /> Saved — models apply to the next run.</div>
            )}
          </>
        )}
      </div>
      <footer className="dialog-footer">
        <button className="danger-button" onClick={onLogout}>Sign out</button>
        <span style={{ flex: 1 }} />
        {tab === "provider" && providers !== null && (
          <button className="secondary-button" disabled={busy} onClick={() => void saveProviders()}>
            {busy && <LoaderCircle size={12} className="spin" />}Save providers
          </button>
        )}
        <button className="primary-button" onClick={onClose}><Check size={13} />Done</button>
      </footer>
    </Dialog>
  );
}
