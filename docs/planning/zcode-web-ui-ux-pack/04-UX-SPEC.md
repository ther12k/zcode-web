# UX specification

All dimensions below are proposed design targets. Source-derived reference colors are starting points, not certified contrast values. Capture approved rendered reference screens during implementation; none were supplied as image/video assets in this archive.

## 1. Information architecture

| Region | Required content | Optional later content |
|---|---|---|
| Navigation | Branding, New conversation, Search, projects, sessions, settings, global active-run indicator | Pins, hidden sessions, cross-project search |
| Workspace header | Current project and session, connection/run state, inspector toggle, overflow actions that actually exist | Real repository branch when available |
| Conversation | Logical messages, tool/artifact cards, inline errors, new-message affordance, anchored composer | Links into a read-only file/change inspector |
| Inspector | Activity, Artifacts, selected-item detail and capability explanations | Code, Changes, Preview |
| Footer/status | Compact connection and active-run summary; keyboard help | Verified Git branch/status, never a fake `.local` address |

The conversation is the primary task surface. The right pane is a context inspector, not a mandatory empty half-screen. Collapse it by default when no meaningful content exists, while keeping an obvious reopen control.

## 2. Layout targets

**Desktop, ≥1280 CSS pixels:** navigation initially 256 px, adjustable 220–320; main conversation minimum 420; inspector initially 420, adjustable 320–680. Use flexible allocation and clamp dimensions so saved preferences never create an unusable viewport. Header approximately 56 px; footer 28 px. Scroll each content region independently; the document shell itself should not accumulate horizontal overflow.

**Medium, 900–1279:** navigation collapses to a narrow rail or drawer. Conversation retains priority. Inspector is toggleable and may overlay or replace the conversation when both minimum widths cannot fit. Do not squeeze each pane into unreadable columns.

**Small, <900:** show conversation or inspector, not both. Navigation becomes a modal drawer. Header has navigation, current session and inspector actions. Keep a visible route back to the conversation. Use `100dvh`, safe-area insets and keyboard-aware composition; validate behavior on a real mobile browser as well as emulation.

**Reflow:** no loss of actions at 200% zoom; test equivalent 320-CSS-pixel reflow. Long paths, code and tables may scroll inside their own bounded container. Do not force the whole page to scroll sideways.

Resizing must support pointer drag and keyboard operation. The handle is a focusable separator with accessible name and current/min/max values. Provide arrow-key adjustment and an explicit Reset layout action. Do not claim an APG pattern reference alone guarantees conformance. [S12](12-SOURCES-AND-EVIDENCE.md#primary-ui-and-testing-sources).

## 3. Design system

| Token family | Direction |
|---|---|
| Backgrounds | Graphite app background, slightly darker navigation, raised composer/cards |
| Accent | Muted sage; reserve stronger emphasis for selected item and primary action |
| Text | Readable primary/secondary text; error/success labels also use words/icons |
| Type | System sans-serif default; 15–16 px conversation, 13–14 px UI, ≥12 px essential metadata |
| Spacing | 4 px base scale; fewer bordered boxes, consistent 8/12/16/24 px spacing |
| Corners | Restrained 6–10 px controls/cards, 12 px dialogs |
| Focus | Clear 2 px outline with offset, sufficient contrast in dark and light themes |
| Targets | 44×44 px product target for touch actions; compact visual glyphs may sit inside larger hit areas |
| Motion | 120–180 ms transitions where useful; disable nonessential animation with reduced-motion preference |

Reference starting colors: `background #1c1e20`, `sidebar #17191b`, `panel #1e2022`, `text #cdd1cd`, `accent #b3cfa1`. Re-test contrast after every theme/state change. Do not ship the reference's smallest text or copy its layered CSS overrides.

Use shadcn/ui as a source for primitives, not as the final visual design. Centralize button, icon button, badge, tooltip, dialog, menu, tabs, empty state, error state, skeleton and progress indicator styles. Do not use color alone to indicate running/failed/successful states.

## 4. Screens and interaction contracts

### S-01 Access and readiness

A 401 shows a dedicated access state with a password-style token field and explicit Continue action. Support password manager/autofill behavior appropriately; never place the token in the route. Default to memory-only storage. An explicit “Remember on this device” choice may persist it with a warning and a clear Forget action.

After access, show CLI present, provider configured, workspace root availability and active-job capacity as distinct facts. “Provider configured” is not “provider request verified.” Do not expose API keys. Unconfigured state links to actionable local setup documentation, not a false success toast.

### S-02 Empty workspace

Show Create project and Open configured project actions. Explain that projects are on the server, not automatically the user's laptop. Do not display fake recent sessions. A missing root is different from an empty root and must have a diagnostic state when the backend can report it.

### S-03 Project and session navigation

Show a project label, optional root qualifier when names collide, and expandable sessions ordered by recent activity. Rows have readable titles and status indicators. Keep running sessions discoverable even if not selected. Loading and failure belong to the affected group, not a full-screen spinner every time.

A click changes the route and selection. It does not mutate an active job's context. Before rendering a session under a project, validate the returned session directory against the project's canonical identity. Preserve back/forward behavior and deep-link refresh.

### S-04 New conversation

Display the chosen project, mode and model next to the composer. Useful example prompts may fill the draft but must not send automatically. A new draft has its own client identity; it does not claim a CLI session exists before the server reports one.

### S-05 Conversation and composer

Composer supports plain text, multiline input, paste/drop/file selection, attachment chips and one primary action. Enter sends; Shift+Enter inserts a newline; IME composition suppresses send. Shift+Tab remains normal reverse focus navigation. Show an option to prefer Ctrl/Cmd+Enter in settings for users who need it.

States: `empty`, `draft`, `uploading`, `ready`, `submitting`, `running`, `stopping`, `failed submission`. An attachment-only ready state enables Send. Empty text plus no attachments does not. Do not send while an attachment is unresolved or silently discard failed attachments.

Clear the accepted draft only after the server has accepted the request; protect edits typed while the request was in flight. Submission errors leave the draft recoverable. Disable duplicate activation immediately, then rely on server idempotency for ambiguous network results.

Model and mode selectors use real server choices. Do not duplicate the reference's default model list. Labels such as “Plan” describe the selected CLI mode, not a proven sandbox. High-risk modes require an explicit selection and visible risk label; do not silently restore a high-risk mode as the new safe default.

### S-06 Live run

Show run state near the current message and in the global indicator. Stream answer text in a stable message region; tool/activity status occupies its own component. Receiving text must not detach or overwrite the status component.

The visible session can change while the run continues. Live updates only affect their job/session keys. When the user returns, reconstruct the run from the store rather than replaying into a fresh unkeyed bubble.

Stop first becomes “Stopping…”. “Cancelled” appears only after terminal evidence; acknowledgement that a signal was requested is not sufficient. Explicitly distinguish a successful process from an agent-reported failure, and neither from successful tests.

### S-07 History and reading position

Load the latest page in chronological display order, keyed by durable message identity. Prepend older whole messages. Preserve the first visible message and offset when prepending; recalculate after images or details expand.

Follow the newest output only while the user is near the bottom. Scrolling up pauses automatic following and shows a “New output” button. Clicking it returns to the bottom and resumes following. Do not smooth-scroll for every text delta. Provide a nonvirtualized paged accessibility mode if virtualization prevents usable selection or screen-reader navigation.

### S-08 Tool and artifact inspector

Selecting a card opens the corresponding tab and detail. Display status, available timestamps, tool name and bounded output. Unknown events receive “Unsupported event” with safe diagnostics; no invented success state.

For `zcode-artifact://`, show “Desktop artifact — preview unavailable in this web client” with available MIME, size and kind. Do not show a download button without resolvable bytes. Uploaded raster images use authenticated byte fetches and locally created object URLs, never a bearer token query string. HTML/SVG/unknown active formats do not receive an unrestricted inline document renderer.

### S-09 Search and commands

Launch supports loaded-session filtering with the label “Search loaded sessions in this project.” Display a no-match state, not “No sessions exist.” The command palette includes navigation, layout, theme, help and new conversation. Only advertise keyboard shortcuts that are actually implemented and tested.

Default shortcuts: Ctrl/Cmd+K for the app palette, Escape to close the topmost overlay, and a documented non-browser-conflicting new-conversation shortcut such as Ctrl/Cmd+Shift+O. Verify platform collisions before finalizing. Do not hijack browser new-window commands or typing shortcuts inside editable controls.

### S-10 Settings

Sections: Appearance, Interaction, Connection/Access, About/Diagnostics. Theme supports system/dark/light. Draft persistence is opt-in. Local preferences have a Reset action. Forget credentials clears in-memory authentication, remembered token, query data, object URLs and sensitive run views; explain whether unsent drafts will also be cleared before doing so.

Diagnostics show build/API/CLI identity and safe error codes where available. Raw prompts, file contents, tokens, model keys and full SSE URLs are excluded from default diagnostic export.

### S-11 Optional read-only tools and preview

Code is explicitly read-only. Changes states whether it compares working tree against index or HEAD, and does not claim all changes were made by this run. Unsupported/binary/large files have useful messages.

Preview names the actual snapshot and supported format, not a fabricated localhost address. Device buttons change viewport size only; they do not claim real device testing. Display “Preview unavailable for this project” when runtime/build support is absent. Preview implementation stays disabled until ZWUI-034–036 are complete.

## 5. State copy catalogue

| Condition | Preferred copy | Avoid |
|---|---|---|
| Network lost | “Reconnecting. This run may still be active.” | “Done” or “Failed” without evidence |
| Cancel accepted | “Stopping…” | “Cancelled” before process/agent terminal state |
| Exit 0, no explicit test evidence | “Run finished” | “All tests passed” |
| New history pending persistence | “Refreshing session history…” | “All changes saved” |
| Expired job after restart | “Run outcome unavailable. Check session history before starting again.” | Automatic retry of the prompt |
| Metadata-only artifact | “Desktop artifact. Preview unavailable here.” | Broken image or guessed download path |
| Unsupported capability | “Not available on this server” with details | Clickable controls that fabricate results |
| Locally persisted draft | “Draft saved on this device” | “Synced” |
| Provider configured | “Provider configured” | “Connected” unless a relevant probe succeeded |
| Hidden session | “Hidden on this device” | “Archived in ZCode” |

## 6. Accessibility review checklist

Dialogs trap focus appropriately and restore it to the trigger; background content cannot be interacted with while modal. Menus and tabs implement keyboard behavior, not just ARIA attributes. Status announcements are restrained: announce transitions, not every token. Chat content remains selectable; code and tables have clear region labels and scroll affordances.

Test contrast, keyboard reachability, visible focus, zoom, touch targets, reduced motion and error association. Automated axe checks are one part of acceptance, not a complete accessibility certificate. [S10–S13](12-SOURCES-AND-EVIDENCE.md#primary-ui-and-testing-sources).
