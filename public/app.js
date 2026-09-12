// zcode-web frontend — talks to the local zcode-web server API.

const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem("zcode-web-token") || "",
  authRequired: false,
  cwd: null, // absolute project dir
  sessionId: null,
  job: null, // { id, es, bubble, activityEl }
};

// ---------- api ----------

async function api(path, opts = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { promptToken(); throw new Error("unauthorized"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function promptToken() {
  if ($("token-bar")) return;
  const bar = document.createElement("div");
  bar.id = "token-bar";
  bar.innerHTML = `<div class="card">
      <strong>Access token required</strong>
      <input id="token-input" type="password" placeholder="ZCODE_WEB_TOKEN" />
      <button id="token-save" class="primary">Continue</button>
    </div>`;
  document.body.appendChild(bar);
  $("token-save").onclick = () => {
    state.token = $("token-input").value.trim();
    localStorage.setItem("zcode-web-token", state.token);
    bar.remove();
    boot();
  };
}

// ---------- rendering ----------

function renderMarkdown(text) {
  if (window.marked) {
    try {
      const html = marked.parse(text, { breaks: true });
      const div = document.createElement("div");
      div.innerHTML = html;
      return div;
    } catch { /* fall through */ }
  }
  const pre = document.createElement("pre");
  pre.textContent = text;
  return pre;
}

function addMsg(role, content, { markdown = role === "assistant" } = {}) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  const roleEl = document.createElement("div");
  roleEl.className = "role";
  roleEl.textContent = role;
  el.appendChild(roleEl);
  if (typeof content === "string") {
    el.appendChild(markdown ? renderMarkdown(content) : document.createTextNode(content));
  } else {
    el.appendChild(content);
  }
  $("messages").appendChild(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

function setActivity(text, isError = false) {
  if (!state.job) return;
  const el = state.job.activityEl;
  el.textContent = text;
  el.className = `activity${isError ? " error" : ""}`;
  $("chat").scrollTop = $("chat").scrollHeight;
}

// ---------- stream event rendering ----------
// Envelope observed on CLI 0.16.5:
//   {eventId, payload, seq, sessionId, timestamp, traceId, turnId, type}
// Known types: session.titleUpdated, turn.started, session.updated
// (payload.type = model_request_started/failed/…), turn.failed, turn.completed.

const PAYLOAD_TYPE_LABELS = {
  model_request_started: "thinking…",
  model_request_succeeded: "model responded",
  model_request_failed: "model request failed",
};

const TYPE_LABELS = {
  "turn.started": "running…",
  "turn.completed": "completed",
  "turn.failed": "turn failed",
  "session.updated": null, // real info is in payload.type
  "session.titleUpdated": null, // handled separately
  "model.streaming": null, // text deltas, handled in describeLine
  result: null, // final result marker
};

function describeLine(line) {
  const p = line.payload || {};
  if (p.title !== undefined && p.source) return { kind: "title", title: p.title };
  if (p.error) {
    const err = p.error;
    return { kind: "error", text: err.message || err.type || JSON.stringify(err).slice(0, 300) };
  }
  if (p.type && PAYLOAD_TYPE_LABELS[p.type] !== undefined) {
    return { kind: "activity", label: PAYLOAD_TYPE_LABELS[p.type] };
  }
  // assistant stream deltas: kind distinguishes reasoning from answer text
  // (CLI 0.16.5: start/reasoning_delta/text_delta/finish/…)
  if (line.type === "model.streaming" && typeof p.delta === "string") {
    if (p.kind === "reasoning_delta") return { kind: "reasoning", text: p.delta };
    if (p.kind === "text_delta" || p.kind === undefined) return { kind: "text", text: p.delta };
    return { kind: "activity", label: null }; // lifecycle markers (start/end/finish)
  }
  const text =
    typeof p.text === "string" ? p.text :
    (p.part && typeof p.part.text === "string") ? p.part.text : null;
  if (text) return { kind: "text", text };
  if (line.type && line.type.startsWith("tool.call.")) {
    const status = line.type.endsWith("started") ? "running"
      : line.type.endsWith("failed") ? "failed"
      : line.type.endsWith("cancelled") ? "cancelled" : "done";
    return {
      kind: "tool",
      callId: p.callID || p.toolCallId || p.id || "",
      tool: p.toolName || p.tool || p.name || "tool",
      status,
      detail: typeof p.input === "string" ? p.input : p.input ? JSON.stringify(p.input) : "",
    };
  }
  if (TYPE_LABELS[line.type] !== undefined) return { kind: "activity", label: TYPE_LABELS[line.type] };
  if (p.type) return { kind: "activity", label: p.type };
  if (line.type) return { kind: "activity", label: line.type };
  return { kind: "activity", label: "event" };
}

function handleStreamLine(line) {
  if (line.sessionId && !state.sessionId) {
    state.sessionId = line.sessionId;
  }
  const d = describeLine(line);
  if (d.kind === "title") {
    state.sessionTitle = d.title;
    refreshSessions();
    return;
  }
  if (!state.job) return;
  if (d.kind === "reasoning") {
    state.job.reasoningText = (state.job.reasoningText || "") + d.text;
    if (state.job.reasoningEl) {
      state.job.reasoningEl.querySelector(".reasoning-body").textContent = state.job.reasoningText;
      state.job.reasoningEl.style.display = "";
    }
    return;
  }
  if (d.kind === "text") {
    state.job.bubbleText += d.text;
    const el = state.job.answerEl;
    el.innerHTML = "";
    el.appendChild(renderMarkdown(state.job.bubbleText));
    $("chat").scrollTop = $("chat").scrollHeight;
    return;
  }
  // final safety net: completed turns carry the full response — render it if
  // streaming produced no visible text (tool-call endings, missed deltas)
  if (line.type === "turn.completed" && typeof p.response === "string" && state.job && !state.job.bubbleText) {
    state.job.bubbleText = p.response;
    state.job.answerEl.innerHTML = "";
    state.job.answerEl.appendChild(renderMarkdown(p.response));
  }
  if (d.kind === "tool") {
    if (!state.job) return;
    const map = state.job.toolCards || (state.job.toolCards = new Map());
    let card = map.get(d.callId);
    if (!card) {
      card = document.createElement("div");
      state.job.bubble.insertBefore(card, state.job.activityEl);
      map.set(d.callId, card);
    }
    card.className = `tool-card ${d.status}`;
    card.textContent = `🔧 ${d.tool} — ${d.status}${d.detail ? ": " + d.detail.slice(0, 100) : ""}`;
    return;
  }
  if (d.kind === "error") {
    state.job.sawError = true;
    setActivity("error: " + d.text, true);
    return;
  }
  if (d.kind === "activity" && d.label) setActivity(d.label);
}

// ---------- chat ----------

async function send() {
  const input = $("prompt-input");
  const text = input.value.trim();
  if (!text || state.job) return;

  addMsg("user", text, { markdown: false });
  input.value = "";

  const bubble = addMsg("assistant", "");
  const reasoningEl = document.createElement("details");
  reasoningEl.className = "reasoning";
  reasoningEl.innerHTML = `<summary>thinking</summary><div class="reasoning-body"></div>`;
  reasoningEl.style.display = "none";
  const answerEl = document.createElement("div");
  answerEl.className = "answer";
  bubble.appendChild(reasoningEl);
  bubble.appendChild(answerEl);
  const activityEl = document.createElement("div");
  bubble.appendChild(activityEl);
  state.job = { id: null, es: null, bubble, activityEl, reasoningEl, answerEl, bubbleText: "", reasoningText: "" };

  try {
    const res = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        text,
        sessionId: state.sessionId,
        cwd: state.cwd,
        mode: $("mode-select").value,
        model: $("model-select").value || undefined,
      }),
    });
    state.job.id = res.jobId;
    if (res.sessionId) state.sessionId = res.sessionId;
    setActivity("started…");
    $("send-btn").disabled = true;
    $("cancel-btn").classList.remove("hidden");
    subscribe(res.jobId);
  } catch (e) {
    setActivity(String(e.message), true);
    finishJob();
  }
}

function subscribe(jobId) {
  const url = `/api/events/${jobId}${state.token ? `?token=${encodeURIComponent(state.token)}` : ""}`;
  const es = new EventSource(url);
  state.job.es = es;
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.kind === "line") handleStreamLine(msg.line);
    else if (msg.kind === "done") {
      if (msg.error) setActivity(`job failed: ${msg.error}`, true);
      else if (state.job?.sawError) setActivity("ended with errors", true); // keep the real error visible
      else if (msg.exitCode !== 0 && msg.exitCode !== null) setActivity(`ended with errors (exit ${msg.exitCode})`, true);
      else setActivity("done");
      finishJob();
    } else if (msg.kind === "timeout") {
      setActivity("job timed out and was killed", true);
    }
  };
  es.onerror = () => {
    if (state.job && state.job.id === jobId) {
      setActivity("connection lost", true);
      finishJob();
    }
  };
}

function finishJob() {
  if (state.job?.es) state.job.es.close();
  state.job = null;
  $("send-btn").disabled = false;
  $("cancel-btn").classList.add("hidden");
  refreshSessions();
}

async function cancelJob() {
  if (!state.job?.id) return;
  try { await api(`/api/jobs/${state.job.id}/cancel`, { method: "POST" }); } catch { /* already gone */ }
}

// ---------- sessions / projects ----------

let refreshSeq = 0;
async function refreshSessions() {
  if (!state.cwd) return;
  const seq = ++refreshSeq;
  const list = $("session-list");
  try {
    const { sessions } = await api(`/api/sessions?cwd=${encodeURIComponent(state.cwd)}`);
    if (seq !== refreshSeq) return; // a newer refresh superseded this one
    list.innerHTML = "";
    if (!sessions.length) {
      list.innerHTML = `<div class="muted" style="padding:6px 10px">No sessions yet</div>`;
      return;
    }
    for (const s of sessions) {
      const el = document.createElement("div");
      el.className = "session-item" + (s.id === state.sessionId ? " active" : "");
      el.title = s.id; // full session id on hover
      el.innerHTML = `<div class="session-title"></div><div class="session-meta"></div>`;
      el.querySelector(".session-title").textContent = s.title || s.id;
      const shortId = s.id.length > 18 ? s.id.slice(0, 15) + "…" : s.id;
      el.querySelector(".session-meta").textContent = `${shortId} · ${new Date(s.updatedAt).toLocaleString()}`;
      el.onclick = () => openSession(s.id);
      list.appendChild(el);
    }
  } catch (e) {
    if (seq === refreshSeq) list.innerHTML = `<div class="activity error">${e.message}</div>`;
  }
}

async function openSession(sessionId) {
  state.sessionId = sessionId;
  $("messages").innerHTML = "";
  state.loadedTurns = 0;
  await loadTurns(sessionId, { reset: true });
  refreshSessions();
}

// Fetch one page of turns (newest-first pagination, prepended when older).
async function loadTurns(sessionId, { reset = false } = {}) {
  const limit = 5;
  const offset = reset ? 0 : state.loadedTurns;
  try {
    const { transcript, total, hasMore } = await api(
      `/api/sessions/${sessionId}?limit=${limit}&offset=${offset}`
    );
    if (reset && !transcript.length) {
      addEmptyHint("Session is empty — send a message to continue it.");
      return;
    }
    // remove a previous "load earlier" button, then prepend older turns
    const oldBtn = $("load-earlier");
    if (oldBtn) oldBtn.remove();
    const anchor = $("messages").firstChild;
    if (hasMore) {
      const btn = document.createElement("button");
      btn.id = "load-earlier";
      btn.className = "load-earlier";
      btn.textContent = `Load earlier messages (${total - offset - transcript.length} more)`;
      btn.onclick = () => loadTurns(sessionId);
      $("messages").insertBefore(btn, anchor);
    }
    for (const turn of transcript) {
      const msgEl = document.createElement("div");
      msgEl.className = `msg ${turn.role}`;
      const roleEl = document.createElement("div");
      roleEl.className = "role";
      roleEl.textContent = turn.role;
      msgEl.appendChild(roleEl);
      if (turn.tool) {
        const card = document.createElement("div");
        card.className = `tool-card ${turn.tool.status === "completed" ? "done" : turn.tool.status}`;
        card.textContent = `🔧 ${turn.tool.name} — ${turn.tool.status}${turn.tool.detail ? ": " + turn.tool.detail.slice(0, 120) : ""}`;
        msgEl.appendChild(card);
      } else {
        msgEl.appendChild(turn.role === "assistant" ? renderMarkdown(turn.text) : document.createTextNode(turn.text));
      }
      $("messages").insertBefore(msgEl, anchor);
    }
    state.loadedTurns = offset + transcript.length;
    if (reset) $("chat").scrollTop = $("chat").scrollHeight;
  } catch (e) {
    addEmptyHint(`Could not load session: ${e.message}`);
  }
}

function addEmptyHint(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  $("messages").appendChild(div);
}

async function loadModels() {
  const sel = $("model-select");
  try {
    const { models } = await api("/api/models");
    if (!models.length) { sel.classList.add("hidden"); return; }
    sel.classList.remove("hidden");
    const saved = localStorage.getItem("zcode-web-model") || "";
    // disambiguate identical display names (e.g. two providers both called
    // "Z.ai - Coding Plan") by appending the provider id
    const baseLabel = (m) => `${m.model} · ${m.providerName}`;
    const counts = {};
    for (const m of models) counts[baseLabel(m)] = (counts[baseLabel(m)] || 0) + 1;
    sel.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      const base = baseLabel(m);
      opt.value = m.ref;
      opt.textContent = counts[base] > 1 ? `${base} [${m.provider}]` : base;
      if (m.isDefault) opt.textContent += " (default)";
      sel.appendChild(opt);
    }
    sel.value = models.some((m) => m.ref === saved) ? saved : (models.find((m) => m.isDefault) || models[0]).ref;
  } catch {
    sel.classList.add("hidden");
  }
}

async function refreshProjects() {
  const select = $("project-select");
  try {
    const { roots } = await api("/api/projects");
    const prev = state.cwd;
    select.innerHTML = "";
    for (const root of roots) {
      const group = document.createElement("optgroup");
      group.label = root.path;
      for (const name of root.projects) {
        const opt = document.createElement("option");
        const slash = root.path.endsWith("/") ? "" : "/";
        opt.value = root.path + slash + name;
        opt.textContent = name;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
    // keep previous selection if still present, else first option
    const values = [...select.options].map((o) => o.value);
    state.cwd = values.includes(prev) ? prev : values[0] || state.workspaceRoot;
    if (state.cwd) select.value = state.cwd;
  } catch (e) {
    console.error(e);
  }
}

async function newProject() {
  const name = prompt("New project name (directory on the server):");
  if (!name) return;
  try {
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
    // create under the root that contains the current selection, else the first root
    await refreshProjects();
    const base = state.cwd?.startsWith(state.workspaceRoot) === false ? state.cwd : state.workspaceRoot;
    const dir = base.replace(/\/$/, "") + "/" + name;
    const select = $("project-select");
    if ([...select.options].some((o) => o.value === dir)) {
      state.cwd = dir;
      select.value = dir;
    }
    onProjectChange();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- boot ----------

async function boot() {
  try {
    const cfg = await api("/api/config");
    state.authRequired = cfg.authRequired;
    state.workspaceRoot = cfg.workspaceRoot;
    $("conn-dot").className = "dot on";
    if (cfg.modes?.length) {
      const sel = $("mode-select");
      for (const opt of [...sel.options]) if (!cfg.modes.includes(opt.value)) opt.remove();
    }
    await loadModels();
    await refreshProjects();
    await refreshSessions();
  } catch (e) {
    $("conn-dot").className = "dot off";
    if (String(e.message) !== "unauthorized") {
      addEmptyHint(`Cannot reach zcode-web server: ${e.message}`);
    }
  }
}

$("model-select").onchange = () => localStorage.setItem("zcode-web-model", $("model-select").value);
$("send-btn").onclick = send;
$("cancel-btn").onclick = cancelJob;
$("new-chat-btn").onclick = () => {
  state.sessionId = null;
  $("messages").innerHTML = "";
  addEmptyHint("New session — it will be created in the current project on your first message.");
  refreshSessions();
};
$("new-project-btn").onclick = newProject;
function onProjectChange() {
  state.cwd = $("project-select").value || state.workspaceRoot;
  state.sessionId = null;
  $("messages").innerHTML = "";
  addEmptyHint("Project switched — sessions listed on the left.");
  refreshSessions();
}

$("project-select").onchange = onProjectChange;
$("prompt-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    send();
  }
});

boot();
