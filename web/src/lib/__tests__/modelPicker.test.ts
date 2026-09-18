import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../api/client";
import { compactModelRef, compactProviderId, filterModels, groupModels, modelMatches, normalizeModelSearch, recentModels } from "../modelPicker";

const model = (over: Partial<ModelInfo> = {}): ModelInfo => ({
  ref: "zai/glm-5.3",
  provider: "zai",
  providerName: "Z.AI",
  model: "glm-5.3",
  displayName: "GLM 5.3",
  isDefault: false,
  ...over,
});

describe("model picker helpers", () => {
  it("normalizes separators and accents for forgiving search", () => {
    expect(normalizeModelSearch("GLM-5.3")).toBe("glm53");
    expect(normalizeModelSearch("  café_model ")).toBe("cafemodel");
  });

  it("matches display name, ref, and provider fields", () => {
    const glm = model();
    expect(modelMatches(glm, "glm 5 3")).toBe(true);
    expect(modelMatches(glm, "zai")).toBe(true);
    expect(modelMatches(glm, "provider-that-does-not-exist")).toBe(false);
    expect(filterModels([glm], "GLM-53")).toEqual([glm]);
  });

  it("groups non-adjacent models by provider and puts the default provider first", () => {
    const models = [
      model({ ref: "beta/one", provider: "beta", providerName: "Beta", model: "one", displayName: "One" }),
      model({ ref: "zai/flash", model: "glm-5.3-flash", displayName: "GLM Flash" }),
      model({ ref: "beta/two", provider: "beta", providerName: "Beta", model: "two", displayName: "Two" }),
      model({ ref: "zai/main", model: "glm-5.3", displayName: "GLM Main", isDefault: true }),
    ];
    const groups = groupModels(models);
    expect(groups.map((group) => group.provider)).toEqual(["zai", "beta"]);
    expect(groups[0].models.map((item) => item.ref)).toEqual(["zai/main", "zai/flash"]);
    expect(groups[1].models.map((item) => item.ref)).toEqual(["beta/one", "beta/two"]);
  });

  it("resolves recent refs in stored order and drops unavailable or duplicate refs", () => {
    const models = [model(), model({ ref: "zai/flash", model: "flash", displayName: "Flash" })];
    expect(recentModels(models, ["missing", "zai/flash", "zai/flash", "zai/glm-5.3"]).map((item) => item.ref))
      .toEqual(["zai/flash", "zai/glm-5.3"]);
  });

  it("compacts UUID-style provider ids in refs and header ids", () => {
    expect(compactModelRef("zai-apikey/glm-5.3")).toBe("zai-apikey/glm-5.3");
    expect(compactModelRef("5457e588-8c0d-46ec-bcfa-b69da860f30b/ae/claude-fable-5")).toBe("…/ae/claude-fable-5");
    expect(compactModelRef("no-slash-ref")).toBe("no-slash-ref");
    expect(compactProviderId("zai-apikey")).toBe("zai-apikey");
    expect(compactProviderId("5457e588-8c0d-46ec-bcfa-b69da860f30b")).toBe("5457e5…");
  });
});
