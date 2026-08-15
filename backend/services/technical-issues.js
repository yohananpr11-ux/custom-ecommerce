'use strict';

// Structured, deduped customer-impacting technical issue recording (PR
// #34, hardened in a follow-up commit). Stores enough for PR #35's
// reporting (type/severity/route/safe message/occurrence_count/
// session_id/order_id) and alerts the owner through the existing
// owner-notifications.js -- no parallel Telegram logic.
//
// The cooldown/re-notification DECISION is durable (backed by
// technical_issues.last_notified_at / notified_count in SQLite), not
// owner-notifications' in-memory-only Map -- a repeated issue stays
// suppressed across a process restart. owner-notifications.notify() is
// still the only thing that ever actually talks to Telegram; it's called
// with cooldownMs:0 here because the durable claim below is the
// authoritative gate.

const crypto = require('crypto');
const db = require('../db');
const ownerNotifications = require('./owner-notifications');

const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function (err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});
const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const MAX_MESSAGE_LEN = 200;
const MAX_ROUTE_LEN = 120;

// Explicit per-severity cooldown for issues specifically -- deliberately
// NOT relying on owner-notifications' own CRITICAL default (which is 0 /
// always-immediate), since an issue that keeps recurring must still be
// throttled even when it's severe. CRITICAL still cools down faster than
// WARNING so a genuinely urgent recurring problem resurfaces sooner.
const ISSUE_COOLDOWN_MS = {
  CRITICAL: 5 * 60 * 1000,
  WARNING: 15 * 60 * 1000,
};

// SQLite's CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" in UTC with no
// timezone marker -- new Date() on that exact shape is parsed as LOCAL
// time by JS engines, not UTC. On any machine not already at UTC+0 that
// silently corrupts every elapsed-time comparison below. Reshaping to a
// proper "...THH:MM:SSZ" ISO string forces the correct UTC interpretation.
function parseSqliteUtcTimestamp(value) {
  if (!value) return null;
  const iso = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function sanitizeMessage(message) {
  if (!message) return '';
  return String(message).replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LEN);
}

function sanitizeRoute(route) {
  if (!route) return '';
  // Query strings can carry tokens/PII -- never persisted or hashed in.
  const withoutQuery = String(route).split('?')[0];
  // Strip non-printable-ASCII to keep this safe to embed in a Telegram
  // message and a DB column without any further escaping surprises.
  return withoutQuery.replace(/[^\x20-\x7E]/g, '').slice(0, MAX_ROUTE_LEN);
}

function buildSignature({ type, route, message }) {
  const raw = `${type}|${sanitizeRoute(route)}|${sanitizeMessage(message)}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function buildMessageHtml({ type, safeRoute, safeMessage, orderId, occurrenceCount, notifiedCount }) {
  const recurrenceNote = notifiedCount > 1
    ? `\n<i>(notified ${notifiedCount} time${notifiedCount === 1 ? '' : 's'} for this issue so far)</i>`
    : '';
  return `<b>Customer-impacting issue</b>\n`
    + `<b>Type:</b> ${escapeHtml(type)}\n`
    + (safeRoute ? `<b>Route:</b> <code>${escapeHtml(safeRoute)}</code>\n` : '')
    + (safeMessage ? `<b>Details:</b> ${escapeHtml(safeMessage)}\n` : '')
    + (orderId ? `<b>Order:</b> #${escapeHtml(String(orderId))}\n` : '')
    + `<b>Occurrences:</b> ${occurrenceCount}${recurrenceNote}`;
}

// True only when Telegram genuinely confirmed delivery -- notify() itself
// always resolves with sent:true once it decides to attempt a send (it
// never throws for a real API failure, since telegram.sendMessage()
// catches its own errors), so the real signal lives one level deeper, in
// the telegram sub-result. Token/chat-id "unconfigured" is intentionally
// treated the same as a genuine failure here: this call did not actually
// reach anyone, so it must not be allowed to block a real future attempt
// for a full cooldown window.
function wasGenuinelyDelivered(notifyResult) {
  return Boolean(notifyResult && notifyResult.telegram && notifyResult.telegram.ok === true);
}

/**
 * Record a customer-impacting technical issue and, subject to a DURABLE
 * (SQLite-backed) cooldown, alert the owner. Safe to call on every
 * occurrence of the same underlying problem -- occurrence_count always
 * increments; the alert itself is gated separately and survives a process
 * restart, because the gate lives in the DB, not in memory.
 *
 * @param {object} params
 * @param {string} params.type - stable machine identifier, e.g. 'payment_capture_failure'
 * @param {string} [params.route] - request path (query string stripped)
 * @param {string} [params.message] - safe, non-PII summary (truncated, no tokens/passwords/bodies)
 * @param {string} [params.sessionId]
 * @param {number|string} [params.orderId]
 * @param {'CRITICAL'|'WARNING'} [params.severity] - defaults to WARNING
 */
async function recordIssue({ type, route, message, sessionId, orderId, severity = 'WARNING' } = {}) {
  if (!type) throw new Error('technical-issues: type is required');
  const effectiveSeverity = ownerNotifications.SEVERITY[severity] ? severity : 'WARNING';

  const safeMessage = sanitizeMessage(message);
  const safeRoute = sanitizeRoute(route);
  const signature = buildSignature({ type, route: safeRoute, message: safeMessage });

  // Occurrence tracking is unconditional: every sighting increments
  // occurrence_count and bumps last_seen_at, regardless of whether this
  // call goes on to attempt a notification below.
  await dbRunAsync(
    `INSERT INTO technical_issues (signature, type, severity, route, message, session_id, order_id, first_seen_at, last_seen_at, occurrence_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
     ON CONFLICT(signature) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP,
       occurrence_count = occurrence_count + 1,
       session_id = excluded.session_id,
       order_id = excluded.order_id`,
    [signature, type, effectiveSeverity, safeRoute, safeMessage, sessionId || null, orderId || null]
  );

  const row = await dbGetAsync(
    `SELECT occurrence_count, last_notified_at, notified_count FROM technical_issues WHERE signature = ?`,
    [signature]
  );
  const occurrenceCount = row ? row.occurrence_count : 1;
  const previousLastNotifiedAt = row ? row.last_notified_at : null;
  let notifiedCount = row ? row.notified_count : 0;
  const cooldownMs = ISSUE_COOLDOWN_MS[effectiveSeverity] || ISSUE_COOLDOWN_MS.WARNING;

  const previousLastNotifiedAtDate = parseSqliteUtcTimestamp(previousLastNotifiedAt);
  const cooldownElapsed = !previousLastNotifiedAtDate
    || (Date.now() - previousLastNotifiedAtDate.getTime()) >= cooldownMs;

  let notifyResult = null;

  if (cooldownElapsed) {
    // Atomic compare-and-swap claim: only matches (changes>0) if
    // last_notified_at is still exactly what was just read above. SQLite
    // serializes writes to the same row, so of two near-simultaneous
    // calls that both read "eligible" state, only the first UPDATE can
    // actually change the row -- the second sees changes=0 and skips
    // sending. No explicit lock or queue needed.
    const claim = await dbRunAsync(
      previousLastNotifiedAt
        ? `UPDATE technical_issues SET last_notified_at = CURRENT_TIMESTAMP, notified_count = notified_count + 1 WHERE signature = ? AND last_notified_at = ?`
        : `UPDATE technical_issues SET last_notified_at = CURRENT_TIMESTAMP, notified_count = notified_count + 1 WHERE signature = ? AND last_notified_at IS NULL`,
      previousLastNotifiedAt ? [signature, previousLastNotifiedAt] : [signature]
    );

    if (claim.changes > 0) {
      notifiedCount += 1;
      const messageHtml = buildMessageHtml({ type, safeRoute, safeMessage, orderId, occurrenceCount, notifiedCount });

      try {
        notifyResult = await ownerNotifications.notify({
          severity: effectiveSeverity,
          eventType: 'customer_impacting_technical_issue',
          dedupKey: `customer_impacting_technical_issue:${signature}`,
          cooldownMs: 0,
          message: messageHtml,
        });
      } catch (notifyErr) {
        console.error('[technical-issues] owner notification threw (issue still recorded):', notifyErr.message);
        notifyResult = { sent: false, reason: 'notify_threw' };
      }

      if (!wasGenuinelyDelivered(notifyResult)) {
        // Not actually delivered (Telegram error, or unconfigured) --
        // revert the claim so this never falsely counts as a successful
        // notification, and a genuine future attempt is not blocked for
        // a full cooldown window over a send that never went out.
        await dbRunAsync(
          previousLastNotifiedAt
            ? `UPDATE technical_issues SET last_notified_at = ?, notified_count = notified_count - 1 WHERE signature = ?`
            : `UPDATE technical_issues SET last_notified_at = NULL, notified_count = notified_count - 1 WHERE signature = ?`,
          previousLastNotifiedAt ? [previousLastNotifiedAt, signature] : [signature]
        ).catch((revertErr) => console.error('[technical-issues] failed to revert notification claim after send failure:', revertErr.message));
        notifiedCount -= 1;
      }
    }
  }

  return { signature, occurrenceCount, notifiedCount, notify: notifyResult };
}

module.exports = { recordIssue, buildSignature, sanitizeMessage, sanitizeRoute };
