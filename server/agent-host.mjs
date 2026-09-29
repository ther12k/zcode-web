// Long-lived `agent-server` hosts for the ZCode Protocol bridge (Path 2).
//
// One agent-server process per workspace directory (cwd), reused across chat
// jobs and sessions. This is the architecture the official desktop/web stack
// uses (services/zcode-agent/zcodeAgentProcessManager spawns
// `<bundle> app-server --stdio` per workspace), and it is what gives us
// NATIVE cancellation: `session/stop` aborts the turn and tree-kills its
// tools inside the CLI (verified pinned on 0.16.9, experiments/
// native-stop-eval) WITHOUT killing the process or the session.
//
// The protocol process registry does NOT read the legacy cli/config.json
// provider map — it requires (runtime-paths.ts):
//   ZCODE_BUILTIN_PROVIDER_CONFIG_FILE  → staged next to the bundle
//   ZCODE_PERSONAL_PROVIDER_CONFIG_FILE → v4 provider_config.json
// translateLegacyProviders() regenerates that file from the legacy config
// our users edit, so both engines share one provider source of truth.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProtocolClient } from "./protocol-client.mjs";

const KIND_TO_API_TYPE = {
  "openai-compatible": "openai-chat-completions",
  openai: "openai-responses",
  anthropic: "anthropic-messages",
};

/** Legacy cli/config.json `provider` map → v4 provider_config.json shape.
 *  Best-effort field mapping; unknown kinds are skipped (not dropped
 *  silently — see translate() result). */
export function translateLegacyProviders(legacyCfg) {
  const providers = legacyCfg?.provider || {};
  const rules = [];
  const modelRules = [];
  const skipped = [];
  for (const [id, p] of Object.entries(providers)) {
    const apiType = KIND_TO_API_TYPE[p?.kind];
    if (!apiType) {
      skipped.push(`${id} (kind ${p?.kind})`);
      continue;
    }
    const modelIds = Object.keys(p?.models || {});
    rules.push({
      providerId: id,
      providerName: p.name || id,
      config: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: p?.options?.apiKey ?? "" },
        api: { type: apiType, baseUrl: p?.options?.baseURL ?? "" },
        ...(modelIds.length
          ? { personalModelIds: modelIds, modelOrder: modelIds }
          : {}),
      },
    });
    // per-model reasoning variants become explicit option specs so a model
    // selection on session/send can resolve (the registry demands a level
    // whenever the merged spec declares values)
    for (const [modelId, m] of Object.entries(p?.models || {})) {
      const variants = m?.reasoning?.variants;
      if (!Array.isArray(variants) || variants.length === 0) continue;
      const values = variants
        .map((v) => (typeof v === "string" ? v : v?.id ?? v?.value))
        .filter((v) => typeof v === "string" && v.length > 0);
      if (values.length === 0) continue;
      modelRules.push({
        providerId: id,
        modelId,
        config: { optionSpecs: { reasoningLevel: { values, map: "{}" } } },
      });
    }
  }
  let defaultModelSelection;
  const main = legacyCfg?.model?.main || (typeof legacyCfg?.model === "string" ? legacyCfg.model : null);
  if (typeof main === "string") {
    const ref = main.startsWith("builtin:") ? main.slice("builtin:".length) : main;
    const slash = ref.indexOf("/");
    if (slash > 0 && providers[ref.slice(0, slash)]) {
      defaultModelSelection = { providerId: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
    }
  }
  return {
    skipped,
    doc: {
      schemaVersion: 1,
      config: {
        providerConfigRules: { providerRules: rules },
        modelConfigRules: { providerModelRules: modelRules, manualProviderModelRules: [] },
        ...(defaultModelSelection ? { defaultModelSelection } : {}),
      },
    },
  };
}

/** Resolve the builtin provider config the 0.16.9 bundle requires.
 *  Honors the upstream env var name first (tests and non-standard layouts),
 *  then the staged-next-to-bundle path, then a local desktop install. */
export function resolveBuiltinProviderPath(cliEntry) {
  const fromEnv = (process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE || "").trim();
  const candidates = [
    fromEnv,
    join(dirname(cliEntry), "provider", "zcode-builtin.json"), // staged layout (this repo's image)
    "/opt/ZCode/resources/config/provider/zcode-builtin.json", // desktop install
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export class AgentHost {
  constructor({ cwd, cliNode, cliEntry, zcodeHome, stderrSink, log }) {
    this.cwd = cwd;
    this.zcodeHome = zcodeHome;
    this.sessions = new Map(); // sessionId -> {mode}
    this.modelLevels = new Map(); // sessionId -> Map("provider/model" -> default level)
    this.listeners = new Set(); // (notification) => void  (session/event routing)
    this.lastUsedAt = Date.now();
    this.log = log || (() => {});
    this.client = new ProtocolClient({
      command: cliNode,
      args: [cliEntry, "agent-server"],
      cwd,
      env: this.buildEnv(cliEntry),
      onStderr: stderrSink,
      onNotification: (n) => this.handleNotification(n),
      onServerRequest: (req) => this.answerServerRequest(req),
    });
    this.client.exitedPromise.then((info) => {
      for (const listener of this.listeners) {
        try {
          listener({ method: "__host_exited", params: info });
        } catch { /* listener errors must not break cleanup */ }
      }
    });
  }

  buildEnv(cliEntry) {
    const builtinPath = resolveBuiltinProviderPath(cliEntry);
    if (!builtinPath) {
      throw Object.assign(
        new Error("agent engine requires a builtin provider config (zcode-builtin.json) staged next to the CLI bundle"),
        { status: 503 },
      );
    }
    const webDir = join(this.zcodeHome, "web");
    mkdirSync(webDir, { recursive: true });
    const personalPath = join(webDir, "provider_config.json");
    this.refreshPersonalConfig(personalPath);
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinPath,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
    };
  }

  /** Regenerate the v4 personal config when the legacy config changed. */
  refreshPersonalConfig(personalPath) {
    const legacyPath = join(this.zcodeHome, "cli", "config.json");
    let legacyMtime = 0;
    let legacy = {};
    try {
      legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
      legacyMtime = statSync(legacyPath).mtimeMs;
    } catch {
      // no/invalid legacy config → empty provider set (create/send will fail
      // with the CLI's own selection error, which surfaces to the user)
    }
    let cacheMtime = 0;
    try {
      cacheMtime = statSync(personalPath).mtimeMs;
    } catch { /* not written yet */ }
    if (legacyMtime && cacheMtime >= legacyMtime) return;
    const { doc, skipped } = translateLegacyProviders(legacy);
    if (skipped.length) this.log(`agent-host: skipped legacy providers without a v4 api type: ${skipped.join(", ")}`);
    writeFileSync(personalPath, JSON.stringify(doc, null, 2));
  }

  handleNotification(n) {
    this.lastUsedAt = Date.now();
    // model/reasoning availability rides on state patches — cache it on the
    // HOST (not per job) so later turns can resolve selections immediately
    if (n.method === "state.updated" && Array.isArray(n.params?.patch?.model?.available)) {
      this.absorbModelLevels(n.params.sessionId, n.params.patch.model.available);
    }
    for (const listener of this.listeners) {
      try {
        listener(n);
      } catch { /* subscriber errors must not break routing */ }
    }
  }

  absorbModelLevels(sessionId, available) {
    if (!sessionId || !Array.isArray(available)) return;
    let levels = this.modelLevels.get(sessionId);
    if (!levels) {
      levels = new Map();
      this.modelLevels.set(sessionId, levels);
    }
    for (const m of available) {
      const ref = m?.ref ? `${m.ref.providerId}/${m.ref.modelId}` : null;
      const level = m?.reasoning?.defaultLevel ?? m?.reasoning?.levels?.[0]?.value;
      if (ref && level) levels.set(ref, level);
    }
  }

  levelFor(sessionId, modelRef) {
    return this.modelLevels.get(sessionId)?.get(modelRef) ?? null;
  }

  /** Host duties the protocol demands (desktop host implements these too). */
  answerServerRequest({ method, params }) {
    if (method === "session/requestRuntimePreferences") {
      return { nativeSearchEnhancementsEnabled: false, memoryEnabled: false };
    }
    if (method === "interaction/requestPermission") {
      // The workflow run confirmations are always-ask on the protocol (any
      // permission mode asks). The desktop answers them with a dialog; this
      // bridge has none, and denying means web sessions could NEVER run a
      // workflow. Auto-allow exactly the two run-affecting kinds (create/
      // amend + resume); every other escalation stays denied. ZCODE_AGENT_DWF=0
      // — the same switch that disables the tool cluster — restores deny.
      const kind = String(params?.kind || params?.permission || "");
      if (process.env.ZCODE_AGENT_DWF !== "0" && (kind === "createWorkflow" || kind === "resumeWorkflowRun")) {
        return { decision: "allow" };
      }
      // The web bridge does not mediate permission prompts. Session MODE
      // already encodes the policy (plan is read-only, yolo allows all);
      // anything the runtime still escalates to the host is denied.
      return { decision: "deny", reason: "denied by zcode-web bridge (no interactive permission UI)" };
    }
    if (method === "interaction/requestUserInput") {
      return { action: "cancel", reason: "cancelled by zcode-web bridge (no interactive input UI)" };
    }
    return {};
  }

  /** Wait for storage/registry startup, then create-or-resume a session.
   *  strict: a failed resume throws instead of creating a fresh session. */
  async ensureSession({ resumeId, mode, strict = false }) {
    // storage migration can take a moment on first boot of a new CLI version
    await this.client.request("runtime/capabilities", {}, 30_000).catch(() => null);
    const captureLevels = (result, sessionId) => {
      const avail = result?.projection?.model?.available;
      if (Array.isArray(avail)) this.absorbModelLevels(sessionId, avail);
    };
    // the dynamic-workflow tool cluster is FAIL-CLOSED on the protocol: the
    // CLI registers it only when the host passes dynamicWorkflowEnabled on
    // create/resume (the desktop is the policy decider — here, WE are).
    // ZCODE_AGENT_DWF=0 is the kill switch.
    const dwf = process.env.ZCODE_AGENT_DWF === "0" ? {} : { dynamicWorkflowEnabled: true };
    let sessionId;
    if (resumeId) {
      try {
        const r = await this.client.request("session/resume", { sessionId: resumeId, ...dwf });
        this.sessions.set(resumeId, { mode });
        captureLevels(r, resumeId);
        sessionId = resumeId;
      } catch (e) {
        if (strict) throw e;
        // unknown/expired session id → fall through to a fresh create
        this.log(`agent-host: resume ${resumeId} failed (${e.message}); creating fresh session`);
      }
    }
    if (!sessionId) {
      const r = await this.client.request("session/create", {
        workspace: { workspacePath: this.cwd, workspaceKey: this.cwd },
        ...(mode ? { mode } : {}),
        ...dwf,
      });
      sessionId = r?.sessionId ?? r?.session?.sessionId;
      if (!sessionId) throw new Error("agent-server did not return a sessionId");
      this.sessions.set(sessionId, { mode });
      captureLevels(r, sessionId);
    }
    // session/event delivery is OPT-IN: without a subscription the terminal
    // turn events only surface on the computer-use/v4 channels and the
    // bridge would never see turn.completed/turn.failed
    await this.client.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous" })
      .catch((e) => this.log(`agent-host: subscribe for ${sessionId} failed: ${e.message}`));
    // deterministic model metadata (reasoning levels) before the first send
    const read = await this.client.request("session/read", { sessionId }).catch(() => null);
    captureLevels(read, sessionId);
    return { sessionId, resumed: Boolean(resumeId && sessionId === resumeId) };
  }

  async setMode(sessionId, mode) {
    await this.client.request("session/setMode", { sessionId, mode });
  }

  async send(sessionId, content, modelSelection) {
    const r = await this.client.request("session/send", {
      sessionId,
      content,
      ...(modelSelection ? { modelSelection } : {}),
    });
    return r ?? {};
  }

  /** Native stop: aborts the active turn, tree-kills ITS tools, keeps the
   *  process and session alive (the whole point of Path 2). */
  async stop(sessionId) {
    try {
      await this.client.request("session/stop", { sessionId }, 10_000);
      return true;
    } catch {
      return false;
    }
  }

  /** Compact the session's history (protocol session/compact). Requires the
   *  session materialized on THIS host and no active turn. Compaction runs a
   *  model summarization call, so the budget is minutes, not seconds. */
  async compact(sessionId, instructions) {
    return this.client.request("session/compact", {
      sessionId,
      ...(instructions ? { instructions } : {}),
    }, 180_000);
  }

  /** Fork the session at a message boundary (protocol session/fork). The
   *  session must be idle; the CLI copies history up to and including the
   *  target message into a NEW persisted child session (same directory), so
   *  it appears in the sidebar through normal listing. No target = fork from
   *  the latest checkpoint (the protocol's default). */
  async fork(sessionId, target) {
    return this.client.request("session/fork", {
      sessionId,
      ...(target?.kind === "message" && target.messageId
        ? { target: { kind: "message", messageId: String(target.messageId).slice(0, 128) } }
        : {}),
    }, 60_000);
  }

  /** Read-only journal queries (v4 conversation face) only need the session
   *  materialized on this host — a session we already hold (e.g. one with a
   *  turn streaming right now) must NOT be resumed again just to be read. */
  async ensureReadSession(sessionId) {
    if (this.sessions.has(sessionId)) return;
    await this.ensureSession({ resumeId: sessionId, strict: true });
  }

  /** Dynamic-workflow runs of a session (journal-backed, restart-durable).
   *  Read-only: safe while a turn is running. */
  async workflowRuns(sessionId) {
    return this.client.request("v4/conversation/workflowRuns", { sessionId, limit: 64 }, 15_000);
  }

  /** User-facing artifacts a run published (full journal records: versions,
   *  preset specs, report counts). Read-only. */
  async workflowRunArtifacts(sessionId, runId) {
    return this.client.request("v4/conversation/workflowRunArtifacts", { sessionId, runId }, 15_000);
  }

  /** Report items feeding a preset board (chart/table/metrics/board). */
  async workflowRunArtifactData(sessionId, runId, artifactId, afterSequence) {
    return this.client.request("v4/conversation/workflowRunArtifactData", {
      sessionId, runId, artifactId,
      ...(afterSequence != null ? { afterSequence } : {}),
      limit: 500,
    }, 15_000);
  }

  /** Full bytes of a content artifact version (file/markdown), assembled
   *  from ≤512 KiB base64 chunks. Hard cap 15 MiB — the engine's own cap. */
  async readWorkflowArtifact(sessionId, runId, artifactId, version) {
    const chunks = [];
    let offset = 0;
    let mediaType = "application/octet-stream";
    let totalBytes = 0;
    for (let i = 0; i < 40; i++) {
      const r = await this.client.request("v4/conversation/workflowRunArtifactRead", {
        sessionId, runId, artifactId, version, offset, limit: 512 * 1024,
      }, 30_000);
      mediaType = typeof r?.mediaType === "string" && r.mediaType ? r.mediaType : mediaType;
      totalBytes = Number(r?.totalBytes) || totalBytes;
      if (typeof r?.dataBase64 === "string" && r.dataBase64) chunks.push(Buffer.from(r.dataBase64, "base64"));
      if (typeof r?.nextOffset !== "number" || !r.nextOffset || r.nextOffset <= offset) break;
      offset = r.nextOffset;
      if (offset > 15 * 1024 * 1024) throw new Error("workflow artifact exceeds 15 MiB read cap");
    }
    return { data: Buffer.concat(chunks), mediaType, totalBytes };
  }

  async close(sessionId) {
    this.sessions.delete(sessionId);
    try {
      await this.client.request("session/close", { sessionId }, 5000);
    } catch { /* best effort */ }
  }

  get exited() {
    return this.client.exited;
  }

  async dispose() {
    for (const sessionId of [...this.sessions.keys()]) await this.close(sessionId);
    await this.client.dispose();
  }
}

/** cwd → AgentHost registry with idle reaping and crash clearance. */
export class AgentHostRegistry {
  constructor({ cliNode, cliEntry, zcodeHome, idleMs = Number(process.env.ZCODE_AGENT_IDLE_MS || 10 * 60_000), log } = {}) {
    this.hosts = new Map();
    this.idleMs = idleMs;
    this.cliNode = cliNode;
    this.cliEntry = cliEntry;
    this.zcodeHome = zcodeHome;
    this.log = log || (() => {});
    this.reaper = setInterval(() => this.reap(), 60_000);
    this.reaper.unref();
  }

  async acquire(cwd, stderrSink) {
    let host = this.hosts.get(cwd);
    if (host && host.exited) {
      this.hosts.delete(cwd);
      host = null;
    }
    if (!host) {
      host = new AgentHost({ cwd, cliNode: this.cliNode, cliEntry: this.cliEntry, zcodeHome: this.zcodeHome, stderrSink, log: this.log });
      this.hosts.set(cwd, host);
      this.log(`agent-host: spawned agent-server for ${cwd} (pid ${host.client.proc.pid})`);
    }
    host.lastUsedAt = Date.now();
    return host;
  }

  reap() {
    const now = Date.now();
    for (const [cwd, host] of this.hosts) {
      if (now - host.lastUsedAt < this.idleMs) continue;
      this.hosts.delete(cwd);
      this.log(`agent-host: idle reaping agent-server for ${cwd}`);
      host.dispose();
    }
  }

  async shutdownAll(budgetMs = 5000) {
    clearInterval(this.reaper);
    const disposals = [...this.hosts.values()].map((h) => h.dispose());
    await Promise.race([
      Promise.allSettled(disposals),
      new Promise((r) => setTimeout(r, budgetMs)),
    ]);
    this.hosts.clear();
  }
}
