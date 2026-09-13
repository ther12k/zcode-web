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

export class SessionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
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
    const like = `%${q.replace(/[%_]/g, "!$&").replace(/'/g, "''")}%`;
    const placeholders = roots.map(() => "?").join(", ");
    const rows = this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE title LIKE ? ESCAPE '!' AND (${roots.map(() => "directory LIKE ? || '%'").join(" OR ")})
          AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC LIMIT ?`,
      [like, ...roots, limit]
    );
    return rows.map((r) => ({
      id: r.id, title: r.title, directory: r.directory,
      updatedAt: Number(r.time_updated),
    }));
  }

  recentUnder(root, limit = 30) {
    return this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE directory LIKE ? || '%' AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC LIMIT ?`,
      [root, limit]
    ).map((r) => ({ id: r.id, title: r.title, directory: r.directory, updatedAt: Number(r.time_updated) }));
  }

  // Latest sessions across ALL allowed roots in one query — the search
  // dialog's empty-state list ("show me my 50 most recent sessions").
  recent(roots, limit = 50) {
    if (!roots.length) return [];
    return this.query(
      `SELECT id, title, directory, time_updated FROM session
        WHERE id NOT LIKE 'sess_subagent_%' AND (${roots.map(() => "directory LIKE ? || '%'").join(" OR ")})
        ORDER BY time_updated DESC LIMIT ?`,
      [...roots, limit]
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
  // The part window keeps the NEWEST parts: long-running sessions (hourly
  // automations) exceed any fixed cap, and an ascending LIMIT would silently
  // hide the latest turns — the ones both the UI and the desktop show. The
  // rows are fetched newest-first and re-reversed for the turn builder.
  transcript(sessionId, { limit = 400, offset = 0 } = {}) {
    const rows = this.query(
      `SELECT m.data AS mdata, m.sequence AS mseq, p.sequence AS pseq, p.data AS pdata
         FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id = ?
        ORDER BY m.sequence DESC, p.sequence DESC
        LIMIT 6000`,
      [sessionId]
    ).reverse();
    const turns = [];
    for (const r of rows) {
      let msg = {};
      let part = {};
      try { msg = JSON.parse(r.mdata); } catch { /* keep {} */ }
      try { part = JSON.parse(r.pdata); } catch { /* keep {} */ }
      // reasoning parts carry .text too — the desktop keeps them out of the
      // rendered answer (collapsible "Thinking"), so must we
      const text = typeof part.text === "string" && part.type !== "reasoning" ? part.text : "";
      const reasoning = part.type === "reasoning" && typeof part.text === "string" ? part.text : "";
      const stepTokens = part.type === "step-finish" ? Number(part.tokens?.total) || 0 : 0;
      const last = turns[turns.length - 1];
      if (last && last.mseq === r.mseq) {
        if (text.trim()) last.texts.push(text);
        if (reasoning) last.reasonings.push(reasoning);
        last.tokens += stepTokens;
        if (part.type === "tool") last.tools.push(toolSummary(part));
        else if (part.type === "file") last.files.push(fileSummary(part));
      } else {
        const errMsg =
          msg.error?.data?.message || msg.error?.message || msg.error?.name || null;
        turns.push({
          role: msg.role || "?", mseq: r.mseq,
          texts: text.trim() ? [text] : [],
          reasonings: reasoning ? [reasoning] : [],
          tokens: stepTokens,
          tools: part.type === "tool" ? [toolSummary(part)] : [],
          files: part.type === "file" ? [fileSummary(part)] : [],
          error: errMsg,
        });
      }
    }    // one entry per logical message (mseq), each carrying its text plus tool
    // and file parts — pagination must not split a message from its artifacts
    const all = turns
      .filter((t) => t.texts.length || t.error || t.reasonings.length || (t.tools && t.tools.length) || (t.files && t.files.length))
      .map((t) => ({
        role: t.role,
        text: t.texts.length ? t.texts.join("\n") : t.error ? `⚠ turn failed: ${t.error}` : "",
        reasoning: t.reasonings.length ? t.reasonings.join("\n") : "",
        tokens: t.tokens,
        tools: t.tools || [],
        files: t.files || [],
      }));
    const total = all.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    return { turns: all.slice(start, end), total, hasMore: start > 0 };
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
    const source = new DatabaseSync(this.sourceDbPath, { readOnly: true });
    try {
      if (!this.#open()) return { indexedThrough: 0, total: 0 };
      const total = this.#maxSourceRowid(source);
      let through = this.#indexedThrough();
      const t0 = Date.now();
      if (through < total) {
        const rootClauses = roots.map(() => "s.directory LIKE ? || '%'").join(" OR ");
        const rows = source
          .prepare(
            `SELECT p.rowid AS rid, p.session_id AS sid, p.message_id AS mid,
                    json_extract(p.data, '$.text') AS text
               FROM part p JOIN session s ON s.id = p.session_id
              WHERE p.rowid > ? AND p.rowid <= ?
                AND json_extract(p.data, '$.type') = 'text'
                AND (${rootClauses})
              ORDER BY p.rowid LIMIT ?`
          )
          .all(through, through + chunk, roots, chunk);
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
    const rootClauses = roots.map(() => "s.directory LIKE ? || '%'").join(" OR ");
    return this.db
      .prepare(
        `SELECT DISTINCT s.id, s.title, s.directory, s.time_updated
           FROM parts_fts f JOIN session s ON s.id = f.session_id
          WHERE parts_fts MATCH ?
            AND (${rootClauses})
          ORDER BY s.time_updated DESC LIMIT ?`
      )
      .all(phrase, ...roots, limit)
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
