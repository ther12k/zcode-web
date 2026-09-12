# Decision log and assumptions

| ID | Decision/default | Rationale | Revisit condition |
|---|---|---|---|
| D01 | Vite + React + TypeScript | Fits reference component model and retained API | Measured need that another UI runtime addresses |
| D02 | TanStack Router + Query, not Start | Useful navigation/cache layers without full-stack migration | Deliberate SSR/server-function product requirement |
| D03 | Keep Node 24/CLI/database | Avoid changing execution and persistence while redesigning UI | Separate backend ADR and evidence |
| D04 | Tailwind + owned tokens + selected primitives | Consistency and accessible interactions without cloning all CSS | Measured library or maintenance problem |
| D05 | Reducer/subscribed run store; no mandatory Zustand | Explicit state ownership, fewer redundant stores | State complexity demonstrably benefits from one library |
| D06 | Keep Marked + DOMPurify, make boundary fail closed | Preserve existing Markdown behavior and security work | A separately tested AST renderer migration |
| D07 | Session ≠ run ≠ selected view | Prevent retargeting and false status | Never collapse these identities for convenience |
| D08 | Same-origin production frontend/API | Preserve simple auth/SSE deployment | Separately designed hosting and credential flow |
| D09 | Activity/Artifacts first | Real data available through target integration | Code/Git/Preview capabilities pass optional gates |
| D10 | Metadata-only desktop artifacts | No verified byte resolver | Published or verified stable resolver contract |
| D11 | Read-only files/Git first | Useful inspection with smaller mutation surface | Separate write/commit/terminal design |
| D12 | No simulated Git/terminal/progress | UI status must reflect actual evidence | Simulations may exist only in clearly isolated development fixtures |
| D13 | Memory auth and drafts by default | Reduce automatic sensitive-data persistence | Explicit user opt-in device policy |
| D14 | Optional static preview after security design | Untrusted generated content has different trust needs | Approved isolated snapshot contract and residual risks |
| D15 | New protocol version alongside legacy | Permit controlled migration and rollback | Legacy cleanup after modern release acceptance |
| D16 | No automated GitHub issue creation in this deliverable | User requested materials to register later | Explicit later authorization to create issues |

## Assumptions to validate without blocking the initial plan

The main intended deployment remains a trusted self-hosted instance. Node 24 remains the chosen backend runtime. The user prefers the reference's visual direction but not its Next.js/backend implementation. The CLI API/database shape must be checked against the installed CLI version; this pack does not assume a supported schema based only on historical source comments.

No exact deadline, staffing allocation or performance measurement was provided. Task sizes therefore use relative review scope rather than calendar estimates. Owners are role suggestions, not assignments to named people.

## Choices deliberately not made

No public-sharing permission model, tenant boundary, terminal protocol, file-write conflict policy, Git write flow, generic dev-server manager, billing/deployment plan or custom desktop artifact resolver is specified. These features require separate product/security decisions rather than empty working-looking buttons.

An optional preview is not a promise that arbitrary React/Node/Rust/Wasm projects can execute without a server. The initial extension is deliberately bounded to supported static snapshots.
