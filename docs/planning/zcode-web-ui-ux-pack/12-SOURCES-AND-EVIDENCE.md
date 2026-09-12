# Sources and evidence register

**Research/inspection date:** 12 September 2026.

## Evidence classification

| Classification | Meaning in this pack |
|---|---|
| User-reported | Maintainer reports fixes and browser/container verification at `f102cef`; not independently rerun here. |
| Source-observed | Inspected pinned public source or files from the uploaded archive. |
| Proposed | Product/architecture/task/acceptance requirement drafted here; not an implemented capability. |
| Not verified | Live CLI, provider calls, container build, reference browser render, screenshot fidelity, benchmark or test result not executed here. |

Planning baseline is **`f102cef`**, not a claim that this is still the latest branch head whenever the pack is later used. ZWUI-001 records the complete commit hash and current branch state before implementation. Public sources were read via web; a local Git clone failed because GitHub could not be resolved in the container.

## Uploaded reference

Filename: `clone-zcode-web-app.zip`.

SHA-256: `3f3e6bff98a447d908fc6c225eae3f1b0f24c424b89c30eaa696bb1f0e815729`.

The archive contains 41 entries including directories and 26 files. Source files were extracted with path-containment checks and inspected. It includes no supplied screenshot/video asset. `package.json`, components, CSS, reference API/agent/schema and smoke-test source were inspected. None was executed as the target application.

Key reference anchors:

| ID | File/section |
|---|---|
| U01 | `package.json`: reference framework, component and database dependencies |
| U02 | `src/components/workspace.tsx`: shell/navigation/dialog/selection state |
| U03 | `src/components/chat-panel.tsx`: composer, predefined activities, model/mode choices and Shift+Tab interception |
| U04 | `src/components/preview-panel.tsx`: pane tabs, preview, editing, snapshot history and command simulator |
| U05 | `src/components/workspace-dialogs.tsx`; `src/components/ui.tsx`: dialogs and basic primitives |
| U06 | `src/app/globals.css`: theme tokens, grids, small-screen overrides and focus styles |
| U07 | `src/app/api/workspace/route.ts`, commit action around lines 160–168: database snapshot with shortened random UUID, not Git commit |
| U08 | `src/lib/agent.ts`: direct provider path and local-demo fallback |
| U09 | `src/db/schema.ts`: reference persistence model |
| U10 | `scripts/smoke-test.mjs`: reference test source, not executed evidence |

## Repository sources

All links below are pinned to the planning commit where applicable.

| ID | Primary source | Used for |
|---|---|---|
| R01 | [README at f102cef](https://github.com/ther12k/zcode-web/blob/f102cef/README.md) | Product/runtime and CLI-owned storage boundary |
| R02 | [Commit f102cef](https://github.com/ther12k/zcode-web/commit/f102cef) | Maintainer-recorded change scope; reported verification remains reported |
| R03 | [server/index.js](https://github.com/ther12k/zcode-web/blob/f102cef/server/index.js) | Existing API integration points and ticket validation |
| R04 | [server/zcode.js](https://github.com/ther12k/zcode-web/blob/f102cef/server/zcode.js) | Job/CLI wrapper boundary and lifecycle integration |
| R05 | [server/sessions.js](https://github.com/ther12k/zcode-web/blob/f102cef/server/sessions.js) | History grouping, artifact summaries and query behavior |
| R06 | [public/app.js](https://github.com/ther12k/zcode-web/blob/f102cef/public/app.js) | Rendering, auth/media and event adaptation |
| R07 | [package.json](https://github.com/ther12k/zcode-web/blob/f102cef/package.json) | Existing package/runtime scope |

### Source-level caveats to carry forward

These are narrow static observations relevant to migration tests, not an independent certification of all previous findings.

**Renderer failure path:** the current renderer selects unsanitized HTML if the DOMPurify global is absent. Eliminate that branch and use a plain-text failure path. The normal sanitizer path and maintainer's browser tests are not being disputed. Owner: ZWUI-015. Source: R06, `renderMarkdown`.

**Ticket lifecycle wording:** current ticket validity is checked by job ID and expiry timestamp; the timestamp is calculated from the configured timeout plus a margin. Do not describe that as immediate invalidation at job completion. The proposed new contract makes the opening/retention policy explicit. Owner: ZWUI-008. Source: R03, ticket helpers.

**History completeness boundary:** logical-message grouping is present, but the query still caps part rows before grouping/paging. Very large histories can therefore be incomplete even though logical grouping works for the reported test session. Owner: ZWUI-018. Source: R05, `transcript` query.

## Primary technology sources

| ID | Source | Role in this proposal |
|---|---|---|
| S01 | [Vite guide](https://vite.dev/guide/) and [production build](https://vite.dev/guide/build) | Build tooling and static production output |
| S02 | [React: build an app from scratch](https://react.dev/learn/build-a-react-app-from-scratch) | Vite-based client application setup |
| S03 | [TanStack Router overview](https://tanstack.com/router/latest/docs/overview) | Routing and cache integration boundaries |
| S04 | [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview) and [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode) | Distinguish Router from optional full-stack framework |
| S05 | [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) | Deliberate retry/refetch/cache choices |
| S06 | [TanStack Virtual introduction](https://tanstack.com/virtual/latest/docs/introduction) | Optional long-list virtualization |
| S07 | [HTML iframe element / sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) | Preview isolation constraints |
| S08 | [Vite features](https://vite.dev/guide/features) | Build transformation versus independent type checking |
| S09 | [HTML Standard: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) | Event IDs and reconnection semantics |

## Primary UI and testing sources

| ID | Source | Role in this proposal |
|---|---|---|
| S10 | [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite); [shadcn/ui Vite setup](https://ui.shadcn.com/docs/installation/vite) | Official integration paths |
| S11 | [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility); [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Accessible primitive/focus behavior |
| S12 | [WAI window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/); [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) | Keyboard resizing, reflow, contrast and interaction targets |
| S13 | [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) | Automated checks plus manual-testing limits |
| S14 | [DOMPurify official repository](https://github.com/cure53/DOMPurify) | Sanitizer support, configuration and post-sanitization hazards |

Sources justify the technologies' capabilities and observed boundaries. The proposed architecture, budgets, priorities and tasks are design judgments, not statements that those sources mandate these exact choices. Resolve and pin actual package versions during implementation rather than assuming a documentation URL fixes a dependency version.

## GitHub registration sources

| ID | Source | Use |
|---|---|---|
| G01 | [GitHub CLI issue create](https://cli.github.com/manual/gh_issue_create) | Body files, labels, milestones and currently documented parent/dependency options |
| G02 | [GitHub CLI issue list](https://cli.github.com/manual/gh_issue_list) | Search across states and return actual issue identities |
| G03 | [GitHub CLI label create](https://cli.github.com/manual/gh_label_create) | Optional label preparation; existing repository conventions take precedence |

CLI feature availability must also be checked against the maintainer's installed version. No registration command was executed during preparation.
