import type { ModelInfo } from "../api/client";

export type ModelGroup = {
  key: string;
  provider: string;
  providerName: string;
  models: ModelInfo[];
};

/**
 * Make model searches forgiving: `glm 5.3`, `glm-5.3`, and `glm53` all
 * become the same compact query. Provider and model names are generally
 * ASCII, but keep Unicode letters/numbers usable too.
 */
export function normalizeModelSearch(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function modelLabel(model: ModelInfo): string {
  return String(model.displayName || model.model || model.ref).trim() || model.ref;
}

// Provider ids are usually short slugs ("zai-apikey"), but some configs key
// providers by UUID. Those ids add noise, not context, in the picker's
// secondary lines — elide them to their readable tail.
export function compactProviderId(provider: string): string {
  if (provider.length <= 14) return provider;
  return provider.slice(0, 6) + "…";
}

/** Compact `provider/model` for row context; a noisy provider id collapses to `…/model`. */
export function compactModelRef(ref: string): string {
  const slash = ref.indexOf("/");
  if (slash < 0) return ref;
  const provider = ref.slice(0, slash);
  if (provider.length > 14) return "…/" + ref.slice(slash + 1);
  return ref;
}

function searchableModelText(model: ModelInfo): string {
  return [modelLabel(model), model.model, model.providerName, model.provider, model.ref]
    .map(normalizeModelSearch)
    .join(" ");
}

export function modelMatches(model: ModelInfo, query: string): boolean {
  const needle = normalizeModelSearch(query);
  return !needle || searchableModelText(model).includes(needle);
}

export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  return models.filter((model) => modelMatches(model, query));
}

function compareModels(a: ModelInfo, b: ModelInfo): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  const byName = modelLabel(a).localeCompare(modelLabel(b), undefined, { sensitivity: "base" });
  return byName || a.ref.localeCompare(b.ref, undefined, { sensitivity: "base" });
}

/** Group by provider id, not server adjacency, so config order cannot split a provider. */
export function groupModels(models: ModelInfo[]): ModelGroup[] {
  const byProvider = new Map<string, ModelGroup>();
  for (const model of models) {
    const key = model.provider || model.providerName || "unknown";
    const existing = byProvider.get(key);
    if (existing) {
      existing.models.push(model);
    } else {
      byProvider.set(key, {
        key,
        provider: model.provider || key,
        providerName: model.providerName || model.provider || key,
        models: [model],
      });
    }
  }

  const groups = [...byProvider.values()];
  for (const group of groups) group.models.sort(compareModels);
  groups.sort((a, b) => {
    const aDefault = a.models.some((model) => model.isDefault);
    const bDefault = b.models.some((model) => model.isDefault);
    if (aDefault !== bDefault) return aDefault ? -1 : 1;
    const byName = a.providerName.localeCompare(b.providerName, undefined, { sensitivity: "base" });
    return byName || a.provider.localeCompare(b.provider, undefined, { sensitivity: "base" });
  });
  return groups;
}

/** Resolve recent refs in their stored order, silently pruning unavailable refs. */
export function recentModels(models: ModelInfo[], recentRefs: string[]): ModelInfo[] {
  const byRef = new Map(models.map((model) => [model.ref, model]));
  const seen = new Set<string>();
  const result: ModelInfo[] = [];
  for (const ref of recentRefs) {
    if (seen.has(ref)) continue;
    const model = byRef.get(ref);
    if (!model) continue;
    seen.add(ref);
    result.push(model);
  }
  return result;
}
