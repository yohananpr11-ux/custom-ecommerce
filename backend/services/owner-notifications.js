'use strict';

// Single entry point for all NEW owner-facing Telegram notifications (PR
// #33). Existing senders scattered across index.js/telegram.js/etc. are NOT
// migrated here yet -- that's a separate, mechanical follow-up. This module
// only establishes the one official path future senders should use, plus
// the in-process dedup/cooldown infrastructure the audit found missing
// everywhere else.

const telegram = require('./telegram');

const SEVERITY = Object.freeze({ CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' });

// No cooldown by default for CRITICAL (always immediate); 15 minutes for
// WARNING (groupable -- repeats within the window are suppressed and
// counted, not resent); INFO is not sent immediately at all by default (see
// notify() below) so it has no cooldown concept yet.
const DEFAULT_COOLDOWN_MS = {
  [SEVERITY.CRITICAL]: 0,
  [SEVERITY.WARNING]: 15 * 60 * 1000,
  [SEVERITY.INFO]: null,
};

// In-process only, per the spec -- no database persistence yet. Resets on
// every process restart, which is acceptable for a cooldown/dedup window.
let lastSentAt = new Map(); // dedupKey -> epoch ms of last actual send
let suppressedSinceLastSend = new Map(); // dedupKey -> count suppressed by cooldown

function buildDedupKey(eventType, dedupKey) {
  return dedupKey || eventType;
}

/**
 * Send (or suppress, per severity/cooldown) an owner notification.
 *
 * @param {object} params
 * @param {'CRITICAL'|'WARNING'|'INFO'} params.severity
 * @param {string} params.eventType - stable identifier for this kind of event
 * @param {string} params.message - HTML-formatted message body (caller must escape any dynamic content)
 * @param {string} [params.dedupKey] - defaults to eventType if omitted
 * @param {number} [params.cooldownMs] - overrides the severity's default cooldown
 */
async function notify({ severity, eventType, message, dedupKey, cooldownMs } = {}) {
  if (!severity || !SEVERITY[severity]) {
    throw new Error(`owner-notifications: invalid severity "${severity}"`);
  }
  if (!eventType) {
    throw new Error('owner-notifications: eventType is required');
  }
  if (!message) {
    throw new Error('owner-notifications: message is required');
  }

  const timestamp = new Date().toISOString();
  const key = buildDedupKey(eventType, dedupKey);

  if (severity === SEVERITY.INFO) {
    // INFO is routed to the future daily-digest batch, not sent immediately.
    // Batching itself is out of scope for this PR (see NOTIFICATION_POLICY
    // below) -- this just makes sure INFO calls don't silently start
    // flooding Telegram once callers start using this module.
    console.log(`[owner-notifications] INFO not sent immediately (daily-batch only, not yet implemented): eventType=${eventType} at=${timestamp}`);
    return { sent: false, reason: 'info_not_immediate', severity, eventType, dedupKey: key, timestamp };
  }

  const effectiveCooldown = cooldownMs != null ? cooldownMs : DEFAULT_COOLDOWN_MS[severity];

  if (effectiveCooldown) {
    const last = lastSentAt.get(key);
    if (last && (Date.now() - last) < effectiveCooldown) {
      const count = (suppressedSinceLastSend.get(key) || 0) + 1;
      suppressedSinceLastSend.set(key, count);
      console.log(`[owner-notifications] suppressed by cooldown: eventType=${eventType} dedupKey=${key} suppressedCount=${count}`);
      return { sent: false, reason: 'cooldown', severity, eventType, dedupKey: key, suppressedCount: count, timestamp };
    }
  }

  const groupedCount = suppressedSinceLastSend.get(key) || 0;
  suppressedSinceLastSend.set(key, 0);
  lastSentAt.set(key, Date.now());

  const icon = severity === SEVERITY.CRITICAL ? '🚨' : '⚠️';
  const groupedSuffix = groupedCount > 0
    ? `\n\n<i>(${groupedCount} similar alert${groupedCount === 1 ? '' : 's'} suppressed since the last notice)</i>`
    : '';

  const telegramResult = await telegram.sendMessage(`${icon} ${message}${groupedSuffix}`);
  return { sent: true, severity, eventType, dedupKey: key, timestamp, telegram: telegramResult };
}

// Documents the target policy from the PR #33 audit. Not wired to any
// sender yet -- IMMEDIATE categories still need per-sender migration, and
// DAILY categories need the 22:00 report to exist. Both are future PRs.
const NOTIFICATION_POLICY = Object.freeze({
  IMMEDIATE: Object.freeze([
    'new_human_session',
    'paid_purchase',
    'customer_impacting_technical_issue',
  ]),
  DAILY: Object.freeze([
    'routine_sync_success',
    'routine_backup_success',
    'ordinary_fulfillment_progress',
    'abandoned_cart_summary',
    'general_health',
  ]),
});

function _resetForTests() {
  lastSentAt = new Map();
  suppressedSinceLastSend = new Map();
}

module.exports = { notify, SEVERITY, NOTIFICATION_POLICY, _resetForTests };
