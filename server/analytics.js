// Workspace analytics aggregation — a PURE function over an injected query
// fn so it can run identically on the main thread (tests, small stores) and
// inside the analytics worker thread (production, huge stores).
//
// The canonical window is the largest serveable one: per-request ?days=
// windows are SLICED from dailyRaw at serve time (sliceDaily), so one
// expensive build serves every window and the daily series is zero-filled
// over real calendar days — not "the N most recent days that happen to have
// activity".
import { directoryScope } from "./directory-scope.js";

export const ANALYTICS_WINDOW_DAYS = 60;

export function computeAnalytics(query, roots, now = Date.now()) {
  const scope = directoryScope("s.directory", roots);
  const scoped = scope.params.length ? `AND ${scope.sql}` : "";
  const params = scope.params;

  const sessions = query(
    `SELECT COUNT(*) AS n FROM session s WHERE 1=1 ${scoped}`,
    params
  )[0];
  const totals = query(
    `SELECT
       COALESCE(SUM(json_extract(p.data, '$.tokens.total')), 0) AS tokens,
       COUNT(*) AS steps
     FROM part p JOIN session s ON s.id = p.session_id
     WHERE json_extract(p.data, '$.type') = 'step-finish' ${scoped}`,
    params
  )[0];
  const usage = query(
    `SELECT
       COUNT(*) AS turns,
       COALESCE(SUM(u.duration_ms), 0) AS duration_ms,
       COALESCE(SUM(CASE WHEN u.status = 'error' THEN 1 ELSE 0 END), 0) AS errors
     FROM turn_usage u JOIN session s ON s.id = u.session_id ${scoped}`,
    params
  )[0];

  const windowStart = now - ANALYTICS_WINDOW_DAYS * 24 * 3600_000;
  const dailyRaw = query(
    `SELECT date(s.time_updated / 1000, 'unixepoch') AS day, COUNT(*) AS n
       FROM session s WHERE s.time_updated >= ${windowStart} ${scoped}
      GROUP BY day`,
    params
  ).map((r) => ({ day: r.day, sessions: Number(r.n) || 0 }));

  // top sessions by committed tokens — ONE grouped scan of the parts table
  // (per-session correlated SUMs would rescan per session)
  const topSessions = query(
    `SELECT s.id, s.title, s.directory, s.time_updated, t.tokens
       FROM session s
       JOIN (SELECT session_id, SUM(json_extract(data, '$.tokens.total')) AS tokens
               FROM part WHERE json_extract(data, '$.type') = 'step-finish'
              GROUP BY session_id) t ON t.session_id = s.id
     WHERE 1=1 ${scoped}
     ORDER BY t.tokens DESC LIMIT 5`,
    params
  ).map((r) => ({
    id: r.id,
    title: r.title,
    directory: r.directory,
    updatedAt: Number(r.time_updated) || 0,
    tokens: Number(r.tokens) || 0,
  }));

  // active sessions in ONE query: the newest message of every session
  // touched in the last 24h is an assistant message whose time.completed the
  // CLI only writes when the turn ends (same semantics as runInfo, including
  // its 6h recency guard against crashed runs looking busy forever)
  const activeRow = query(
    `SELECT COUNT(*) AS n
       FROM session s
       JOIN message m ON m.session_id = s.id
        AND m.sequence = (SELECT MAX(sequence) FROM message WHERE session_id = s.id)
      WHERE s.time_updated >= ${now - 24 * 3600_000}
        AND json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(m.data, '$.time.completed') IS NULL
        AND json_extract(m.data, '$.time.created') >= ${now - 6 * 3600_000}
        AND json_extract(m.data, '$.time.created') <= ${now}
        ${scoped}`,
    params
  )[0];

  return {
    sessions: Number(sessions?.n) || 0,
    tokens: Number(totals?.tokens) || 0,
    steps: Number(totals?.steps) || 0,
    turns: Number(usage?.turns) || 0,
    agentTimeMs: Number(usage?.duration_ms) || 0,
    failedTurns: Number(usage?.errors) || 0,
    activeSessions: Number(activeRow?.n) || 0,
    dailyRaw,
    topSessions,
  };
}

// Serve-time window slice: the last `days` CALENDAR days (UTC, matching the
// SQL date()), zero-filled.
export function sliceDaily(dailyRaw, days, now = Date.now()) {
  const counts = new Map((dailyRaw || []).map((d) => [d.day, d.sessions]));
  const out = [];
  for (let i = Math.max(0, days - 1); i >= 0; i--) {
    const day = new Date(now - i * 24 * 3600_000).toISOString().slice(0, 10);
    out.push({ day, sessions: counts.get(day) || 0 });
  }
  return out;
}
