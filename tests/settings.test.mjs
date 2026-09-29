// Settings API tests: sanitize (keys never leave), validate (reject bad
// payloads before touching disk), merge-write (unknown top-level config keys
// survive; omitted keys are preserved), and agent-engine regeneration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { readSettings, validateSettings, writeSettings, regenerateAgentProviderConfig } = await import("../server/settings.mjs");

const home = mkdtempSync(join(tmpdir(), "zc-settings-test-"));
const configPath = join(home, "cli", "config.json");
mkdirSync(join(home, "cli"), { recursive: true });

function writeCfg(obj) { writeFileSync(configPath, JSON.stringify(obj, null, 2)); }

test("readSettings sanitizes providers and never exposes keys", () => {
  writeCfg({
    features: { mcp: false },
    model: { main: "prov/b" },
    provider: {
      prov: {
        name: "Prov", kind: "openai-compatible",
        options: { apiKey: "secret-key", baseURL: "https://x/v1" },
        models: { a: { name: "A" }, b: { name: "B", reasoning: { enabled: true, variants: ["low", "high"] } } },
      },
      broken: { nope: true }, // tolerated on read; kind reported null
    },
  });
  const doc = readSettings(configPath);
  const prov = doc.providers.find((p) => p.id === "prov");
  assert.equal(prov.kind, "openai-compatible");
  assert.equal(prov.apiKeyConfigured, true);
  assert.ok(!("apiKey" in prov), "the key itself must never be reported");
  assert.deepEqual(prov.models[1].reasoningVariants, ["low", "high"]);
  assert.equal(doc.providers.find((p) => p.id === "broken").kind, null);
  assert.equal(doc.defaultModel, "prov/b");
});

test("validateSettings rejects malformed payloads", () => {
  assert.ok(validateSettings({ providers: "nope" }).error);
  assert.ok(validateSettings({ providers: [{ id: "x", kind: "weird", baseURL: "https://x", models: [{ id: "m" }] }] }).error.includes("kind"));
  assert.ok(validateSettings({ providers: [{ id: "x", kind: "openai", baseURL: "ftp://x", models: [{ id: "m" }] }] }).error.includes("baseURL"));
  assert.ok(validateSettings({ providers: [{ id: "x", kind: "openai", baseURL: "https://x", models: [] }] }).error.includes("model"));
  assert.ok(validateSettings({ providers: [{ id: "x", kind: "openai", baseURL: "https://x", models: [{ id: "m" }] }], defaultModel: "other/m" }).error.includes("defaultModel"));
});

test("writeSettings merges, preserves unknown keys, keeps omitted API keys, applies atomically", () => {
  writeCfg({
    features: { mcp: false },
    plugins: { enabledPlugins: { "x@y": false } },
    model: { main: "old/legacy" },
    provider: { old: { name: "Old", kind: "anthropic", options: { apiKey: "keep-me", baseURL: "https://old/v1" }, models: { m1: {} } } },
  });
  // edit WITHOUT sending the old provider's key; drop provider "old", add "new"
  const r = writeSettings(configPath, {
    providers: [
      { id: "new", name: "New", kind: "openai-compatible", baseURL: "https://new/v1", apiKey: "fresh-key", models: [{ id: "n1", name: "N1", reasoningVariants: ["x"] }] },
    ],
    defaultModel: "new/n1",
  });
  assert.equal(r.error, undefined);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(Object.keys(cfg.provider), ["new"]);
  assert.equal(cfg.provider.new.options.apiKey, "fresh-key");
  assert.equal(cfg.provider.new.models.n1.reasoning.variants[0], "x");
  assert.equal(cfg.model.main, "new/n1");
  // untouched top-level keys survive
  assert.deepEqual(cfg.features, { mcp: false });
  assert.deepEqual(cfg.plugins, { enabledPlugins: { "x@y": false } });

  // omitting apiKey on the SAME provider keeps the stored key
  const r2 = writeSettings(configPath, {
    providers: [
      { id: "new", name: "Renamed", kind: "openai-compatible", baseURL: "https://new/v2", models: [{ id: "n1", name: "" }] },
    ],
    defaultModel: null,
  });
  assert.equal(r2.error, undefined);
  const cfg2 = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(cfg2.provider.new.options.apiKey, "fresh-key", "omitted key preserved");
  assert.equal(cfg2.provider.new.options.baseURL, "https://new/v2");
  assert.equal(cfg2.model.main, undefined, "default cleared");

  // a NEW provider without a key fails fast
  const r3 = writeSettings(configPath, {
    providers: [
      { id: "keyless", name: "", kind: "openai", baseURL: "https://k/v1", models: [{ id: "m" }] },
    ],
  });
  assert.match(r3.error.message, /apiKey is required/);
});

test("regenerateAgentProviderConfig writes the v4 translation", () => {
  writeSettings(configPath, {
    providers: [
      { id: "prov", name: "Prov", kind: "anthropic", apiKey: "k", baseURL: "https://p/v1", models: [{ id: "m", reasoningVariants: ["a", "b"] }] },
    ],
    defaultModel: "prov/m",
  });
  const r = regenerateAgentProviderConfig(home);
  assert.equal(r.ok, true);
  const v4 = JSON.parse(readFileSync(join(home, "web", "provider_config.json"), "utf8"));
  const rule = v4.config.providerConfigRules.providerRules[0];
  assert.equal(rule.providerId, "prov");
  assert.equal(rule.config.api.type, "anthropic-messages");
  assert.deepEqual(v4.config.modelConfigRules.providerModelRules[0].config.optionSpecs.reasoningLevel.values, ["a", "b"]);
  assert.deepEqual(v4.config.defaultModelSelection, { providerId: "prov", modelId: "m" });
});

test("edits preserve unknown provider/model fields the editor does not model", () => {
  writeCfg({
    provider: {
      rich: {
        name: "Rich", kind: "openai", customFlag: true,
        options: { apiKey: "k", baseURL: "https://r/v1", maxRetries: 7, extraHeader: "x" },
        models: {
          m1: { name: "M1", temperature: 0.2, maxTokens: 8192 },
        },
      },
    },
  });
  const r = writeSettings(configPath, {
    providers: [
      // editor-shaped edit: only id/kind/baseURL + model id (name cleared)
      { id: "rich", name: "Renamed", kind: "openai", baseURL: "https://r/v2", models: [{ id: "m1", name: "", reasoningVariants: [] }] },
    ],
  });
  assert.equal(r.error, undefined);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const p = cfg.provider.rich;
  assert.equal(p.customFlag, true, "unknown provider-level field survives");
  assert.equal(p.options.maxRetries, 7, "unknown option survives");
  assert.equal(p.options.extraHeader, "x");
  assert.equal(p.options.baseURL, "https://r/v2", "edited field DOES change");
  assert.equal(p.models.m1.temperature, 0.2, "unknown model field survives");
  assert.equal(p.models.m1.maxTokens, 8192);
  assert.equal(p.models.m1.name, undefined, "cleared display name stays cleared");
});
