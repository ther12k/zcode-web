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
  const detail =
    input.command || input.filePath || input.path || input.query ||
    input.pattern || input.url || Object.keys(input).length
      ? JSON.stringify(input)
      : "";
  return {
    name: part.tool || "tool",
    status: part.state?.status || "unknown",
    detail: detail.slice(0, 160),
  };
}

export class SessionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  query(sql, params = []) {
    if (!existsSync(this.dbPath)) return [];
    let db;
    try {
      db = new DatabaseSync(this.dbPath, { readOnly: true });
    } catch {
      db = new DatabaseSync(this.dbPath);
    }
    try {
      return db.prepare(sql).all(...params);
    } catch {
      return [];
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
      } else {
        const errMsg =
          msg.error?.data?.message || msg.error?.message || msg.error?.name || null;
        turns.push({
          role: msg.role || "?", mseq: r.mseq,
          texts: text.trim() ? [text] : [],
          tools: part.type === "tool" ? [toolSummary(part)] : [],
          error: errMsg,
        });
      }
    }
    const all = [];
    for (const t of turns) {
      if (t.texts.length) all.push({ role: t.role, text: t.texts.join("\n") });
      else if (t.error) all.push({ role: t.role, text: `⚠ turn failed: ${t.error}` });
      if (t.tools) for (const tool of t.tools) all.push({ role: t.role, tool });
    }
    const total = all.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    return { turns: all.slice(start, end), total, hasMore: start > 0 };
  }
}
