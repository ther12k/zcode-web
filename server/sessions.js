// Read-only access to the ZCode CLI session store (~/.zcode/cli/db/db.sqlite).
// The same database the CLI writes and the ZCode Desktop app reads.
// Schema observed on CLI 0.16.5:
//   session(id, title, directory, time_created, time_updated, ...)
//   message(id, session_id, data JSON{role,...}, sequence)
//   part(id, message_id, session_id, data JSON{type,text,...}, sequence)

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { directoryScope } from "./directory-scope.js";
import { sliceDaily } from "./analytics.js";

// Analytics snapshots rebuild in the background at most this often — the
// full token scan is far too heavy to run per request on a large store.
const ANALYTICS_TTL_MS = 10 * 60_000;
// after a FAILED build, wait this long before letting a request trigger
// another one (a missing/broken DB would otherwise be re-scanned per request)
const ANALYTICS_ERROR_RETRY_MS = 30_000;

// Compact artifact summary for a tool part (shape: CLI 0.16.5
// {type:"tool", tool, callID, state:{status, input, output…}}).
function toolSummary(part) {
  const input = part.state?.input || {};
  const primary = input.command || input.filePath || input.path || input.query || input.pattern || input.url;
  return {
    name: part.tool || "tool",
    status: part.state?.status || "unknown",
    detail: String(primary || JSON.stringify(input)).slice(0, 160),
  };
}

// Desktop artifacts are stored as file parts. Some resolve through the
// desktop-only zcode-artifact:// protocol, so expose their metadata safely
// rather than treating that protocol URI as a host file path.
function fileSummary(part) {
  return {
    mime: part.mime || "application/octet-stream",
    url: typeof part.url === "string" ? part.url : "",
    size: Number(part.metadata?.sizeBytes) || null,
    storageKind: part.metadata?.storageKind || "attachment",
    image: part.metadata?.image || null,
  };
}

// The desktop interleaves timeline separators in the transcript: model
// switches, context compactions, session forks and goal-verification marks.
// They arrive either as {type:"timeline", timelineType} or as a
// {type:"compaction"} twin of the same event; both collapse to one entry.
function timelineSummary(part) {
  const kind = part.timelineType || (part.type === "compaction" ? "context_compaction" : "");
  const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  if (kind === "context_compaction") {
    const pre = Number(part.preCompactTokenCount) || 0;
    const post = Number(part.truePostCompactTokenCount ?? part.postCompactTokenCount) || 0;
    return {
      kind: "compaction",
      label: part.auto || part.trigger === "auto" ? "Context auto-compacted" : "Context compacted",
      detail: pre && post ? `${fmt(pre)} → ${fmt(post)} tokens` : "",
    };
  }
  if (kind === "model_change") {
    const from = part.fromModel || {};
    const to = part.toModel || {};
    const short = (m) => (m.variant && m.variant !== "none" ? `${m.modelID}:${m.variant}` : m.modelID || m.label || "?");
    const shortProvider = (m) => (String(m.providerID || "").startsWith("builtin:") ? m.providerID.slice(8) : String(m.providerID || "").slice(0, 8));
    // show what actually changed: the model, else the variant, else the provider
    const detail =
      from.modelID !== to.modelID
        ? `${short(from)} → ${short(to)}`
        : short(from) !== short(to)
          ? `${from.modelID}: ${from.variant || "?"} → ${to.variant || "?"}`
          : `${from.modelID} · ${shortProvider(from)} → ${shortProvider(to)}`;
    return { kind: "model_change", label: "Model changed", detail };
  }
  if (kind === "session_fork") {
    return { kind: "session_fork", label: "Session forked", detail: part.parentSessionId ? `from ${part.parentSessionId.slice(0, 18)}…` : "" };
  }
  if (kind === "goal_verification") {
    const passed = part.verification?.passed;
    return { kind: "goal_verification", label: "Goal verification", detail: passed === true ? "passed" : passed === false ? "not passed" : part.status || "" };
  }
  return null;
}

export class SessionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    // analytics snapshot cache: { key, value | null, builtAt, error? }
    // value === null means the last build failed and there is no data yet.
    this.analyticsCache = null;
    this.analyticsInflight = new Set(); // keys with a build queued/running
    this.analyticsWorker = null;
    this.analyticsSeq = 0;
  }

  // ZWUI-018: query errors are surfaced, not swallowed. Missing DB is a
  // distinct 503-grade condition; SQL failures throw for the caller to map
  // to 500 with a real message.
  query(sql, params = []) {
    if (!existsSync(this.dbPath)) {
      const e = new Error("session database not found at " + this.dbPath);
      e.code = "DB_MISSING";
      throw e;
    }
    let db;
    try {
      db = new DatabaseSync(this.dbPath, { readOnly: true });
    } catch (openErr) {
      // readonly open can fail while the CLI holds a write lock in WAL edge
      // cases — retry through a normal connection before giving up
      try {
        db = new DatabaseSync(this.dbPath);
      } catch {
        const e = new Error("session database could not be opened: " + openErr.message);
        e.code = "DB_OPEN_FAILED";
        throw e;
      }
    }
    try {
      return db.prepare(sql).all(...params);
    } catch (sqlErr) {
      const e = new Error("session database query failed: " + sqlErr.message);
      e.code = "DB_QUERY_FAILED";
      throw e;
    } finally {
      db.close();
    }
  }

  list(directory, limit = 100) {
    const rows = this.query(
      `SELECT id, title, directory, time_created, time_updated, task_type
         FROM session
        WHERE directory = ? AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC
        LIMIT ?`,
      [directory, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      directory: r.directory,
      taskType: r.task_type,
      createdAt: Number(r.time_created),
      updatedAt: Number(r.time_updated),
    }));
  }

  // ZWUI-029: bounded title search scoped to directories under the roots.
  searchSessions(q, roots, limit = 20) {
    if (!roots.length) return [];
    const like = `%${q.replace(/[%_]/g, "!$&").replace(/'/g, "''")}%`;
    const scope = directoryScope("directory", roots);
    const rows = this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE title LIKE ? ESCAPE '!' AND ${scope.sql}
          AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC LIMIT ?`,
      [like, ...scope.params, limit]
    );
    return rows.map((r) => ({
      id: r.id, title: r.title, directory: r.directory,
      updatedAt: Number(r.time_updated),
    }));
  }

  recentUnder(root, limit = 30) {
    const scope = directoryScope("directory", [root]);
    return this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE ${scope.sql} AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC LIMIT ?`,
      [...scope.params, limit]
    ).map((r) => ({ id: r.id, title: r.title, directory: r.directory, updatedAt: Number(r.time_updated) }));
  }

  // Latest sessions across ALL allowed roots in one query — the search
  // dialog's empty-state list ("show me my 50 most recent sessions").
  recent(roots, limit = 50) {
    if (!roots.length) return [];
    const scope = directoryScope("directory", roots);
    return this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE id NOT LIKE 'sess_subagent_%' AND ${scope.sql}
        ORDER BY time_updated DESC LIMIT ?`,
      [...scope.params, limit]
    ).map((r) => ({ id: r.id, title: r.title, directory: r.directory, updatedAt: Number(r.time_updated) }));
  }

  // Goal/target for a session (real CLI data from session_target).
  goal(sessionId) {
    const rows = this.query(
      `SELECT objective, status, tokens_used, time_used_seconds, time_created, time_updated
         FROM session_target WHERE session_id = ? ORDER BY time_updated DESC LIMIT 1`,
      [sessionId]
    );
    const r = rows[0];
    return r
      ? {
          objective: r.objective,
          status: r.status,
          tokensUsed: Number(r.tokens_used) || 0,
          timeUsedSeconds: Number(r.time_used_seconds) || 0,
          updatedAt: Number(r.time_updated),
        }
      : null;
  }

  // Cumulative agent working time for a session — the desktop's "Worked for
  // 12m 26s" figure. turn_usage rows are written when each turn ends, so this
  // is completed-turn time; a live turn's elapsed time is added client-side.
  // Older CLI stores lack the table — that's 0 worked time, never an error.
  workedMs(sessionId) {
    try {
      const rows = this.query(
        `SELECT SUM(duration_ms) AS total FROM turn_usage WHERE session_id = ?`,
        [sessionId]
      );
      return Number(rows[0]?.total) || 0;
    } catch {
      return 0;
    }
  }

  // The agent's todo list for a session — the desktop's Progress checklist
  // (status: pending | in_progress | completed, ordered by position). Rows are
  // updated in place, so the current rows ARE the live plan state. Older CLI
  // stores without the table contribute an empty list, never an error.
  todos(sessionId) {
    try {
      return this.query(
        `SELECT content, status, priority, position FROM todo
          WHERE session_id = ? ORDER BY position ASC`,
        [sessionId]
      ).map((r) => ({
        content: String(r.content || ""),
        status: String(r.status || "pending"),
        priority: String(r.priority || ""),
      }));
    } catch {
      return [];
    }
  }

  get(sessionId) {
    const rows = this.query(
      `SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`,
      [sessionId]
    );
    return rows[0]
      ? {
          id: rows[0].id,
          title: rows[0].title,
          directory: rows[0].directory,
          createdAt: Number(rows[0].time_created),
          updatedAt: Number(rows[0].time_updated),
        }
      : null;
  }

  // Renderable transcript: user/assistant turns with their text parts.
  // Note: role lives inside message.data JSON, not as a column.
  //
  // Pagination counts from the newest turn: offset=0, limit=5 returns the
  // LAST 5 turns (the ones shown when opening a session); offset=5 returns
  // the 5 before those, etc.
  //
  // ZWUI-062: pages VISIBLE messages directly instead of a fixed part window.
  // The old newest-6000-part window ran BEFORE the CLI-internal filter, so
  // busy sessions could truncate visible history mid-turn and report a
  // window-local total. Here the visibility and content predicates live in
  // SQL (mirroring the JS filter exactly — json_type 'true' ↔ JS true, and
  // JSON null excluded for summary so it behaves like JS null), so total,
  // hasMore and the page agree by construction and each page fetches parts
  // only for its own messages.
  transcript(sessionId, { limit = 400, offset = 0 } = {}) {
    // "renderable turn" parity with the JS content filter below: a message
    // turns into a chat turn when it carries an error or any text/reasoning/
    // tool/file/timeline part (step-start/step-finish alone render nothing).
    // The CTE materializes the content-message set ONCE — a correlated EXISTS
    // is O(messages × parts) here because CLI stores carry no index on
    // part.message_id (measured 425ms vs 9ms at 2100 messages).
    const contentCte = `
      WITH content_msgs AS (
        SELECT DISTINCT message_id AS mid FROM part
         WHERE session_id = ? AND json_extract(data, '$.type') IN ('text','reasoning','tool','file','timeline','compaction')
      )`;
    const visibleSql = `
      json_type(m.data, '$.synthetic') IS NOT 'true'
      AND json_extract(m.data, '$.semantics.transcriptVisibility') IS NOT 'hidden'
      AND json_extract(m.data, '$.visibility') IS NOT 'model-only'
      AND NOT (
        json_extract(m.data, '$.role') = 'user'
        AND json_extract(m.data, '$.summary') IS NOT NULL
        AND json_type(m.data, '$.summary') != 'null'
      )`;
    const contentSql = `(
      json_type(m.data, '$.error') = 'object'
      OR m.id IN (SELECT mid FROM content_msgs)
    )`;

    const total = Number(this.query(
      `${contentCte} SELECT COUNT(*) AS n FROM message m
        WHERE m.session_id = ? AND ${visibleSql} AND ${contentSql}`,
      [sessionId, sessionId]
    )[0]?.n) || 0;

    // One context message before the window so the page's first assistant
    // turn can still carry its exchange footer (prevUserMsgId).
    const ctx = offset > 0 ? 1 : 0;
    const msgRows = this.query(
      `${contentCte} SELECT m.id AS mid, m.data AS mdata, m.sequence AS mseq
         FROM message m
        WHERE m.session_id = ? AND ${visibleSql} AND ${contentSql}
        ORDER BY m.sequence DESC
        LIMIT ? OFFSET ?`,
      [sessionId, sessionId, limit + ctx, Math.max(0, offset - ctx)]
    );
    const contextRow = ctx ? msgRows.shift() || null : null;
    const pageAsc = msgRows.reverse(); // chronological for the turn builder

    const partsByMid = new Map();
    if (pageAsc.length) {
      const placeholders = pageAsc.map(() => "?").join(",");
      for (const p of this.query(
        `SELECT p.message_id AS mid, p.data AS pdata
           FROM part p
          WHERE p.session_id = ? AND p.message_id IN (${placeholders})
          ORDER BY p.sequence`,
        [sessionId, ...pageAsc.map((r) => r.mid)]
      )) {
        if (!partsByMid.has(p.mid)) partsByMid.set(p.mid, []);
        partsByMid.get(p.mid).push(p);
      }
    }

    // Per-turn duration/status live in turn_usage, keyed by the turn's user
    // message — the same rows the desktop's "Worked for Xs" footers come from.
    // Older CLI stores may not have the table; treat as "no durations".
    let usage = new Map();
    try {
      usage = new Map(
        this.query(
          `SELECT user_message_id, status, duration_ms FROM turn_usage WHERE session_id = ?`,
          [sessionId]
        ).map((u) => [u.user_message_id, { status: u.status, durationMs: Number(u.duration_ms) || 0 }])
      );
    } catch { /* table missing */ }

    const turns = [];
    for (const r of pageAsc) {
      let msg = {};
      try { msg = JSON.parse(r.mdata); } catch { /* keep {} */ }
      // Defense in depth: the SQL predicates above mirror this filter, but a
      // drift must never surface a CLI-internal message as a chat turn.
      if (
        msg.synthetic === true ||
        msg.semantics?.transcriptVisibility === "hidden" ||
        msg.visibility === "model-only" ||
        (msg.role === "user" && msg.summary != null)
      ) continue;
      const turn = {
        role: msg.role || "?", mseq: r.mseq, mid: r.mid,
        texts: [], reasonings: [], tokens: 0, timeline: [], tools: [], files: [],
        error: msg.error?.data?.message || msg.error?.message || msg.error?.name || null,
        msgCompleted: Number(msg.time?.completed) || 0,
        msgCreated: Number(msg.time?.created) || 0,
      };
      for (const pr of partsByMid.get(r.mid) || []) {
        let part = {};
        try { part = JSON.parse(pr.pdata); } catch { /* keep {} */ }
        // reasoning parts carry .text too — the desktop keeps them out of the
        // rendered answer (collapsible "Thinking"), so must we
        const text = typeof part.text === "string" && part.type !== "reasoning" ? part.text : "";
        const reasoning = part.type === "reasoning" && typeof part.text === "string" ? part.text : "";
        const stepTokens = part.type === "step-finish" ? Number(part.tokens?.total) || 0 : 0;
        const timelineEntry = part.type === "timeline" || part.type === "compaction" ? timelineSummary(part) : null;
        if (text.trim()) turn.texts.push(text);
        if (reasoning) turn.reasonings.push(reasoning);
        turn.tokens += stepTokens;
        // a compaction is stored twice (timeline part + compaction part);
        // one row per operationId
        if (timelineEntry && !turn.timeline.some((e) => e.op === part.operationId)) turn.timeline.push(timelineEntry);
        if (part.type === "tool") turn.tools.push(toolSummary(part));
        else if (part.type === "file") turn.files.push(fileSummary(part));
        if (timelineEntry) timelineEntry.op = part.operationId || undefined;
      }
      turns.push(turn);
    }

    // Attach each agentic turn's usage to the LAST substantive assistant
    // message of its exchange (the desktop shows one footer per answer, after
    // the final text). Separator-only messages (timeline/model-change rows)
    // are assistant-role too — they must neither take the footer themselves
    // nor displace it from the turn they annotate.
    const substantive = (t) =>
      !!(t.texts.length || t.reasonings.length || (t.tools && t.tools.length) || (t.files && t.files.length) || t.error);
    let lastUserMsgId = null;
    if (contextRow) {
      try {
        if (JSON.parse(contextRow.mdata)?.role === "user") lastUserMsgId = contextRow.mid;
      } catch { /* malformed context row: no inherited footer anchor */ }
    }
    for (const t of turns) {
      if (t.role === "user") lastUserMsgId = t.mid;
      t.prevUserMsgId = lastUserMsgId;
    }
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.role === "user" || !substantive(t)) continue;
      const next = turns[i + 1];
      if (next && next.role !== "user" && substantive(next)) continue; // a later substantive assistant message closes the exchange
      const u = usage.get(t.prevUserMsgId || "");
      if (u) {
        t.turnStatus = u.status;
        t.durationMs = u.durationMs;
      }
    }
    const all = turns
      .filter((t) => t.texts.length || t.error || t.reasonings.length || (t.tools && t.tools.length) || (t.files && t.files.length) || (t.timeline && t.timeline.length))
      .map((t) => {
        // turn_usage is written when the turn ends; mid-run or mid-step, the
        // message carries no completed timestamp either. Message-time diffs
        // are only a fallback for stores without turn_usage (older CLIs).
        const durationMs = t.durationMs
          || (!usage.size && t.msgCompleted && t.msgCreated ? t.msgCompleted - t.msgCreated : 0);
        return {
          id: t.mid,
          role: t.role,
          text: t.texts.length ? t.texts.join("\n") : "",
          reasoning: t.reasonings.length ? t.reasonings.join("\n") : "",
          createdAt: t.msgCreated || null,
          tokens: t.tokens,
          timeline: (t.timeline || []).map(({ op, ...e }) => e),
          tools: t.tools || [],
          files: t.files || [],
          error: t.error || null,
          durationMs: durationMs || null,
          incomplete: !t.msgCompleted && !t.durationMs && t.role === "assistant",
        };
      });
    // pagination-independent token total for the WHOLE session — the web UI's
    // telemetry must not redefine "session total" as the reader pages back
    let tokensTotal = null;
    let contextTokens = null;
    try {
      tokensTotal = Number(this.query(
        `SELECT COALESCE(SUM(json_extract(data, '$.tokens.total')), 0) AS n
           FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'step-finish'`,
        [sessionId]
      )[0]?.n) || 0;
      // ZWUI-067 (live QA): each agentic step RE-FEEDS the context, so
      // step-finish tokens.total is that step's input+output usage — summing
      // 1800 steps reads as "358M session tokens", which is billing-true but
      // meaningless as a size. The LATEST total is the desktop's "current
      // context" and is what the context chip should show.
      contextTokens = Number(this.query(
        `SELECT json_extract(data, '$.tokens.total') AS n
           FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'step-finish'
          ORDER BY rowid DESC LIMIT 1`,
        [sessionId]
      )[0]?.n) || null;
    } catch { /* older stores without step tokens: null */ }
    return { turns: all, total, hasMore: offset + limit < total, tokensTotal, contextTokens };
  }

  // Is a turn currently running in this session from ANY writer (desktop,
  // CLI, or this server)? Mid-run the newest message is an assistant message
  // whose time.completed the CLI only writes when the turn ends. A recency
  // guard keeps crashed runs from looking busy forever.
  runActive(sessionId) {
    return this.runInfo(sessionId).active;
  }

  runInfo(sessionId) {
    const row = this.query(
      `SELECT json_extract(m.data, '$.role') AS role,
              json_extract(m.data, '$.time.completed') AS completed,
              json_extract(m.data, '$.time.created') AS created
         FROM message m
        WHERE m.session_id = ?
        ORDER BY m.sequence DESC LIMIT 1`,
      [sessionId]
    )[0];
    // mid-run the newest message is the assistant reply the CLI is still
    // streaming — time.completed is only written when the turn ends
    const startedAt = Number(row?.created) || 0;
    const active =
      !!row && row.role === "assistant" && row.completed == null &&
      Date.now() - startedAt >= 0 && Date.now() - startedAt < 6 * 3600_000;
    return { active, startedAt: active ? startedAt : null };
  }

  // Workspace-wide analytics from the CLI's own records: token sums from
  // step-finish parts, durations/status from turn_usage — no estimates.
  //
  // ZWUI-043: never blocks the API. The aggregation runs on a worker thread
  // (server/analytics-worker.js) with its own read-only connection; this
  // method returns the last good snapshot instantly — flagged stale when
  // past its TTL — or { data: null } while the FIRST build for a root set
  // is still running (the caller answers 202 and the client retries).
  requestAnalytics(roots, days = 14) {
    const key = roots.join("|");
    const c = this.analyticsCache;
    const now = Date.now();
    const fresh = Boolean(c && c.key === key && c.value && !c.error && now - c.builtAt < ANALYTICS_TTL_MS);
    const retryOk = !c || !c.error || now - c.builtAt > ANALYTICS_ERROR_RETRY_MS;
    if (!fresh && retryOk) this.ensureAnalyticsBuild(key, roots);
    if (!c || c.key !== key || !c.value) return { data: null, pending: true, error: c?.error || null };
    const { dailyRaw, ...value } = c.value;
    return {
      data: { ...value, daily: sliceDaily(dailyRaw, days, now) },
      generatedAt: c.builtAt,
      stale: !fresh,
    };
  }

  // One build at a time per root set; failures clear the in-flight marker
  // (message AND worker error/exit paths) so later requests can retry.
  ensureAnalyticsBuild(key, roots) {
    if (this.analyticsInflight.has(key)) return;
    this.analyticsInflight.add(key);
    try {
      this.analyticsWorker ||= this.spawnAnalyticsWorker();
    } catch (e) {
      this.analyticsInflight.delete(key);
      console.error("[analytics] worker spawn failed:", e?.message || e);
      return;
    }
    const id = ++this.analyticsSeq;
    const onMessage = (msg) => {
      if (msg.id !== id) return;
      this.analyticsWorker?.off("message", onMessage);
      this.analyticsInflight.delete(key);
      if (msg.error) {
        // keep any stale snapshot visible; record the failure so the route
        // can answer honestly and a retry happens after the backoff
        if (this.analyticsCache?.key === key) this.analyticsCache.error = msg.error;
        else this.analyticsCache = { key, value: null, builtAt: Date.now(), error: msg.error };
        console.error("[analytics] rebuild failed:", msg.error);
        return;
      }
      this.analyticsCache = { key, value: msg.value, builtAt: Date.now() };
    };
    this.analyticsWorker.on("message", onMessage);
    this.analyticsWorker.postMessage({ id, roots });
  }

  spawnAnalyticsWorker() {
    const w = new Worker(new URL("./analytics-worker.js", import.meta.url), {
      workerData: { dbPath: this.dbPath },
    });
    // never hold the process open for a background refresher: the HTTP
    // server keeps the event loop alive in production, and a CLI/test run
    // must be able to exit with the worker still idle
    w.unref();
    const down = (reason) => {
      if (this.analyticsWorker !== w) return;
      this.analyticsWorker = null;
      // every pending build just died: release the keys, keep stale data
      for (const k of this.analyticsInflight) {
        if (this.analyticsCache?.key === k) this.analyticsCache.error = reason;
        else this.analyticsCache = { key: k, value: null, builtAt: Date.now(), error: reason };
      }
      this.analyticsInflight.clear();
      console.error("[analytics] worker down:", reason);
    };
    w.on("error", (err) => down(String(err?.message || err)));
    w.on("exit", (code) => { if (code !== 0) down(`worker exited with code ${code}`); });
    return w;
  }
}

// ---- Content search (ZWUI-029 extension) ----
// A LIKE scan over the CLI's parts table takes ~60s on a large store — not
// viable interactively. This sidecar FTS5 index (OUR file, the CLI's DB is
// never written) is built incrementally in rowid-ordered chunks: each call
// to `indexChunk` indexes at most `chunk` source parts within a time budget,
// and `search` queries whatever is indexed so far. Convergence takes a few
// searches on huge stores; the response reports progress.
export class ContentSearchIndex {
  constructor(dbPath, sourceDbPath) {
    this.dbPath = dbPath;
    this.sourceDbPath = sourceDbPath;
    this.ready = false;
  }

  #open() {
    if (!existsSync(this.sourceDbPath)) return null;
    if (!this.ready) {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      const db = new DatabaseSync(this.dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(text, session_id UNINDEXED, message_id UNINDEXED);
      `);
      // ZWUI-059: search joins the SOURCE session table for scoping — the
      // sidecar only holds the FTS parts, so attach the CLI DB (read path
      // only; nothing here writes to src.*)
      db.exec(`ATTACH DATABASE '${this.sourceDbPath.replace(/'/g, "''")}' AS src`);
      this.db = db;
      this.ready = true;
    }
    return this.db;
  }

  #maxSourceRowid(source) {
    const r = source.prepare("SELECT max(rowid) AS m FROM part").get();
    return Number(r?.m) || 0;
  }

  #indexedThrough() {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'through'").get();
    return Number(r?.value) || 0;
  }

  // Index at most `chunk` source parts (rowid-ordered) or `budgetMs` of work.
  // Returns { indexedThrough, total } — total = the source's max rowid.
  indexChunk(roots, { chunk = 20_000, budgetMs = 400 } = {}) {
    // ZWUI-059: a missing source DB is a normal condition (fresh install),
    // not a crash — report an empty index instead of throwing ENOENT.
    if (!existsSync(this.sourceDbPath)) return { indexedThrough: 0, total: 0 };
    const source = new DatabaseSync(this.sourceDbPath, { readOnly: true });
    try {
      if (!this.#open()) return { indexedThrough: 0, total: 0 };
      const total = this.#maxSourceRowid(source);
      let through = this.#indexedThrough();
      const t0 = Date.now();
      if (through < total) {
        const scope = directoryScope("s.directory", roots);
        const rows = source
          .prepare(
            `SELECT p.rowid AS rid, p.session_id AS sid, p.message_id AS mid,
                    json_extract(p.data, '$.text') AS text
               FROM part p JOIN session s ON s.id = p.session_id
              WHERE p.rowid > ? AND p.rowid <= ?
                AND json_extract(p.data, '$.type') = 'text'
                AND (${scope.sql})
              ORDER BY p.rowid LIMIT ?`
          )
          // node:sqlite binds anonymous parameters positionally — the scope
          // params must be spread, not passed as a single array argument
          .all(through, through + chunk, ...scope.params, chunk);
        const ins = this.db.prepare("INSERT INTO parts_fts (text, session_id, message_id) VALUES (?, ?, ?)");
        this.db.exec("BEGIN");
        for (const r of rows) {
          if (typeof r.text === "string" && r.text.trim()) ins.run(r.text.slice(0, 50_000), r.sid, r.mid);
        }
        // advance the watermark past the chunk even if no text rows matched
        through = Math.min(through + chunk, total);
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('through', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(through));
        this.db.exec("COMMIT");
      }
      return { indexedThrough: through, total, ms: Date.now() - t0, budgetExceeded: Date.now() - t0 > budgetMs };
    } finally {
      source.close();
    }
  }

  // Match strings are used verbatim as FTS phrases; FTS5 syntax characters
  // are quoted away by wrapping each token in double quotes.
  search(q, roots, limit = 20) {
    if (!this.#open()) return [];
    const phrase = q.replace(/"/g, '""').split(/\s+/).filter(Boolean).map((t) => `"${t}"`).join(" ");
    if (!phrase) return [];
    const scope = directoryScope("s.directory", roots);
    return this.db
      .prepare(
        `SELECT DISTINCT s.id, s.title, s.directory, s.time_updated
           FROM parts_fts f JOIN src.session s ON s.id = f.session_id
          WHERE parts_fts MATCH ?
            AND ${scope.sql}
          ORDER BY s.time_updated DESC LIMIT ?`
      )
      .all(phrase, ...scope.params, limit)
      .map((r) => ({ id: r.id, title: r.title, directory: r.directory, updatedAt: Number(r.time_updated) }));
  }

}

// Session rename: the CLI stores the title on the session row itself and
// marks user-set titles with title_source='user'. We write exactly that.
export function renameSession(dbPath, sessionId, title) {
  const db = new DatabaseSync(dbPath);
  try {
    const info = db
      .prepare("UPDATE session SET title = ?, title_source = 'user', time_title_updated = ? WHERE id = ? AND id NOT LIKE 'sess_subagent_%'")
      .run(String(title).slice(0, 200), Date.now(), sessionId);
    return info.changes > 0;
  } finally {
    db.close();
  }
}
