'use strict';

// Structured, deduped customer-impacting technical issue recording (PR
// #34). Stores just enough for PR #35's reporting (type/severity/route/
// safe message/occurrence_count/session_id/order_id) and alerts the owner
// through the existing owner-notifications.js dedup/cooldown machinery --
// no parallel Telegram logic. A repeated identical failure increments
// occurrence_count here but is suppressed by owner-notifications' own
// cooldown, so it can never flood Telegram.

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

/**
 * Record a customer-impacting technical issue and (subject to
 * owner-notifications' dedup/cooldown) alert the owner. Safe to call on
 * every occurrence of the same underlying problem.
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

  const row = await dbGetAsync(`SELECT occurrence_count FROM technical_issues WHERE signature = ?`, [signature]);
  const occurrenceCount = row ? row.occurrence_count : 1;

  const messageHtml = `<b>Customer-impacting issue</b>\n`
    + `<b>Type:</b> ${escapeHtml(type)}\n`
    + (safeRoute ? `<b>Route:</b> <code>${escapeHtml(safeRoute)}</code>\n` : '')
    + (safeMessage ? `<b>Details:</b> ${escapeHtml(safeMessage)}\n` : '')
    + (orderId ? `<b>Order:</b> #${escapeHtml(String(orderId))}\n` : '')
    + `<b>Occurrences:</b> ${occurrenceCount}`;

  let notifyResult = null;
  try {
    notifyResult = await ownerNotifications.notify({
      severity: effectiveSeverity,
      eventType: 'customer_impacting_technical_issue',
      dedupKey: `customer_impacting_technical_issue:${signature}`,
      cooldownMs: ISSUE_COOLDOWN_MS[effectiveSeverity] || ISSUE_COOLDOWN_MS.WARNING,
      message: messageHtml,
    });
  } catch (notifyErr) {
    // Notification failure must never make issue recording itself fail.
    console.error('[technical-issues] owner notification failed (issue still recorded):', notifyErr.message);
  }

  return { signature, occurrenceCount, notify: notifyResult };
}

module.exports = { recordIssue, buildSignature, sanitizeMessage, sanitizeRoute };
