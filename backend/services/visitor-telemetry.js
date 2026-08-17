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

/**
 * Extract safe hostname from referrer string.
 * Strips protocol, query params, paths, port, and www.
 * Returns null if direct/empty/internal.
 */
function extractReferrerDomain(referrer) {
  if (!referrer || typeof referrer !== 'string') return null;
  const trimmed = referrer.trim();
  if (!trimmed || trimmed.toLowerCase() === 'direct') return null;

  let hostname = null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    hostname = url.hostname.toLowerCase();
  } catch {
    const clean = trimmed.split('?')[0].split('#')[0].replace(/^[a-zA-Z0-9+.-]+:\/\//, '').split('/')[0];
    hostname = clean.toLowerCase();
  }

  if (!hostname) return null;
  // Strip leading www.
  hostname = hostname.replace(/^www\./, '');
  // Strip port
  hostname = hostname.split(':')[0];

  // If it's an internal domain (shopjono.com / localhost), treat as internal / null
  if (/^(shopjono\.com|localhost|127\.0\.0\.1|custom-ecommerce.*\.onrender\.com)$/.test(hostname)) {
    return null;
  }

  // Normalize common social/referral subdomains
  if (hostname.endsWith('.instagram.com') || hostname === 'l.instagram.com') return 'instagram.com';
  if (hostname.endsWith('.facebook.com') || hostname === 'l.facebook.com' || hostname === 'm.facebook.com' || hostname === 'fb.com') return 'facebook.com';
  if (hostname.endsWith('.tiktok.com')) return 'tiktok.com';
  if (hostname === 't.co' || hostname.endsWith('.twitter.com') || hostname.endsWith('.x.com')) return 'x.com';
  if (hostname.endsWith('.linkedin.com') || hostname === 'lnkd.in') return 'linkedin.com';
  if (hostname.endsWith('.pinterest.com')) return 'pinterest.com';
  if (hostname.endsWith('.reddit.com')) return 'reddit.com';
  if (hostname.endsWith('.youtube.com') || hostname === 'youtu.be') return 'youtube.com';

  return hostname.slice(0, 50);
}

/**
 * One canonical source-classification function for both real-time alerts
 * and daily owner report aggregation.
 */
function resolveSessionSource({ referrer, source } = {}) {
  // 1. If explicit source (e.g. UTM source) is provided and non-empty
  if (source && typeof source === 'string') {
    const cleanSource = source.trim().replace(/[^\x20-\x7E]/g, '').slice(0, 50);
    if (cleanSource && cleanSource.toLowerCase() !== 'direct') {
      return cleanSource;
    }
  }

  // 2. Derive source from referrer domain if present
  const refDomain = extractReferrerDomain(referrer);
  if (refDomain) {
    return refDomain;
  }

  // 3. Fallback to direct
  return 'direct';
}

/**
 * Legacy backwards compatibility classifier.
 */
function classifySource(referrer) {
  return resolveSessionSource({ referrer });
}

/**
 * Format source for human-readable display in daily report / summaries.
 */
function formatSourceDisplay(source) {
  if (!source || typeof source !== 'string') return 'Direct / ישיר';
  const clean = source.trim();
  if (!clean || clean.toLowerCase() === 'direct') return 'Direct / ישיר';
  return clean;
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
  const resolvedSource = resolveSessionSource({ referrer, source });
  const safeReferrer = extractReferrerDomain(referrer);

  const result = await dbRunAsync(
    `INSERT OR IGNORE INTO visitor_sessions
       (visitor_id, session_id, landing_path, referrer, source, device_category, ua_classification, is_human)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [visitorId, sessionId, landingPath || null, safeReferrer || null, resolvedSource, deviceCategory || null, uaClassification, isHuman ? 1 : 0]
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

module.exports = {
  recordSessionStart,
  markNotified,
  classifySource,
  extractReferrerDomain,
  resolveSessionSource,
  formatSourceDisplay,
};
