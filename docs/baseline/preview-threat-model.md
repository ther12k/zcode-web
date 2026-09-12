# ZWUI-034: static preview threat model & capability contract (DECISION)

Status: **APPROVED-AS-DESIGNED-GATE** — implementation (ZWUI-035/036) is
authorized only against this contract. Any deviation re-opens this issue.

## Threats

| Threat | Mitigation (contract) |
|---|---|
| Served project files executing in origin (XSS → token theft) | Preview served from a **separate origin** (separate port/hostname), never the app origin; cookies/token never sent |
| Sneaky executable content (html + scripts) | Only a **static snapshot**: HTML sanitized of `<script>`, all external/embedded JS stripped, CSS inlined-only; assets copied into the snapshot |
| Directory traversal / arbitrary file read | Snapshot built from an explicit file list under allowed roots; symlink refusal; path canonicalization before copy |
| Cost/DoS via huge projects | Snapshot size + file-count budget; build is synchronous, bounded, and cached by content hash |
| Stale/confusing state | Snapshot labels: project, commit-less content hash, build timestamp; "stale" badge when workspace mtime > snapshot time |
| Privilege confusion | Preview is READ-ONLY by definition. No reload-from-disk on interaction, no server-side includes |

## Capability contract

```
POST /api/preview/build { cwd }        → 202 { snapshotId } | 403 disabled | 413 budget
GET  /api/preview/:snapshotId/         → snapshot index.html (sanitized) — separate origin
GET  /api/preview/:snapshotId/:asset   → snapshot asset (mime-typed, path-canonicalized)
GET  /api/preview/capability           → { enabled, budgetBytes, maxFiles }
```

Enabled only with `ZCODE_ENABLE_PREVIEW=1` AND the snapshot origin configured
(`ZCODE_PREVIEW_ORIGIN`). Without both: 403 with the reason — the UI shows the
pane as unavailable, never as a broken iframe.
