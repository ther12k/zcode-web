// Read-only access to the ZCode CLI session store (~/.zcode/cli/db/db.sqlite).
// The same database the CLI writes and the ZCode Desktop app reads.
// Schema observed on CLI 0.16.5:
//   session(id, title, directory, time_created, time_updated, ...)
//   message(id, session_id, data JSON{role,...}, sequence)
//   part(id, message_id, session_id, data JSON{type,text,...}, sequence)

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

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
  transcript(sessionId, { limit = 400, offset = 0 } = {}) {
    const rows = this.query(
      `SELECT m.data AS mdata, m.sequence AS mseq, p.sequence AS pseq, p.data AS pdata
         FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id = ?
        ORDER BY m.sequence, p.sequence
        LIMIT 2000`,
      [sessionId]
    );
    const turns = [];
    for (const r of rows) {
      let msg = {};
      let part = {};
      try { msg = JSON.parse(r.mdata); } catch { /* keep {} */ }
      try { part = JSON.parse(r.pdata); } catch { /* keep {} */ }
      const text = typeof part.text === "string" ? part.text : "";
      const last = turns[turns.length - 1];
      if (last && last.mseq === r.mseq) {
        if (text.trim()) last.texts.push(text);
        else if (part.type === "tool") last.tools.push(toolSummary(part));
        else if (part.type === "file") last.files.push(fileSummary(part));
      } else {
        const errMsg =
          msg.error?.data?.message || msg.error?.message || msg.error?.name || null;
        turns.push({
          role: msg.role || "?", mseq: r.mseq,
          texts: text.trim() ? [text] : [],
          tools: part.type === "tool" ? [toolSummary(part)] : [],
          files: part.type === "file" ? [fileSummary(part)] : [],
          error: errMsg,
        });
      }
    }    // one entry per logical message (mseq), each carrying its text plus tool
    // and file parts — pagination must not split a message from its artifacts
    const all = turns
      .filter((t) => t.texts.length || t.error || (t.tools && t.tools.length) || (t.files && t.files.length))
      .map((t) => ({
        role: t.role,
        text: t.texts.length ? t.texts.join("\n") : t.error ? `⚠ turn failed: ${t.error}` : "",
        tools: t.tools || [],
        files: t.files || [],
      }));
    const total = all.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    return { turns: all.slice(start, end), total, hasMore: start > 0 };
  }
}
