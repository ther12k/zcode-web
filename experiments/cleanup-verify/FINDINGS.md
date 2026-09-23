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

## Remediation result (fix/cleanup-shutdown — implementation candidate)

Shipped in this branch (implementation candidate for review; NOT merged/deployed):
- server/cleanup.js — shared stop lifecycle: cohort capture BEFORE the first
  signal on ALL paths (cancel, timeout, shutdown), identity-checked
  (pid+starttime; pid-reuse NEVER signalled), individual TERM→SIGKILL
  escalation, terminated/incomplete verification; failures and unreadable
  enumeration are INCOMPLETE, never success; the target set is never widened.
- zcode.js — cancel/timeout route through stopJobWork (reasons preserved:
  timeout still settles "timeout"); terminal jobs keep cleanup targets;
  pendingCleanups set; admission gate (start() → 503 once draining).
- index.js — graceful shutdown: reject admission → server.close() (not
  awaited before cleanup) → drain ALL cleanups (incl. terminal-but-cleaning
  jobs) under ZCODE_SHUTDOWN_DRAIN_MS (default 8000 < compose's 10s grace) →
  closeAllConnections → exit 0 clean / 1 incomplete. Idempotent; a repeated
  signal shortens the remaining window instead of restarting it.

Evidence: tests/cleanup.test.mjs (7/7 — resistant-class termination, EPERM →
incomplete, pid-reuse guard, enumeration guard); six new server regressions
(81/0 suite; all six FAIL against 7acfa87 — verified on a temp old checkout);
real-CLI acceptance: A-ordinary, B-resumed, **D-shutdown(ordinary) PASS** —
graceful shutdown now stops owned work. /api/jobs exposes cleanup state.

**Scope of the candidate (acceptance wording):** this candidate adds
coordinated shutdown and best-effort termination of attributable,
identity-checked descendants. It does NOT guarantee termination of
job-created processes that lose their ancestry before capture. Exit 0 means
"shutdown completed under the documented snapshot policy — captured
descendants terminated; ownership coverage best effort", never "no
job-created process remains anywhere." The ORIGINAL resistant-tool finding
remains OPEN (the production-equivalent escaping case still FAILs).

**Remaining gap, precisely characterized (not claimed fixed):** real-CLI tools
invoked through a shell `setsid` are orphaned AT CREATION — recorded ancestry
marker → systemd → systemd — so no /proc-descent capture can attribute them
at any time. Fixture-level setsid (exec-in-place) IS captured and terminated;
the shell+setsid shape is not. cwd/env heuristics were considered and
REJECTED (production job cwds are user projects — an editor terminal would
match and be killed). Containment for this class requires an ownership
mechanism outside this patch's scope (per-job cgroup). Probe rows
A/C/D-sep on the real CLI are labeled REMAINING GAP in results.

## Review corrections (independent source review of f35fe02 — all four accepted & fixed)

The reviewer's probes (extracted methods + injected faults + real processes)
reproduced four candidate defects; fixes verified by mutation:

1. **P1 unknown-becomes-success**: readStat collapsed missing/unreadable/
   malformed to null and verification read null as "gone" → a live captured
   member whose stat turned unreadable was reported `terminated`. Fixed with
   a tri-state probeProc (absent / unknown / present+state): unknown at
   verification contributes to INCOMPLETE (survivor
   `identity-unknown-after-escalation`); snapshot unknown still flags
   enumerationIncomplete. Conservative signalling unchanged.
2. **P2 repeated signal = abandonment**: shortening the window left
   stopCohort's SIGKILL behind its 5s grace and process.exit() killed the
   host first. Fixed: handles gained idempotent `escalateNow()` (resolves an
   escalation gate; no recapture); shutdownDrain forces it on every still-
   pending cohort when the window ends, then a fixed 2s verification grace
   (covers the 1.2s verify; worst case still ≪ compose 10s) lets the REAL
   outcome settle before exit-code selection.
3. **P2 "cleanup complete" logged for settled-incomplete**: success label now
   requires `drained && incomplete === 0`; `drained` remains a diagnostic.
   Exit code logic unchanged (already honest).
4. **P2 zombie = "still executing"**: stat state preserved; state Z at
   verification is recorded as `unreaped` ("terminated; reaping outstanding")
   inside a `terminated` outcome — not a running survivor, no extra signals.

Test corrections: the identity test now drives stopCohort through capture →
mismatch/unknown injection (injected probe + recording kill) and asserts the
SIGNALS (only the legitimate capture-time TERM; no escalation to an
unvalidated/reused identity); the enumeration test now injects UNKNOWN
deterministically and asserts incomplete explicitly; new regressions for P1,
zombie classification, and escalateNow acceleration; a shortened-window
shutdownDrain integration test (drained=true, tool dead); the HTTP shutdown
test now uses the shared waitForVerifiedServer contract (nonce + child-exit
rejection + abortable deadline).

Mutation evidence (fixed code, each mutation reintroduces its defect):
- M1 unknown treated as gone → P1 test FAILS (+ enumeration test).
- M2 escalation identity-guard removed → mismatch test FAILS.
- M3 escalateNow no-op → acceleration test FAILS.
Suites after corrections: cleanup 10/10 · server 82/0 · unit 109/109 ·
browser 73/73. The escaping-tool (shell-setsid, orphaned before capture)
finding remains OPEN; cgroup containment remains a separate decision.
