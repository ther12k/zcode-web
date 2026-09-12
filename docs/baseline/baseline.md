# Implementation baseline (ZWUI-001 evidence)

Recorded 2026-09-12 11:07 UTC.

| Item | Value |
|---|---|
| Planning baseline (pack) | f102cef |
| Current main HEAD | f102cef328281a403fa541610a93fb87ccf71606 |
| CLI bundle version | 0.16.5 (zcode.cjs, sha256 e9f1868c0fdb8635…, not committed — BYO) |
| Server runtime (current) | Node v24.11.0, zero runtime deps |
| Deployment modes | (a) Node server + volume (docker-compose.yml), (b) Node server + host bind mounts (docker-compose.host.yml) |
| Session store | CLI-owned ~/.zcode/cli/db/db.sqlite (read-only from web) |
| Auth | bearer ZCODE_WEB_TOKEN; SSE via short-lived job-scoped tickets |

## Already-reproduced behaviors (regression cases ZWUI-001 requires)

| Behavior | Evidence |
|---|---|
| Safe Markdown rendering (DOMPurify, vendored) | commit f102cef; browser test: onerror/javascript: stripped, bold preserved |
| Attachment-only send default prompt | API test: turn.started carried "Analyze the attached file(s)." |
| Ticketed SSE (no URL bearer) | API test: ticket works, wrong ticket 401, legacy ?token= 401 |
| Upload validation (strict base64, size, name sanitize, out-of-dir reject) | API tests in session log; 413/400 paths |
| MIME map for media previews | GET /api/uploads/t.jpg → image/jpeg |
| Logical-message pagination (text+tools+files grouped per message) | API test on 460-message session |
| Headless CLI contract | --prompt/--output-format stream-json/--cwd/--mode/--resume/--attach; event envelope in sse-samples.jsonl |

## Known limitations (documented, not bugs)

- zcode-artifact:// persisted artifacts render metadata-only (no stable on-disk byte mapping).
- --max-turns is accepted by --help but rejected by the CLI 0.16.5 parser.
- Z.AI start-plan providers are captcha-gated headless (model dropdown labels disambiguate).

## Open migration gates (link to issues)

- Missing-sanitizer fallback path → ZWUI-015 (#10)
- Ticket expiry wording / resumable SSE v2 → ZWUI-008 (#14)
- Pre-pagination part cap (LIMIT 2000 rows) → ZWUI-018 (#15)
- HTTP layer migration → Lugas gate (#43)
