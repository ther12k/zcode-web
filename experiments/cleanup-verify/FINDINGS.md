# Cleanup verification — our current CLI bridge (inv/cleanup-verify)

Investigation scope: does the production-equivalent prompt-mode invocation
leave tools running after cancellation, job timeout, or graceful server
shutdown? Bounded evidence + recommendation; NO implementation in this branch.

Identity: server commit 7acfa87 (worktree, real `server/index.js`) · CLI
`zcode-web/cli/zcode.cjs` 0.16.5 sha256 e9f1868c0fdb8635… · Node v24.11.0 ·
disposable profiles + allowlist env builder (no ambient credential vars — the
ACP experiment proved ANTHROPIC_* shadows ZCODE_API_KEY) · faithful UI path
(default model from /api/models → /api/chat) · observable triggers (tool start
marker), settlement and execution termination measured INDEPENDENTLY · harness
cleanup recorded separately, never counted as success · verified-clean start
(no leftover fixtures) · live deployment, production binary/home, session DBs
untouched.

## Verdicts

| Case | Fixture | Verdict | Evidence |
|---|---|---|---|
| A cancel, fresh | ordinary | **PASS** | settled `cancelled` 2.1s; heartbeat stopped; fixture pid dead |
| A cancel, fresh | separate-session, ignores SIGTERM | **FAIL** | settled `cancelled` 2.1s; heartbeat KEPT ADVANCING; fixture alive (harness killed it) |
| B cancel, resumed | ordinary | **PASS** | settled `cancelled` 1.8s; session identity retained; tool dead |
| C timeout 25s | ordinary | (turn completed pre-deadline) | job `succeeded` just before 25s — the runtime's OWN tool timeout (~11s of beats → tool dead) preempted the server mechanism; cleanup of the tool was correct |
| C timeout 60s | ordinary | (same — runtime-preempted) | `succeeded`; tool killed by the runtime's own supervision before any server deadline |
| C timeout 25s | separate-session | **FAIL** | server timeout FIRED (settled `timeout`); sep tool leaked — heartbeat advancing, alive |
| D graceful shutdown (SIGTERM to server) | ordinary | **FAIL** | server exited; owned tool KEPT RUNNING (beats advancing, alive ~4s watch; entire job orphaned) |
| D graceful shutdown | separate-session | **FAIL** | same, plus unreachable by any group signal |

## Mechanism (from recorded identities + traces)

1. **Prompt-mode tools run as their own session leader** — in every case the
   fixture had `pgid = sid = own pid`, distinct from the CLI's group. Linux
   group signalling (our SIGTERM escalation AND the timeout's group SIGKILL)
   can never reach them. The zcode.js comment ("signal the whole tree") is
   already partially ineffective for tools.
2. **What actually stops ordinary tools is the CLI's own supervision**: on
   cancel the CLI TERMs its tool children DIRECTLY (ordinary fixture dies;
   that is why A/B ordinary PASS), and the runtime enforces its own tool
   timeout (~10–20s) that kills ordinary tools regardless of the server
   deadline (why C-ordinary never reaches our timeout mechanism).
3. **The sep class — a tool that ignores SIGTERM in its own session —
   survives everything we do**: cancel, cancel escalation, server timeout.
   Same leak class the ACP experiment demonstrated on the app-server; now
   reproduced on OUR production-equivalent invocation.
4. **Graceful server shutdown performs NO job cleanup at all** (no SIGTERM
   handler in index.js): the CLI runs in a detached group, receives nothing,
   and the whole job — CLI and tools — keeps running orphaned. This one is
   strictly OUR bridge's gap (not native), and it fails even for ordinary
   tools.

## Comparison discipline

Our earlier green cancellation tests did not cover this case; this result
does not retroactively change their meaning. Likewise ACP's KEEP decision is
unaffected: both systems share the native own-session ownership property; the
shutdown gap is ours alone.

## Recommended remediation (separate task; smallest mechanisms first)

1. **Shutdown handler (fixes D, both fixture classes)**: on SIGTERM/SIGINT,
   cancel all non-terminal jobs via the existing `jobs.cancel()` (which
   already escalates) before exiting. ~15 lines in server/index.js.
2. **Descendant snapshot + targeted SIGKILL (shrinks A-sep/C-sep)**: when a
   job is cancelled/timed out, walk `/proc` for descendants of the job's CLI
   pid BEFORE signalling, and at the existing 5s escalation point SIGKILL any
   snapshot pids still alive. Honest boundary: a tool that daemonizes after
   the snapshot still escapes — document as accepted residual risk.
3. **Comment correction** in zcode.js spawn ("whole tree") to reflect the
   own-session reality, pointing at the snapshot mechanism.

Stop here per investigation scope: evidence + recommendation recorded;
implementation, merge, and deployment are separate decisions.
