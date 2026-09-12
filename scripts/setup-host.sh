#!/usr/bin/env bash
# Prepares a host that already runs the ZCode Desktop app for headless CLI use.
#
# What it does:
#   1. Locates the CLI bundle (zcode.cjs) shipped with ZCode Desktop.
#   2. Derives ~/.zcode/cli/config.json (provider registry + model.main) from
#      the desktop's ~/.zcode/v2/config.json so `--prompt` runs work headless.
#      Existing keys in cli/config.json (skills, plugins, …) are preserved.
#
# Safe to re-run; a timestamped backup of cli/config.json is kept.

set -euo pipefail

CLI_CANDIDATES=(
  "/opt/ZCode/resources/glm/zcode.cjs"
  "/usr/lib/zcode/resources/glm/zcode.cjs"
  "/usr/local/lib/zcode/resources/glm/zcode.cjs"
)

CLI_ENTRY="${ZCODE_CLI_ENTRY:-}"
if [[ -z "$CLI_ENTRY" ]]; then
  for c in "${CLI_CANDIDATES[@]}"; do
    [[ -f "$c" ]] && CLI_ENTRY="$c" && break
  done
fi

if [[ -z "$CLI_ENTRY" ]]; then
  echo "ERROR: could not find the ZCode CLI bundle (zcode.cjs)." >&2
  echo "Install ZCode Desktop first, or export ZCODE_CLI_ENTRY=/path/to/zcode.cjs" >&2
  exit 1
fi
echo "CLI bundle: $CLI_ENTRY"

CONFIG_DIR="$HOME/.zcode/cli"
V2_CONFIG="$HOME/.zcode/v2/config.json"
CONFIG_JSON="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"

node "$CLI_ENTRY" version || true

# Derive the headless model config from the desktop provider registry.
node - "$V2_CONFIG" "$CONFIG_JSON" <<'EOF'
const fs = require("fs");
const [v2Path, cliPath] = process.argv.slice(2);

let v2 = {};
try { v2 = JSON.parse(fs.readFileSync(v2Path, "utf8")); }
catch { console.error("No desktop config at " + v2Path + " — run ZCode Desktop and log in once, then re-run."); process.exit(1); }

const providers = v2.provider || {};
const entries = {};
for (const [id, p] of Object.entries(providers)) {
  const key = p.api || id.replace(/^builtin:/, "");
  const apiKey = p.options && p.options.apiKey;
  const baseURL = p.options && p.options.baseURL;
  if (!apiKey || !baseURL) continue;               // needs OAuth/captcha — not headless-friendly
  if (p.enabled === false) continue;               // disabled in the desktop app
  entries[key] = {
    name: p.name || key,
    kind: p.kind,
    options: { apiKey, baseURL },
    models: Object.fromEntries(Object.keys(p.models || {}).map((m) => [m, { name: m }])),
  };
}
const ids = Object.keys(entries);
if (!ids.length) { console.error("No API-key providers found in desktop config — log into the desktop app first."); process.exit(1); }

// prefer a coding-plan provider, fall back to the first entry
const mainId = ids.find((i) => i.includes("coding-plan")) || ids[0];
const firstModel = Object.keys(entries[mainId].models)[0];

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cliPath, "utf8")); } catch {}
if (Object.keys(cfg).length) fs.copyFileSync(cliPath, cliPath + ".bak-" + Date.now());

cfg.provider = { ...(cfg.provider || {}), ...entries };
cfg.model = { main: `${mainId}/${firstModel}` };
fs.writeFileSync(cliPath, JSON.stringify(cfg, null, 2));
console.log(`Wrote ${cliPath}`);
console.log(`  providers: ${ids.join(", ")}`);
console.log(`  model.main: ${mainId}/${firstModel}`);
EOF

echo
echo "Done. Test with:"
echo "  node \"$CLI_ENTRY\" --prompt 'hi' --output-format json --mode plan --cwd /tmp"
