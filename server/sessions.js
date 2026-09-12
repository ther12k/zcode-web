// Read-only access to the ZCode CLI session store (~/.zcode/cli/db/db.sqlite).
// The same database the CLI writes and the ZCode Desktop app reads.
// Schema observed on CLI 0.16.5:
//   session(id, title, directory, time_created, time_updated, ...)
//   message(id, session_id, data JSON{role,...}, sequence)
//   part(id, message_id, session_id, data JSON{type,text,...}, sequence)

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

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
  transcript(sessionId, limit = 400) {
    const rows = this.query(
      `SELECT m.data AS mdata, m.sequence AS mseq, p.sequence AS pseq, p.data AS pdata
         FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id = ?
        ORDER BY m.sequence, p.sequence
        LIMIT ?`,
      [sessionId, limit]
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
      } else {
        const errMsg =
          msg.error?.data?.message || msg.error?.message || msg.error?.name || null;
        turns.push({ role: msg.role || "?", mseq: r.mseq, texts: text.trim() ? [text] : [], error: errMsg });
      }
    }
    return turns.map(({ role, texts, error }) => ({
      role,
      text: texts.length ? texts.join("\n") : error ? `⚠ turn failed: ${error}` : "",
    })).filter((t) => t.text);
  }
}
