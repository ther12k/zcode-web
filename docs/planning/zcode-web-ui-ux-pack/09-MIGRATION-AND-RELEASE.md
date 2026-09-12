# Migration, milestones and release gates

## 1. Migration strategy

Modernize in slices. Keep the existing server and add the new frontend beside the current static client. Do not combine a new conversation database, new CLI integration or backend framework migration with this change.

Use a proposed runtime selection such as `ZCODE_WEB_UI=legacy|modern`. Both choices use the same authorized API and CLI data. Ensure the legacy fallback has the fail-closed sanitizer guard before calling it a safe rollback. A rollback is not permission to reintroduce a known unsafe fallback.

The feature switch and dual asset trees are implementation requirements, not existing configuration. Keep them only through the migration period; removing the legacy tree should be a separately reviewed cleanup after the new frontend is established.

## 2. Milestones

| Milestone | Scope | Exit gate |
|---|---|---|
| M0 — Contracts and foundation | ZWUI-001–008; bring ZWUI-015 forward in parallel | Baseline fixtures, locked build, auth/contracts, immutable jobs and replay protocol approved. |
| M1 — Core workspace | ZWUI-009–022 | Real navigation/composer/history/inspector against the Node server; no production mocks. |
| M2 — Release readiness | ZWUI-023–027 | Required evidence, accessibility, packaging, rollback and usability review accepted. |
| M3 — Optional workspace tools | ZWUI-028–036 | Per-capability acceptance; preview requires security decision before implementation. |

Numeric issue order is not the dependency graph. Design tokens and build scaffolding can proceed while backend contracts are specified. UI mock fixtures may be used in development only, with production adapters unable to silently select demo mode.

## 3. Integration slices

**Slice A: safe baseline and app boot.** Capture current contracts and runtime evidence; remove unsafe missing-sanitizer fallback; introduce Vite and a read-only authenticated configuration page. Confirm no secret is emitted into the frontend bundle.

**Slice B: read-only workspace.** Route to projects/sessions, render logical history safely, add responsive shell and draft isolation. No new send flow is exposed until identity and contract tests pass.

**Slice C: real execution.** Connect composer, uploads, job acceptance and ticket-based streaming. Enforce request idempotency, server-side resume directory checks and transport/job state separation. Validate navigation during execution and recovery after lost responses.

**Slice D: inspection and polish.** Add activity/artifact details, command palette, settings, scroll restoration, theme, diagnostics and accessibility refinements. Keep Files/Changes/Preview hidden or clearly unavailable until capability acceptance.

**Slice E: production candidate.** Build in Docker, exercise real auth, verify static fallback and cache headers, gather performance/visual evidence, then perform a maintainer-authorized CLI smoke and rollback rehearsal.

## 4. Build and asset serving

Use a multi-stage Docker build on a compatible pinned Node 24 image. Install frontend dependencies from the lockfile, build assets, and copy only required output into the runtime stage. Keep CLI paths, volumes and environment contracts unchanged unless explicitly reviewed.

The server serves hashed assets with long-lived immutable caching; HTML is revalidated/no-cache so deployments select the right asset graph. APIs and stream credentials are not cached. Include correct MIME types for output fonts/assets actually shipped and apply `nosniff` where appropriate.

History fallback applies only to allowed application navigation routes and appropriate GET/HEAD HTML requests. It must not replace an API 404, missing JS asset or blocked filesystem path with `index.html`. Test refresh on a nested session route from the built production image.

A Vite development proxy is not a production reverse proxy. Do not start `vite dev` or rely on `vite preview` as the runtime service. Keep same-origin browser access so token handling and SSE remain coherent.

## 5. Rollout process

Begin with a maintainer-selected modern-UI trial, then make modern the default only after M2. Each candidate records source SHA, frontend artifact digest, Docker image digest, config mode, CLI version and the fixture/live evidence it passed.

Store the last safe image and configuration. Rollback selects that image/UI without restoring an older copy of the live CLI database or deleting project files. Preferences use versioned keys with backward-tolerant reads so rollback does not crash on new local data.

On rollout, show a build-change notification only when necessary; do not interrupt an active run merely to refresh the UI. Retained server jobs and replay protocol compatibility must be considered when changing server images. An epoch change after restart gets an explicit unknown/reconcile state.

## 6. Documentation changes

Update startup/dev/build instructions, environment settings, auth/media behavior, active-job limits, capability matrix, tested browser/platform versions and remaining artifact limitation. Replace a whole-project “zero dependencies” claim with the precise statement that the runtime Node server remains dependency-free, if still true after implementation.

Explain “files are on the server,” “draft saved on this device,” private access requirements, and differences between run completion, persisted history and test evidence. Do not copy simulated reference Git/terminal screenshots into documentation as if backed by actual functionality.

## 7. Stop conditions

Stop promotion on any cross-project contamination, duplicate CLI invocation, lost/duplicated replay, unsafe Markdown execution/fallback, leaked credential, writable history access, silent message truncation, broken authenticated health probe, or inability to roll back without changing project data.

For optional preview, stop at the design boundary until isolation and residual-risk decisions are approved. A polished empty preview tab does not justify weakening the core application's security policy.
