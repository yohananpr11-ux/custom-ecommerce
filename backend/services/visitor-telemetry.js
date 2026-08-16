'use strict';

// First-party visitor/session storage (PR #34). Deliberately holds no raw
// IP and no browser fingerprinting -- just the opaque client-generated
// visitor_id/session_id plus a few safe, low-cardinality classification
// fields. session_id is the idempotency key: recordSessionStart() only
// reports isNew=true the one time a given session_id is genuinely inserted
// for the first time (INSERT OR IGNORE + changes-count), so a reload, a
// duplicate HTTP retry, or SPA navigation can never look like a new session.

const db = require('../db');

const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function (err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

// Small, dependency-free source classifier -- just enough to give the owner
// a useful "where did this visitor come from" hint. Not a replacement for
// real attribution tooling, and intentionally has no third-party calls.
function classifySource(referrer) {
  if (!referrer || typeof referrer !== 'string') return 'direct';
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  if (!host) return 'direct';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)(facebook|instagram|fb)\./.test(host)) return 'meta';
  if (/(^|\.)tiktok\./.test(host)) return 'tiktok';
  if (/(^|\.)(bing|yahoo|duckduckgo)\./.test(host)) return 'search';
  return 'referral';
}

/**
 * Idempotent session-start insert. Returns isNew=true only for the request
 * that genuinely created the row.
 */
async function recordSessionStart({
  visitorId,
  sessionId,
  landingPath,
  referrer,
  source,
  deviceCategory,
  uaClassification,
}) {
  const isHuman = uaClassification === 'human';
  const resolvedSource = source || classifySource(referrer);

  const result = await dbRunAsync(
    `INSERT OR IGNORE INTO visitor_sessions
       (visitor_id, session_id, landing_path, referrer, source, device_category, ua_classification, is_human)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [visitorId, sessionId, landingPath || null, referrer || null, resolvedSource, deviceCategory || null, uaClassification, isHuman ? 1 : 0]
  );

  const isNew = result.changes > 0;
  if (!isNew) {
    // Existing session (reload/retry) -- just bump last_seen_at. Best-effort:
    // this must never fail the caller's request over a housekeeping update.
    dbRunAsync(`UPDATE visitor_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ?`, [sessionId]).catch(() => null);
  }

  return { isNew, isHuman, source: resolvedSource };
}

async function markNotified(sessionId) {
  await dbRunAsync(`UPDATE visitor_sessions SET notified = 1 WHERE session_id = ?`, [sessionId]);
}

module.exports = { recordSessionStart, markNotified, classifySource };
