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
  // assistant text deltas — shapes vary by CLI version; collect obvious text
  const text =
    typeof p.text === "string" ? p.text :
    typeof p.delta === "string" ? p.delta :
    (p.part && typeof p.part.text === "string") ? p.part.text : null;
  if (text) return { kind: "text", text };
  if (TYPE_LABELS[line.type]) return { kind: "activity", label: TYPE_LABELS[line.type] };
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
  if (d.kind === "text" && state.job) {
    state.job.bubbleText += d.text;
    const el = state.job.bubble;
    el.innerHTML = "";
    el.appendChild(renderMarkdown(state.job.bubbleText));
    $("chat").scrollTop = $("chat").scrollHeight;
    return;
  }
  if (d.kind === "error") { setActivity("error: " + d.text, true); return; }
  if (d.kind === "activity") setActivity(d.label);
}

// ---------- chat ----------

async function send() {
  const input = $("prompt-input");
  const text = input.value.trim();
  if (!text || state.job) return;

  addMsg("user", text, { markdown: false });
  input.value = "";

  const bubble = addMsg("assistant", "");
  const activityEl = document.createElement("div");
  bubble.appendChild(activityEl);
  state.job = { id: null, es: null, bubble, activityEl, bubbleText: "" };

  try {
    const res = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ text, sessionId: state.sessionId, cwd: state.cwd, mode: $("mode-select").value }),
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

async function refreshSessions() {
  if (!state.cwd) return;
  $("session-cwd-label").textContent = "";
  const list = $("session-list");
  list.innerHTML = "";
  try {
    const { sessions } = await api(`/api/sessions?cwd=${encodeURIComponent(state.cwd)}`);
    if (!sessions.length) {
      list.innerHTML = `<div class="muted" style="padding:6px 10px">No sessions yet</div>`;
      return;
    }
    for (const s of sessions) {
      const el = document.createElement("div");
      el.className = "session-item" + (s.id === state.sessionId ? " active" : "");
      el.innerHTML = `<div class="session-title"></div><div class="session-meta"></div>`;
      el.querySelector(".session-title").textContent = s.title || s.id;
      el.querySelector(".session-meta").textContent = new Date(s.updatedAt).toLocaleString();
      el.onclick = () => openSession(s.id);
      list.appendChild(el);
    }
  } catch (e) {
    list.innerHTML = `<div class="activity error">${e.message}</div>`;
  }
}

async function openSession(sessionId) {
  state.sessionId = sessionId;
  $("messages").innerHTML = "";
  try {
    const { session, transcript } = await api(`/api/sessions/${sessionId}`);
    if (!transcript.length) addEmptyHint("Session is empty — send a message to continue it.");
    for (const turn of transcript) addMsg(turn.role, turn.text);
  } catch (e) {
    addEmptyHint(`Could not load session: ${e.message}`);
  }
  refreshSessions();
}

function addEmptyHint(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  $("messages").appendChild(div);
}

async function refreshProjects() {
  const select = $("project-select");
  try {
    const { projects } = await api("/api/projects");
    const prev = state.cwd;
    select.innerHTML = "";
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      select.appendChild(opt);
    }
    if (prev) {
      const name = projects.includes(prev.split("/").pop()) ? prev.split("/").pop() : null;
      if (name) select.value = name;
    }
    state.cwd = select.value ? `${state.workspaceRoot}/${select.value}` : state.workspaceRoot;
    select.dispatchEvent(new Event("change"));
  } catch (e) {
    console.error(e);
  }
}

async function newProject() {
  const name = prompt("New project name (directory on the server):");
  if (!name) return;
  try {
    const res = await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
    await refreshProjects();
    $("project-select").value = name;
    $("project-select").dispatchEvent(new Event("change"));
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
    await refreshProjects();
    await refreshSessions();
  } catch (e) {
    $("conn-dot").className = "dot off";
    if (String(e.message) !== "unauthorized") {
      addEmptyHint(`Cannot reach zcode-web server: ${e.message}`);
    }
  }
}

$("send-btn").onclick = send;
$("cancel-btn").onclick = cancelJob;
$("new-chat-btn").onclick = () => {
  state.sessionId = null;
  $("messages").innerHTML = "";
  addEmptyHint("New session — it will be created in the current project on your first message.");
  refreshSessions();
};
$("new-project-btn").onclick = newProject;
$("project-select").onchange = () => {
  const name = $("project-select").value;
  state.cwd = name ? `${state.workspaceRoot}/${name}` : state.workspaceRoot;
  state.sessionId = null;
  $("messages").innerHTML = "";
  addEmptyHint("Project switched — sessions listed on the left.");
  refreshSessions();
};
$("prompt-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    send();
  }
});

boot();
