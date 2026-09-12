// G2: session-history adapter under Bun. Uses node:sqlite first (the Node
// server's driver) with bun:sqlite as a demonstrated-defect fallback, so the
// compatibility claim is backed by whichever actually ran.

import { existsSync } from "node:fs";

export class SessionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.driver = "none";
  }

  query(sql, params = []) {
    if (!existsSync(this.dbPath)) return [];
    if (!this.db) {
      // node:sqlite first; bun:sqlite fallback if unavailable
      try {
        const { DatabaseSync } = require("node:sqlite");
        this.db = new DatabaseSync(this.dbPath, { readOnly: true });
        this.driver = "node:sqlite";
      } catch {
        const { Database } = require("bun:sqlite");
        this.db = new Database(this.dbPath, { readonly: true });
        this.driver = "bun:sqlite";
      }
    }
    try {
      return this.db.prepare(sql).all(...params);
    } catch {
      return [];
    }
  }

  list(directory, limit = 100) {
    return this.query(
      `SELECT id, title, directory, time_created, time_updated, task_type
         FROM session
        WHERE directory = ? AND id NOT LIKE 'sess_subagent_%'
        ORDER BY time_updated DESC LIMIT ?`,
      [directory, limit]
    ).map((r) => ({
      id: r.id, title: r.title, directory: r.directory,
      taskType: r.task_type,
      createdAt: Number(r.time_created), updatedAt: Number(r.time_updated),
    }));
  }

  get(sessionId) {
    const rows = this.query(
      `SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`,
      [sessionId]
    );
    const r = rows[0];
    return r
      ? { id: r.id, title: r.title, directory: r.directory,
          createdAt: Number(r.time_created), updatedAt: Number(r.time_updated) }
      : null;
  }

  transcript(sessionId, { limit = 5, offset = 0 } = {}) {
    const rows = this.query(
      `SELECT m.data AS mdata, m.sequence AS mseq, p.sequence AS pseq, p.data AS pdata
         FROM part p JOIN message m ON m.id = p.message_id
        WHERE p.session_id = ?
        ORDER BY m.sequence, p.sequence LIMIT 2000`,
      [sessionId]
    );
    const turns = [];
    for (const r of rows) {
      let msg = {}, part = {};
      try { msg = JSON.parse(r.mdata); } catch {}
      try { part = JSON.parse(r.pdata); } catch {}
      const text = typeof part.text === "string" ? part.text : "";
      const last = turns[turns.length - 1];
      if (last && last.mseq === r.mseq) {
        if (text.trim()) last.texts.push(text);
        else if (part.type === "tool") last.tools.push(toolSummary(part));
        else if (part.type === "file") last.files.push(fileSummary(part));
      } else {
        turns.push({
          role: msg.role || "?", mseq: r.mseq,
          texts: text.trim() ? [text] : [],
          tools: part.type === "tool" ? [toolSummary(part)] : [],
          files: part.type === "file" ? [fileSummary(part)] : [],
          error: msg.error?.data?.message || msg.error?.message || msg.error?.name || null,
        });
      }
    }
    const all = turns
      .filter((t) => t.texts.length || t.error || t.tools.length || t.files.length)
      .map((t) => ({
        role: t.role,
        text: t.texts.length ? t.texts.join("\n") : t.error ? `⚠ turn failed: ${t.error}` : "",
        tools: t.tools, files: t.files,
      }));
    const total = all.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    return { turns: all.slice(start, end), total, hasMore: start > 0 };
  }
}

function toolSummary(part) {
  const input = part.state?.input || {};
  const primary = input.command || input.filePath || input.path || input.query || input.pattern || input.url;
  return {
    name: part.tool || "tool",
    status: part.state?.status || "unknown",
    detail: String(primary || JSON.stringify(input)).slice(0, 160),
  };
}

function fileSummary(part) {
  return {
    mime: part.mime || "application/octet-stream",
    url: typeof part.url === "string" ? part.url : "",
    size: Number(part.metadata?.sizeBytes) || null,
    storageKind: part.metadata?.storageKind || "attachment",
  };
}
