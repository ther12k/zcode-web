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
import { getPermissionRequestPreview } from "./permission-preview.mjs";

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
    this.pendingPermissions = new Map(); // requestId -> held interaction/requestPermission
    this.pendingUserInputs = new Map(); // requestId -> held interaction/requestUserInput
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
      // the RPC peer is gone: held interaction promises must settle (their
      // answers have nowhere to go) before listeners see the exit
      this.sweepAllInteractions("agent-server exited");
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
    // HOST (not per job) so later turns can resolve selections immediately.
    // Two envelopes: a bare state.updated method (fake/older wire) and the
    // real session/event wrapper where the type and patch live in payload.
    if (n.method === "state.updated" && Array.isArray(n.params?.patch?.model?.available)) {
      this.absorbModelLevels(n.params.sessionId, n.params.patch.model.available);
    } else if (
      n.method === "session/event" && n.params?.type === "state.updated"
      && Array.isArray(n.params?.payload?.patch?.model?.available)
    ) {
      this.absorbModelLevels(n.params.sessionId, n.params.payload.patch.model.available);
    }
    for (const listener of this.listeners) {
      try {
        listener(n);
      } catch { /* subscriber errors must not break routing */ }
    }
  }

  /** Re-read the session projection for model availability. On the REAL
   *  wire, reasoning levels arrive ONLY via session/read (observed live:
   *  streamed session.updated events never carry model.available), and the
   *  read at session-create time can race provider startup — returning an
   *  empty availability list. An explicit re-read is the authoritative
   *  recovery, so the bridge never sends a modelSelection the registry will
   *  reject for a missing reasoning level. */
  async refreshLevels(sessionId, modelRef) {
    const read = await this.client.request("session/read", { sessionId }, 10_000).catch(() => null);
    if (read?.projection?.model?.available) {
      this.absorbModelLevels(sessionId, read.projection.model.available);
    }
    return this.levelFor(sessionId, modelRef) ?? null;
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
      return this.handlePermissionRequest(params);
    }
    if (method === "interaction/requestUserInput") {
      return this.handleUserInputRequest(params);
    }
    if (method === "interaction/requestUserInput") {
      return { action: "cancel", reason: "cancelled by zcode-web bridge (no interactive input UI)" };
    }
    return {};
  }

  /** Policy for interaction/requestPermission. The wire request carries the
   *  caller's options (each with its own response payload); answering means
   *  returning a ZCodePermissionResponse — a legacy desktop echoes the chosen
   *  option's response verbatim, and so do we (bootstrap interaction-broker:
   *  exact optionId match → option.response).
   *
   *  Three regimes, in order:
   *   1. workflow run confirmations (CreateWorkflow/Amend/Resume) auto-allow
   *      under the DWF switch — unchanged behavior, verified live;
   *   2. ZCODE_AGENT_PERM_UI=0 denies everything else outright (rollback to
   *      the pre-UI bridge);
   *   3. otherwise HOLD the RPC: the request surfaces to the web UI over the
   *      job stream (permission.request line) and resolves when the user
   *      picks an option, the watchdog times out, or the turn/session ends. */
  handlePermissionRequest(params) {
    const tool = String(params?.toolName || "");
    const isWorkflowRunConfirmation = tool === "CreateWorkflow" || tool === "AmendWorkflow" || tool === "ResumeWorkflowRun";
    if (process.env.ZCODE_AGENT_DWF !== "0" && isWorkflowRunConfirmation) {
      return { decision: "allow" };
    }
    if (process.env.ZCODE_AGENT_PERM_UI === "0") {
      return { decision: "deny", reason: "denied by zcode-web bridge (permission UI disabled)" };
    }
    return this.holdPermission(params);
  }

  holdPermission(params) {
    const requestId = String(params?.requestId || "");
    if (!requestId) {
      return { decision: "deny", reason: "malformed permission request (no requestId)" };
    }
    const options = (Array.isArray(params?.options) ? params.options : [])
      .filter((o) => o && typeof o === "object" && o.optionId)
      .map((o) => ({
        optionId: String(o.optionId),
        kind: String(o.kind || ""),
        name: String(o.name || o.optionId),
        ...(o.description ? { description: String(o.description).slice(0, 300) } : {}),
      }));
    const preview = getPermissionRequestPreview({
      title: String(params?.toolName || "permission"),
      raw: params?.input,
    });
    // the broker has no timeout of its own (permissionTimeoutMs is
    // config-only), so the bridge owns the watchdog: a forgotten tab must
    // not wedge the turn forever
    const timeoutMs = Math.max(1000, Number(process.env.ZCODE_AGENT_PERM_TIMEOUT_MS || 600_000));
    return new Promise((resolve) => {
      const record = {
        params,
        options,
        sessionId: String(params?.sessionId || ""),
        resolve,
        timer: null,
        createdAt: Date.now(),
      };
      record.timer = setTimeout(
        () => this.settlePermission(requestId, { decision: "deny", reason: "permission request timed out waiting for the web UI" }, "timeout"),
        timeoutMs,
      );
      record.timer.unref?.();
      this.pendingPermissions.set(requestId, record);
      const event = {
        requestId,
        sessionId: record.sessionId,
        turnId: params?.turnId ?? null,
        toolCallId: String(params?.toolCallId || ""),
        toolName: String(params?.toolName || ""),
        reason: String(params?.reason || "").slice(0, 1000),
        riskLevel: String(params?.riskLevel || "medium"),
        preview,
        options,
        timeoutMs,
        createdAt: record.createdAt,
      };
      for (const listener of this.listeners) {
        try {
          listener({ method: "__permission_request", params: event });
        } catch { /* subscriber errors must not break routing */ }
      }
    });
  }

  /** User's pick from the web UI: echo the chosen option's response payload. */
  resolvePermission(requestId, optionId) {
    const record = this.pendingPermissions.get(String(requestId));
    if (!record) return null;
    const original = (Array.isArray(record.params?.options) ? record.params.options : [])
      .find((o) => o && String(o.optionId) === String(optionId));
    if (!original) return false;
    const response = original.response && typeof original.response === "object"
      ? original.response
      : { decision: "deny", reason: "malformed option response" };
    this.settlePermission(String(requestId), { ...response }, "user", String(optionId));
    return { decision: String(response.decision || "allow"), optionId: String(optionId) };
  }

  settlePermission(requestId, response, via, optionId) {
    const record = this.pendingPermissions.get(String(requestId));
    if (!record) return false;
    clearTimeout(record.timer);
    this.pendingPermissions.delete(String(requestId));
    try {
      record.resolve(response);
    } catch { /* settling must never throw into the RPC layer */ }
    for (const listener of this.listeners) {
      try {
        listener({
          method: "__permission_resolved",
          params: {
            requestId: String(requestId),
            sessionId: record.sessionId,
            decision: String(response?.decision || ""),
            ...(optionId ? { optionId: String(optionId) } : {}),
            via,
          },
        });
      } catch { /* subscriber errors must not break routing */ }
    }
    return true;
  }

  /** Deny-settle everything held for a session (turn ended: stop, finish or
   *  fail — a late answer has no consumer on the CLI side and is ignored). */
  sweepPermissions(sessionId, via) {
    const sid = String(sessionId || "");
    for (const requestId of [...this.pendingPermissions.keys()]) {
      const record = this.pendingPermissions.get(requestId);
      if (record && (!sid || record.sessionId === sid)) {
        this.settlePermission(requestId, { decision: "deny", reason: `permission request closed (${via})` }, via);
      }
    }
  }

  sweepAllPermissions(via) {
    for (const requestId of [...this.pendingPermissions.keys()]) {
      this.settlePermission(requestId, { decision: "deny", reason: `permission request closed (${via})` }, via);
    }
  }

  /** AskUserQuestion escalations (interaction/requestUserInput). The CLI
   *  maps its tool input to wire questions (value = label); a host answers
   *  with {action: accept|decline|cancel, content:{answers}} — accept
   *  becomes a "modify" that feeds the answers back into the tool call
   *  (bootstrap userInputResponseToBrokerResult), decline/cancel deny it.
   *  Held like permissions: card over the stream, resolve route answers,
   *  watchdog + turn-end sweep cancel, kill switch restores cancel-only. */
  handleUserInputRequest(params) {
    if (process.env.ZCODE_AGENT_PERM_UI === "0") {
      return { action: "cancel", reason: "cancelled by zcode-web bridge (permission UI disabled)" };
    }
    const requestId = String(params?.requestId || "");
    if (!requestId || !Array.isArray(params?.questions) || params.questions.length === 0) {
      return { action: "cancel", reason: "malformed user input request" };
    }
    const questions = params.questions
      .filter((q) => q && typeof q === "object" && q.question && Array.isArray(q.options))
      .slice(0, 4)
      .map((q) => ({
        question: String(q.question).slice(0, 500),
        header: String(q.header || "Question").slice(0, 60),
        multiSelect: Boolean(q.multiSelect),
        options: q.options
          .filter((o) => o && typeof o === "object" && (o.label || o.value))
          .slice(0, 8)
          .map((o) => ({
            label: String(o.label ?? o.value).slice(0, 200),
            ...(o.description ? { description: String(o.description).slice(0, 300) } : {}),
          })),
      }));
    if (questions.length === 0) {
      return { action: "cancel", reason: "malformed user input request (no usable questions)" };
    }
    const timeoutMs = Math.max(1000, Number(process.env.ZCODE_AGENT_PERM_TIMEOUT_MS || 600_000));
    return new Promise((resolve) => {
      const record = {
        sessionId: String(params?.sessionId || ""),
        resolve,
        timer: null,
        createdAt: Date.now(),
      };
      record.timer = setTimeout(
        () => this.settleUserInput(requestId, { action: "cancel", reason: "user input request timed out waiting for the web UI" }, "timeout"),
        timeoutMs,
      );
      record.timer.unref?.();
      this.pendingUserInputs.set(requestId, record);
      const event = {
        requestId,
        sessionId: record.sessionId,
        turnId: params?.turnId ?? null,
        toolCallId: String(params?.toolCallId || ""),
        toolName: String(params?.toolName || ""),
        prompt: String(params?.prompt || "").slice(0, 1000),
        questions,
        timeoutMs,
        createdAt: record.createdAt,
      };
      for (const listener of this.listeners) {
        try {
          listener({ method: "__userinput_request", params: event });
        } catch { /* subscriber errors must not break routing */ }
      }
    });
  }

  /** The web UI's answer: accept carries answers keyed by question text
   *  (multi-select joins labels with ", " — free-form "Other" text wins). */
  resolveUserInput(requestId, action, answers) {
    const record = this.pendingUserInputs.get(String(requestId));
    if (!record) return null;
    const normalized = String(action || "");
    if (normalized === "accept") {
      const clean = {};
      if (answers && typeof answers === "object" && !Array.isArray(answers)) {
        for (const [k, v] of Object.entries(answers)) {
          const value = String(v ?? "").trim();
          if (k && value) clean[String(k).slice(0, 500)] = value.slice(0, 2000);
        }
      }
      if (Object.keys(clean).length === 0) return false; // an accept with no answers is meaningless
      this.settleUserInput(String(requestId), { action: "accept", content: { answers: clean } }, "user");
      return { action: "accept", answers: clean };
    }
    if (normalized === "decline" || normalized === "cancel") {
      this.settleUserInput(String(requestId), { action: normalized }, "user");
      return { action: normalized };
    }
    return false; // unknown action
  }

  settleUserInput(requestId, response, via) {
    const record = this.pendingUserInputs.get(String(requestId));
    if (!record) return false;
    clearTimeout(record.timer);
    this.pendingUserInputs.delete(String(requestId));
    try {
      record.resolve(response);
    } catch { /* settling must never throw into the RPC layer */ }
    for (const listener of this.listeners) {
      try {
        listener({
          method: "__userinput_resolved",
          params: {
            requestId: String(requestId),
            sessionId: record.sessionId,
            action: String(response?.action || ""),
            ...(response?.content?.answers ? { answers: response.content.answers } : {}),
            via,
          },
        });
      } catch { /* subscriber errors must not break routing */ }
    }
    return true;
  }

  /** Deny/cancel-settle every held interaction for a session at once —
   *  turn end makes ALL of them dead (the CLI aborts pending RPCs). */
  sweepInteractions(sessionId, via) {
    const sid = String(sessionId || "");
    for (const requestId of [...this.pendingPermissions.keys()]) {
      const record = this.pendingPermissions.get(requestId);
      if (record && (!sid || record.sessionId === sid)) {
        this.settlePermission(requestId, { decision: "deny", reason: `permission request closed (${via})` }, via);
      }
    }
    for (const requestId of [...this.pendingUserInputs.keys()]) {
      const record = this.pendingUserInputs.get(requestId);
      if (record && (!sid || record.sessionId === sid)) {
        this.settleUserInput(requestId, { action: "cancel", reason: `user input request closed (${via})` }, via);
      }
    }
  }

  sweepAllInteractions(via) {
    this.sweepInteractions("", via);
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
