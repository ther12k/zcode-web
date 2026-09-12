# Bring your own CLI bundle

ZCode Desktop ships its CLI engine as a single self-contained Node bundle:
`zcode.cjs` (~12.6 MB). It is Z.AI's proprietary code, so this repo does not
include it and you may not redistribute it.

## Where to get it

Install the [ZCode Desktop](https://zcode.z.ai) app, then copy the bundle:

| Platform | Path |
| --- | --- |
| Linux | `/opt/ZCode/resources/glm/zcode.cjs` |
| macOS | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` |
| Windows | `C:\Program Files\ZCode\resources\glm\zcode.cjs` |

## Use it

```bash
cp /opt/ZCode/resources/glm/zcode.cjs ./cli/zcode.cjs   # baked in at docker build
# or mount it at runtime (docker-compose.yml already does this):
#   ./cli/zcode.cjs:/opt/zcode/zcode.cjs:ro
```

It runs with any Node.js >= 24 — no Electron needed:

```bash
node cli/zcode.cjs --help
node cli/zcode.cjs doctor
```

The bundle is gitignored (`cli/zcode.cjs`); only this README is committed.
