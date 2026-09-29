# Bring your own CLI bundle

ZCode Desktop ships its CLI engine as a single self-contained Node bundle:
`zcode.cjs` (~15 MB). The CLI source is now open (github.com/zai-org/ZCode,
Apache-2.0) but the desktop bundle itself is a build artifact — this repo does
not include it.

## Where to get it

Install the [ZCode Desktop](https://zcode.z.ai) app, then copy:

| File | Linux | macOS | Windows |
| --- | --- | --- | --- |
| `zcode.cjs` | `/opt/ZCode/resources/glm/zcode.cjs` | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` | `C:\Program Files\ZCode\resources\glm\zcode.cjs` |
| `provider/zcode-builtin.json` | `/opt/ZCode/resources/config/provider/zcode-builtin.json` | `/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json` | `C:\Program Files\ZCode\resources\config\provider\zcode-builtin.json` |

## Use it

```bash
cp /opt/ZCode/resources/glm/zcode.cjs ./cli/zcode.cjs
cp /opt/ZCode/resources/config/provider/zcode-builtin.json ./cli/provider/zcode-builtin.json
# both baked in at docker build, or mounted at runtime (docker-compose.yml
# already mounts both)
```

**CLI >= 0.16.9 REQUIRES `provider/zcode-builtin.json`** staged next to the
bundle (`/opt/zcode/provider/` in this image): without it every prompt job
exits at boot with `无法定位 CLI ZCode Built-in Provider Config`. CLI 0.16.5
and earlier did not need it.

It runs with any Node.js >= 24 — no Electron needed:

```bash
node cli/zcode.cjs --help
node cli/zcode.cjs doctor
```

Both files are gitignored (`cli/zcode.cjs`, `cli/provider/`); only this README
is committed.

## Version notes

- Verified against the desktop bundle at CLI **0.16.9** (ZCode Desktop
  3.14.3): prompt mode, `--resume`, `--attach`, `--mode build|plan|edit|yolo`,
  and the `ZCODE_MODEL`/`ZCODE_API_KEY`/`ZCODE_BASE_URL` env contract all work
  unchanged from 0.16.5 (evidence: experiments/native-stop-eval on branch
  exp/native-stop-eval — legacy-config probe P1/P2 PASS).
- `--model` is NOT a CLI flag on 0.16.9 — the server passes the model via env
  (as it always has), so nothing to change there.
- Offline containers log a benign `ZCode Built-in 刷新失败: HTTP 404` /
  `ZCode Built-in missing` line on the CLI's stderr when it cannot refresh the
  builtin config remotely; turns are unaffected.

## skills/dynamic-workflows/ (Apache-2.0, committed)

The dynamic-workflows skill vendored from the open-source repo (byte-identical to
`apps/zcode-cli/packages/bundled-skills/skills/dynamic-workflows`). The CLI's
`CreateWorkflow` tool refuses to run until this skill is loadable from the
user scope; compose bind-mounts it at `/data/zcode/skills/dynamic-workflows`
(the image's `/root/.zcode` symlink points there). Replacing the CLI bundle?
Refresh the skill from the matching upstream tag.
