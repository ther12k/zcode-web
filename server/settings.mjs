// Provider settings API support: read/sanitize + validate/write the CLI's
// legacy cli/config.json (`provider` map + `model.main`), preserving every
// other top-level key, and regenerate the v4 provider_config.json the agent
// engine's process registry reads (both engines then see the same change
// immediately — prompt engine re-reads config.json per spawn, the agent
// registry polls the translated file).
//
// API keys NEVER travel to the browser: GET reports apiKeyConfigured only;
// PUT accepts an optional new apiKey per provider (omitted = keep existing).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translateLegacyProviders } from "./agent-host.mjs";

const KINDS = new Set(["openai", "openai-compatible", "anthropic"]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const URL_RE = /^https?:\/\/[^\s]+$/;

export function readSettings(configPath) {
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    cfg = {};
  }
  const providers = [];
  for (const [id, p] of Object.entries(cfg.provider || {})) {
    providers.push({
      id,
      name: typeof p?.name === "string" ? p.name : id,
      kind: KINDS.has(p?.kind) ? p.kind : null,
      baseURL: typeof p?.options?.baseURL === "string" ? p.options.baseURL : "",
      apiKeyConfigured: Boolean(p?.options?.apiKey),
      models: Object.entries(p?.models || {}).map(([mid, m]) => ({
        id: mid,
        name: typeof m?.name === "string" ? m.name : "",
        reasoningVariants: Array.isArray(m?.reasoning?.variants)
          ? m.reasoning.variants.map(String).filter(Boolean)
          : [],
      })),
    });
  }
  const main = cfg.model?.main || (typeof cfg.model === "string" ? cfg.model : null);
  return {
    providers,
    defaultModel: typeof main === "string" ? main.replace(/^builtin:/, "") : null,
    engineNote: undefined, // reserved; the health endpoint reports the engine
  };
}

/** Validate a settings payload. Returns {error} or {clean} where clean is
 *  the provider/model structure ready to merge into config.json. */
export function validateSettings(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.providers)) {
    return { error: "providers must be an array" };
  }
  const seenIds = new Set();
  const cleanProviders = {};
  for (const p of payload.providers) {
    if (!p || typeof p !== "object") return { error: "invalid provider entry" };
    if (typeof p.id !== "string" || !ID_RE.test(p.id)) {
      return { error: `provider id "${p.id}" is not a valid slug` };
    }
    if (seenIds.has(p.id)) return { error: `duplicate provider id "${p.id}"` };
    seenIds.add(p.id);
    if (!KINDS.has(p.kind)) return { error: `provider "${p.id}": kind must be one of openai, openai-compatible, anthropic` };
    if (typeof p.baseURL !== "string" || !URL_RE.test(p.baseURL)) {
      return { error: `provider "${p.id}": baseURL must be an http(s) URL` };
    }
    if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
      return { error: `provider "${p.id}": apiKey must be a string` };
    }
    if (!Array.isArray(p.models) || p.models.length === 0) {
      return { error: `provider "${p.id}": at least one model is required` };
    }
    const seenModels = new Set();
    const models = {};
    for (const m of p.models) {
      if (!m || typeof m !== "object" || typeof m.id !== "string" || !ID_RE.test(m.id)) {
        return { error: `provider "${p.id}": model id "${m?.id}" is not a valid slug` };
      }
      if (seenModels.has(m.id)) return { error: `provider "${p.id}": duplicate model "${m.id}"` };
      seenModels.add(m.id);
      const entry = {};
      if (typeof m.name === "string" && m.name.trim()) entry.name = m.name.trim();
      const variants = Array.isArray(m.reasoningVariants)
        ? m.reasoningVariants.map((v) => String(v).trim()).filter(Boolean)
        : [];
      if (variants.length) entry.reasoning = { enabled: true, variants };
      models[m.id] = entry;
    }
    cleanProviders[p.id] = {
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.id,
      kind: p.kind,
      options: { baseURL: p.baseURL },
      models,
    };
  }
  let defaultModel = null;
  if (payload.defaultModel !== undefined && payload.defaultModel !== null && payload.defaultModel !== "") {
    if (typeof payload.defaultModel !== "string" || !payload.defaultModel.includes("/")) {
      return { error: "defaultModel must look like provider/model" };
    }
    const [pid, ...rest] = payload.defaultModel.split("/");
    const mid = rest.join("/");
    if (!cleanProviders[pid] || !cleanProviders[pid].models[mid]) {
      return { error: `defaultModel "${payload.defaultModel}" does not match any configured provider/model` };
    }
    defaultModel = `${pid}/${mid}`;
  }
  return { clean: { providers: cleanProviders, defaultModel } };
}

/** Merge-write: only `provider` and `model` keys change; unknown top-level
 *  keys (features, plugins, skills, …) survive untouched. Atomic via tmp+rename. */
export function writeSettings(configPath, payload) {
  const { error, clean } = validateSettings(payload);
  if (error) return { error: Object.assign(new Error(error), { status: 400 }) };
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    cfg = {};
  }
  const previous = cfg.provider || {};
  // apiKey handling: omitted key on an EXISTING provider keeps the old key
  // (the browser never sees keys, so an edit session cannot echo them back).
  // Round-trip preservation: the editor only models known fields — any
  // PREVIOUS provider/model fields it does not model (extra options, custom
  // model settings) survive the edit instead of being normalized away.
  for (const [id, next] of Object.entries(clean.providers)) {
    const prev = previous[id];
    const prevKey = prev?.options?.apiKey;
    const incoming = payload.providers.find((p) => p.id === id);
    if (incoming?.apiKey === undefined && typeof prevKey === "string" && prevKey) {
      next.options.apiKey = prevKey;
    } else if (typeof incoming?.apiKey === "string" && incoming.apiKey.trim()) {
      next.options.apiKey = incoming.apiKey.trim();
    }
    // a provider with NO resolvable key (new or old) is still allowed — the
    // CLI surfaces its own provider_not_configured error at turn time — but
    // require it explicitly for NEW providers so the common case fails fast
    if (!prev && !next.options.apiKey) {
      return { error: Object.assign(new Error(`provider "${id}": apiKey is required for a new provider`), { status: 400 }) };
    }
    if (prev && typeof prev === "object") {
      // only fields the editor does NOT model survive; modeled-but-cleared
      // (e.g. an emptied display name) must stay cleared
      const skipProvider = new Set(["name", "kind", "options", "models"]);
      for (const [k, v] of Object.entries(prev)) {
        if (!skipProvider.has(k)) next[k] = v; // unknown provider-level fields survive
      }
      if (prev.options && typeof prev.options === "object") {
        const skipOptions = new Set(["apiKey", "baseURL"]);
        for (const [k, v] of Object.entries(prev.options)) {
          if (!skipOptions.has(k)) next.options[k] = v; // extra option keys survive
        }
      }
      if (prev.models && typeof prev.models === "object") {
        const skipModel = new Set(["name", "reasoning"]);
        for (const [mid, prevModel] of Object.entries(prev.models)) {
          if (!next.models[mid] || !prevModel || typeof prevModel !== "object") continue;
          for (const [k, v] of Object.entries(prevModel)) {
            if (!skipModel.has(k)) next.models[mid][k] = v; // extra model fields survive
          }
        }
      }
    }
  }
  cfg.provider = clean.providers;
  if (clean.defaultModel) cfg.model = { ...(cfg.model && typeof cfg.model === "object" ? cfg.model : {}), main: clean.defaultModel };
  else if (cfg.model && typeof cfg.model === "object") delete cfg.model.main;
  const tmp = `${configPath}.tmp-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, configPath);
  return { ok: true };
}

/** Regenerate the agent engine's translated provider config (no-op when the
 *  legacy config is unreadable — the host logs it at spawn time instead). */
export function regenerateAgentProviderConfig(zcodeHome) {
  const legacyPath = join(zcodeHome, "cli", "config.json");
  const outDir = join(zcodeHome, "web");
  const outPath = join(outDir, "provider_config.json");
  let legacy = {};
  try {
    legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  } catch {
    return { ok: false };
  }
  const { doc, skipped } = translateLegacyProviders(legacy);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2));
  return { ok: true, skipped };
}

export function settingsStatus(configPath) {
  return { present: existsSync(configPath) };
}
