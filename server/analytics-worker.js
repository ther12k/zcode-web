// Analytics worker: aggregation runs on its OWN thread with its own
// read-only connection. A minutes-long json_extract scan on a large store
// must never occupy the API's event loop — setImmediate only POSTPONES
// synchronous work, it does not thread it.
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { computeAnalytics } from "./analytics.js";

const dbPath = workerData?.dbPath;
let db = null;

function query(sql, params = []) {
  if (!db) {
    if (!existsSync(dbPath)) {
      throw Object.assign(new Error("session database not found at " + dbPath), { code: "DB_MISSING" });
    }
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (openErr) {
      // readonly open can fail while the CLI holds a write lock in WAL edge
      // cases — retry through a normal connection before giving up
      try {
        db = new DatabaseSync(dbPath);
      } catch {
        throw Object.assign(new Error("session database could not be opened: " + openErr.message), { code: "DB_OPEN_FAILED" });
      }
    }
  }
  return db.prepare(sql).all(...params);
}

parentPort.on("message", ({ id, roots }) => {
  try {
    parentPort.postMessage({ id, value: computeAnalytics(query, roots) });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e), code: e && e.code });
  }
});
