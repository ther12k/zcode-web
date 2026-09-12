# ZCode Web — UI/UX upgrade task pack

**Prepared:** 12 September 2026 · **Status:** Proposed implementation plan, not an implementation or runtime certification.

**Recommendation:** Vite + React + TypeScript, TanStack Router and TanStack Query, Tailwind CSS and selected shadcn/ui primitives. Keep the existing Node 24 HTTP/SSE server and ZCode CLI integration. Do not adopt Next.js, TanStack Start, PostgreSQL, or the reference's replacement agent backend for this upgrade.

Vite and TanStack are complementary: the former builds the frontend; Router and Query organize navigation and server data. TanStack Start is a separate full-stack choice, unnecessary for this scope. See [the stack decision](03-STACK-DECISION.md).

## What this pack contains

| Document | Purpose |
|---|---|
| [Product requirements](01-PRD.md) | Product goals, scope, user journeys, requirements, acceptance targets |
| [Reference audit](02-REFERENCE-AUDIT.md) | What to borrow, adapt, and deliberately exclude from the supplied source |
| [Stack decision](03-STACK-DECISION.md) | Recommended libraries, alternatives, dependency policy |
| [UX specification](04-UX-SPEC.md) | Screens, layout, interactions, state copy, responsive behavior |
| [Architecture](05-ARCHITECTURE.md) | Component boundaries, state ownership, identity, storage, deployment |
| [API and event contracts](06-API-AND-EVENT-CONTRACTS.md) | Existing integration points versus explicitly proposed additions |
| [Security and privacy](07-SECURITY-AND-PRIVACY.md) | Regression guards, authentication, uploads, preview isolation |
| [Test and acceptance plan](08-TEST-AND-ACCEPTANCE-PLAN.md) | Test cases, fixtures, release evidence and performance budgets |
| [Migration and release](09-MIGRATION-AND-RELEASE.md) | Sequencing, coexistence, rollback and release gates |
| [Issue register](10-ISSUE-REGISTER.md) | 36 task bodies, six epics, dependencies and recommended filing order |
| [GitHub filing guide](11-GITHUB-FILING-GUIDE.md) | Labels, milestones, manual/CLI filing, duplicate prevention |
| [Sources and evidence](12-SOURCES-AND-EVIDENCE.md) | Source identities, primary documentation, verification limits |
| [Traceability](13-REQUIREMENTS-TRACEABILITY.md) | Requirements → tasks → tests |
| [Decision log](14-DECISION-LOG.md) | Defaults chosen now and decisions intentionally gated |

Every task has a stable `ZWUI-###` identifier, title, priority, scope, dependencies, implementation checklist, acceptance criteria, verification work and exclusions. These are **proposed IDs**, not existing GitHub issue numbers. No issues, pull requests or repository changes were created by preparing this archive.

## Delivery boundary

**Required launch scope:** ZWUI-001–027. Rebuild the workspace shell, navigation, composer, streaming conversation and activity/artifact inspector around real CLI behavior. Add the narrow backend contracts needed to make navigation and reconnection trustworthy.

**Optional post-launch scope:** ZWUI-028–036. Browser-local organization, server-wide search, read-only files/code, real Git changes, then a separately approved isolated static preview. Optional work does not block the core launch.

**Not included:** an operating-system terminal, file editing, Git commit/push, public sharing, hosted deployment, collaboration, a new conversation database, arbitrary app execution in the browser, or desktop artifact-byte reverse engineering.

The uploaded reference is useful visual and interaction material, not a backend specification. Its database snapshots and command simulator must not be presented as real Git or a real shell.

## Suggested starting order

Start with ZWUI-001 to capture the actual baseline, then scaffold ZWUI-002. Tokens ZWUI-005 and API/auth contract ZWUI-004 can proceed in parallel after scaffolding; bring fail-closed renderer ZWUI-015 forward once its token foundation is ready. Stabilize API/job/stream contracts before connecting the new UI to live runs. Follow the dependency graph rather than numeric order alone.

## Evidence boundary

The planning baseline is repository commit **`f102cef`** and the supplied `clone-zcode-web-app.zip`, SHA-256 **`3f3e6bff98a447d908fc6c225eae3f1b0f24c424b89c30eaa696bb1f0e815729`**. Reference components/CSS and pinned public repository source were inspected. The reference was not installed or browser-rendered; no deployed container, CLI execution or maintainer-reported browser result was independently retested. A local Git clone could not resolve GitHub; public source was read through the web instead.

All budgets, schemas labeled proposed, and acceptance results to be collected are requirements—not measurements already achieved. See [source notes](12-SOURCES-AND-EVIDENCE.md) for three source-level caveats retained as migration gates.
