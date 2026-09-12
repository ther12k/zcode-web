# Security and privacy requirements

## 1. Scope and trust model

This application is a trusted-operator interface to a CLI that can act on project files and run tools. A bearer token is not a multi-tenant identity system. Do not imply that a redesigned login screen makes it safe to expose the service to unrelated users.

Keep the documented private-network/VPN or equivalent access expectation until a separate access-control design is accepted. Preserve provider credentials on the server and the CLI-owned data boundary. [R01](12-SOURCES-AND-EVIDENCE.md#repository-sources).

The following requirements are launch gates or optional-feature gates. They are not a new runtime security certification.

## 2. Protected regression requirements

| Boundary | Required behavior |
|---|---|
| Markdown | All untrusted rendered HTML passes through the owned sanitizer boundary; missing/unsupported/failed sanitizer falls back to plain text. |
| Stored history | Same rendering policy as live output; model/desktop history is not trusted merely because it is persisted. |
| SSE | Bearer never appears in a URL; tickets bind to job/epoch and have explicit expiry; wrong-job/expired/legacy-token cases reject under protected mode. |
| Attachments | Attachment-only sends remain supported; invalid payloads and excess limits return actionable errors without corrupting state. |
| Media | Authenticated fetches produce owned object URLs; no bearer-bearing remote fetch or unrestricted HTML preview. |
| Pagination | A message remains associated with all its returned parts; truncation and schema failures are explicit. |
| Desktop artifacts | Metadata-only when unresolved; no guessing a host path from a custom URI. |

The normal sanitized path in `f102cef` is acknowledged. The source still conditionally uses raw HTML when the DOMPurify global is missing; ZWUI-015 eliminates that fallback rather than assuming a dependency can never fail to load. This is a source-level failure-path observation, not a claim that the maintainer's normal browser test was invalid. [R06](12-SOURCES-AND-EVIDENCE.md#repository-sources).

## 3. Content rendering policy

Use one Markdown component and one reviewed HTML insertion point. A string typed as “safe” in TypeScript is not sufficient evidence of sanitization. Bundle Marked and DOMPurify locally, test sanitizer support, and sanitize immediately before insertion. Do not modify sanitized markup with a second uncontrolled HTML transform. DOMPurify documents this post-sanitization risk. [S14](12-SOURCES-AND-EVIDENCE.md#primary-ui-and-testing-sources).

Default to an HTML-only profile with an explicit application policy: no scripts, event handlers, styles, iframes, forms or executable embedded content inside messages. Code fences remain text. Restrict links to appropriate non-executable schemes and add safe external-link handling. Render unknown/custom artifact schemes as metadata, not navigation. Consider remote Markdown images opt-in because they can contact third parties and leak request context; uploaded raster previews use the controlled path.

An active-format upload (HTML, SVG or unknown browser-executable document) must not be opened as trusted application-origin content. Prefer download or plain-text inspection. Add appropriate content-type and `nosniff`/disposition rules. A future preview sandbox is a different boundary and must not weaken chat sanitization.

## 4. Auth lifecycle and logs

Memory-only bearer storage is the default. Remembering on a device requires explicit opt-in and a clear explanation that browser compromise can expose the credential. No solution here makes a shared bearer per-user authorization.

On forget/credential change: close streams, abort pending authenticated requests, clear sensitive Query/run state, revoke object URLs and prevent late callbacks from repainting old content. Explain draft retention/clearing separately. Do not silently migrate a previous persistent token into remembered storage without the user's chosen policy.

Use exact relative API paths or a configured same-origin allowlist. Never automatically attach the bearer to an arbitrary artifact, URL or redirected cross-origin request. Avoid credentials in analytics, screenshots, exception text, proxy URLs or diagnostics. Ticket URLs are still secrets even though short-lived; redact them as well.

The app uses no default third-party analytics or CDN assets. All user-facing telemetry collection is local/opt-in and excludes prompt text, outputs, file contents, full paths, keys and ticket strings.

## 5. Stream and job integrity

A stream cursor is not an authentication mechanism. Job/epoch binding, bounded buffers, sequence validation and explicit replay reset are required. A reconnect does not resubmit a prompt. An unknown result after a server restart remains unknown until evidence resolves it.

Keep process exit, agent outcome and requested cancellation distinct. Reject cross-project resume requests on the server. Test process cleanup on the deployment platforms actually supported; do not infer process-tree termination from the parent PID exiting.

Short-lived ticket expiry and job completion are separate concepts. The proposed opening policy is in [the API contract](06-API-AND-EVENT-CONTRACTS.md). Preserve legacy token rejection without guessing that an unavailable ticket API means authentication can be bypassed.

## 6. Upload and resource limits

Publish limits through capabilities and validate them both client- and server-side. The server remains authoritative for byte count, count of files, permitted references and request size. The client should avoid reading an oversized file into memory before applying known limits. Base64 overhead and temporary decoded buffers belong in tests and resource budgets.

Drain rejected request bodies as appropriate so a 413 is delivered, while bounding memory and request time. Reject or explicitly handle safe-name collisions and names that cannot round-trip through the download endpoint. Do not silently drop the sixth attachment. Object URLs must be revoked after use.

Do not add an upload-delete API until ownership/retention semantics are defined; removing a composer chip only detaches it from the draft. Show no false claim that bytes were erased from the server.

## 7. Optional read-only filesystem and Git gates

Use server-selected project roots and validated relative paths. Reject traversal, encoded separator tricks, unexpected absolute paths and blocked locations. Resolve containment using canonical paths, then ensure safe opening under the supported platform; checking a string prefix once is not adequate protection against filesystem changes. Default-deny symlinks unless a tested, containment-preserving policy is approved.

Block sensitive files/directories by policy, restrict text/binary/byte size, and return truncation metadata. This is defense in depth, not a guarantee that any arbitrarily named file is non-sensitive. Do not bulk-upload the workspace to preview or diagnostics.

Git reads use controlled argument arrays and explicit comparison modes. Disable external diff and text-conversion behavior, avoid shell interpolation and bound output/time. Tests must confirm no workspace mutation or hook execution. Attribute changes to the working tree/base comparison, not automatically to an agent session.

## 8. Optional preview gate

No arbitrary generated HTML executes in the authenticated app DOM or on its trusted origin. Use a separate untrusted-content origin and a sandboxed iframe with only required capabilities. Do not combine trusted-origin privileges with script execution. The frame receives a reviewed public-file snapshot, no bearer, no provider key, no unrestricted filesystem path and no privileged command channel.

Define a strict content policy and validate any cross-frame messages by origin/source/session identity and schema. Do not interpret a message from a sandbox's opaque origin as trusted solely because its origin string is `null`. Validate the exact source window and a scoped capability/nonce where communication is necessary.

An iframe sandbox is **not** a universal network-egress, CPU or memory sandbox. Network restrictions, child navigation, external resources, infinite loops and browser process behavior need explicit tests and residual-risk documentation. Avoid claiming “no network possible” from a CSP snippet alone. Do not build a generic server-side preview URL proxy.

The initial optional preview supports approved static HTML/CSS/JS snapshots only; no npm install, backend server, arbitrary Wasm execution or live command runner. Unsupported projects remain unsupported rather than receiving a fabricated preview. See [the standards reference](12-SOURCES-AND-EVIDENCE.md#primary-technology-sources).

## 9. Release security evidence

Attach fixture/browser/API results with candidate source identity, build digest, environment, CLI version when relevant and exact test command. Verify token-protected Docker mode, not only tokenless local mode. Capture no sensitive transcript in public test artifacts. A passing static scan or this PRD does not replace browser/auth/stream tests.
