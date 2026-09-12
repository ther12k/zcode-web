# Reference audit and reuse plan

## Input identity and inspection limit

Input: `clone-zcode-web-app.zip`, SHA-256 `3f3e6bff98a447d908fc6c225eae3f1b0f24c424b89c30eaa696bb1f0e815729`.

The archive contains a source application, not screenshots or a video: React components, Next.js routes, CSS, PostgreSQL/Drizzle code and a Playwright smoke script. This analysis is based on those files. The app was not installed or browser-rendered, and the smoke script was not executed. Therefore “reference behavior” below means implemented or described in source, not independently observed runtime success.

## What the source represents

| Area | Source location | Observation |
|---|---|---|
| Platform | `package.json` | Next.js 16.2.6, React 19.2.6, PostgreSQL and Drizzle; Tailwind is available, with extensive custom CSS. These are archive versions, not recommended fresh pins. |
| Workspace | `src/components/workspace.tsx` | Project/session views, pinning, grouping, sorting, task actions, themes, sidebar/inspector toggles and dialogs. |
| Conversation | `src/components/chat-panel.tsx` | Composer, context controls, model/mode menus, collapsible details and change-summary cards. |
| Inspector | `src/components/preview-panel.tsx` | Preview/Code/Changes tabs, device sizing, text editing, snapshot history and a limited command simulator. |
| Dialogs | `src/components/workspace-dialogs.tsx` | Search, workspace/task creation, appearance/provider preferences, shortcuts and additional UI actions. |
| Presentation | `src/app/globals.css` | Graphite/sage palette, grid layout, light theme, responsive overrides and reduced-motion rules. |
| Agent | `src/lib/agent.ts` | Optional direct provider request plus deterministic local-demo responses; not the existing CLI adapter. |
| Persistence | `src/db/schema.ts`; `src/app/api/workspace/route.ts` | Reference-specific project/file/task/message tables and database snapshots. |
| Testing | `scripts/smoke-test.mjs` | Reference smoke scenarios; useful inspiration, not evidence for this repository. |

## Borrow the interaction language

Keep the three-region hierarchy, visible current context, collapsible navigation, coherent tool cards, an anchored composer, an inspector that can expand, clear active states, project/session search, and settings dialogs. Use subtle rather than saturated colors. Keep status close to the relevant operation.

The reference's base palette includes background `#1c1e20`, sidebar `#17191b`, panel `#1e2022`, primary text `#cdd1cd` and accent `#b3cfa1`. Treat these as visual starting points, then test every actual text/background and focus combination; their presence in source does not establish accessibility. The new token system should consolidate repeated CSS overrides instead of copying the stylesheet wholesale.

## Adapt, rather than copy

| Reference feature | Adaptation for real zcode-web |
|---|---|
| “Task” object | Display a conversation/session; a CLI job is one execution within it. Do not merge task status and job status. |
| Fixed model choices | Populate models from the existing configuration API. Do not hardcode reference model names. |
| “Auto edit / Plan / Ask” | Show server-supported modes. Do not silently map Ask to a write-capable mode or invent permission guarantees. |
| “All changes saved” | Show only when the relevant persistence operation is confirmed; distinguish local draft, submitted run and loaded history. |
| Collapsible thinking/activity | Render only actual returned event data, with appropriate labels; never synthesize a progress narrative. |
| Composer attachments | Preserve the target repo's multiple-file, attachment-only and authenticated-image behavior; the reference's text-file path is not sufficient. |
| Snapshot “commit” UI | Omit from launch. Later show real Git status/diff with explicit source and scope, without commit actions. |
| Preview | Separate capability and security project; not a claim that any CLI-produced project can run in an iframe. |
| Pin/archive/rename | Later, browser-local pin/hide/display aliases; no direct desktop database mutations. |
| Share button | Omit. Copying a private route is not creating public access. |

## Reference-only behavior that must not become a production claim

In `src/app/api/workspace/route.ts`, the commit action writes file snapshots to the reference database and uses a shortened random UUID as its displayed hash. It does not create a Git commit. The terminal in `preview-panel.tsx` interprets a small command set against reference data; it explicitly describes itself as a read-only workspace shell, not an OS terminal.

The reference agent has a local-demo path when no provider key is present. Its live path calls a model provider directly and accepts a constrained set of files. Adopting it would replace rather than improve the existing ZCode CLI integration.

`chat-panel.tsx` contains predefined activity labels and a shortcut that intercepts Shift+Tab for mode selection. Do not transplant the predefined activity as evidence or the shortcut at the expense of reverse keyboard navigation. It also requires text in its send function, so copying it literally would reintroduce an attachment-only regression.

The base CSS and narrow-screen overrides use some very small text sizes and controls. Preserve density through spacing and progressive disclosure, not by shrinking necessary text to 7–10 pixels. The CSS references a local font URL not included among the archive's public assets; provide a system-font fallback and verify packaged assets rather than copying that assumption.

## Reuse strategy

**Reimplement the shell and small presentation components** using a clean token system and accessible primitives. These carry the most design value with the least behavioral coupling.

**Port selected JSX concepts** only after replacing Next-specific imports, server assumptions and the reference's workspace data model. Remove `use client` directives where irrelevant to the client-only build; do not port server routes.

**Do not import** `src/db`, the reference agent, template/demo persistence, fake commit history or terminal command handling. Reference smoke scenarios may be rewritten as tests against the new contracts, but must not be copied as a proof of correctness.

## Fidelity acceptance

Compare the implemented shell to this source-derived design direction on desktop, tablet and mobile. Validate hierarchy, spacing, density, pane behavior, typography, accent usage and state clarity. No pixel-perfect claim can be made until maintainers capture an approved reference render. ZWUI-005 and ZWUI-025 require that approval evidence; they do not assume it already exists.
