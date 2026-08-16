'use strict';

// Single entry point for all NEW owner-facing Telegram notifications (PR
// #33). Existing senders scattered across index.js/telegram.js/etc. are NOT
// migrated here yet -- that's a separate, mechanical follow-up. This module
// only establishes the one official path future senders should use, plus
// the in-process dedup/cooldown infrastructure the audit found missing
// everywhere else.

const telegram = require('./telegram');

// Standard operator-context message format (PR #34 follow-up): every
// notification is meant to be useful both to the owner reading it normally
// AND to an operator/LLM the owner pastes it into later -- a short Hebrew
// human summary, plus a stable-field-name structured diagnostic block. See
// buildOperatorMessage() below.
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const MAX_FIELD_VALUE_LEN = 300;

function sanitizeFieldValue(value) {
  const collapsed = String(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const truncated = collapsed.length > MAX_FIELD_VALUE_LEN ? `${collapsed.slice(0, MAX_FIELD_VALUE_LEN)}…` : collapsed;
  return escapeHtml(truncated);
}

/**
 * Build a two-part operator-friendly message: a short Hebrew human summary
 * (for the owner reading it normally) plus a stable-field-name structured
 * diagnostic block (for pasting into a support chat / correlating against
 * logs later). Fields whose value is undefined/null/empty are omitted
 * entirely -- never rendered as the literal text "undefined" or "null".
 * Every value is HTML-escaped, newline-collapsed, and length-capped, so a
 * user-controlled string can never break Telegram's HTML parser or
 * visually fake extra fields inside the block.
 *
 * @param {object} params
 * @param {string} [params.icon] - leading emoji, defaults to a generic alert icon
 * @param {string} params.titleHe - short Hebrew title
 * @param {string} params.summaryHe - one-line Hebrew human summary
 * @param {Array<[string, any]>} params.fields - ordered [label, value] pairs; falsy values are skipped
 */
function buildOperatorMessage({ icon = '🚨', titleHe, summaryHe, fields = [] }) {
  const lines = [];
  for (const [label, value] of fields) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${label}: ${sanitizeFieldValue(value)}`);
  }
  const header = `${icon} <b>${escapeHtml(titleHe)}</b>\n${escapeHtml(summaryHe)}`;
  return lines.length ? `${header}\n\n<pre>${lines.join('\n')}</pre>` : header;
}

const SEVERITY = Object.freeze({ CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' });

// Default cooldowns:
// CRITICAL: 0ms (immediate)
// WARNING: 15 minutes (groupable -- repeats within the window are suppressed and counted)
// INFO: 0ms for immediate business events (idempotency/dedup handled at event level)
const DEFAULT_COOLDOWN_MS = {
  [SEVERITY.CRITICAL]: 0,
  [SEVERITY.WARNING]: 15 * 60 * 1000,
  [SEVERITY.INFO]: 0,
};

// In-process only, per the spec -- no database persistence yet. Resets on
// every process restart, which is acceptable for a cooldown/dedup window.
let lastSentAt = new Map(); // dedupKey -> epoch ms of last actual send
let suppressedSinceLastSend = new Map(); // dedupKey -> count suppressed by cooldown

function buildDedupKey(eventType, dedupKey) {
  return dedupKey || eventType;
}

// Documents the target notification policy (PR #34 / hotfix).
// IMMEDIATE: High-value operational alerts sent immediately.
// DAILY: Routine success/informational events suppressed from immediate alerts (reserved for daily digest).
const NOTIFICATION_POLICY = Object.freeze({
  IMMEDIATE: Object.freeze([
    'new_human_session',
    'paid_purchase',
    'customer_impacting_technical_issue',
    'critical_infra_failure',
    'manual_fulfillment_required',
    'internal_server_error',
    'daily_owner_report',
  ]),
  DAILY: Object.freeze([
    'routine_sync_success',
    'routine_backup_success',
    'ordinary_fulfillment_progress',
    'abandoned_cart_summary',
    'general_health',
    'routine_lead',
  ]),
});

/**
 * Send (or suppress, per severity/cooldown/policy) an owner notification.
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

  // Suppress routine daily events from immediate Telegram alerts
  if (NOTIFICATION_POLICY.DAILY.includes(eventType)) {
    console.log(`[owner-notifications] routine event suppressed from immediate alerts: eventType=${eventType} at=${timestamp}`);
    return { sent: false, reason: 'routine_suppressed', severity, eventType, dedupKey: key, timestamp };
  }

  // If INFO severity, only allow explicit IMMEDIATE policy events
  if (severity === SEVERITY.INFO && !NOTIFICATION_POLICY.IMMEDIATE.includes(eventType)) {
    console.log(`[owner-notifications] INFO not sent immediately (daily-batch only): eventType=${eventType} at=${timestamp}`);
    return { sent: false, reason: 'info_not_immediate', severity, eventType, dedupKey: key, timestamp };
  }

  const effectiveCooldown = cooldownMs != null ? cooldownMs : DEFAULT_COOLDOWN_MS[severity];

  if (effectiveCooldown && effectiveCooldown > 0) {
    const last = lastSentAt.get(key);
    if (last && (Date.now() - last) < effectiveCooldown) {
      const count = (suppressedSinceLastSend.get(key) || 0) + 1;
      suppressedSinceLastSend.set(key, count);
      console.log(`[owner-notifications] suppressed by cooldown: eventType=${eventType} dedupKey=${key} suppressedCount=${count}`);
      return { sent: false, reason: 'cooldown', severity, eventType, dedupKey: key, suppressedCount: count, timestamp };
    }
  }

  const groupedCount = suppressedSinceLastSend.get(key) || 0;

  // Only add prefix icon if severity is CRITICAL or WARNING and message doesn't already start with an emoji
  const hasLeadingEmoji = /^[\p{Emoji}\u200d]+/u.test(message.trim());
  const icon = (severity === SEVERITY.CRITICAL ? '🚨' : (severity === SEVERITY.WARNING ? '⚠️' : ''));
  const prefix = (icon && !hasLeadingEmoji) ? `${icon} ` : '';
  const groupedSuffix = groupedCount > 0
    ? `\n\n<i>(${groupedCount} similar alert${groupedCount === 1 ? '' : 's'} suppressed since the last notice)</i>`
    : '';

  let telegramResult;
  try {
    telegramResult = await telegram.sendMessage(`${prefix}${message}${groupedSuffix}`);
  } catch (err) {
    console.error(`[owner-notifications] Telegram send threw error:`, err.message);
    telegramResult = { ok: false, skipped: false, reason: 'exception', error: err.message };
  }

  const isSuccess = Boolean(telegramResult && telegramResult.ok === true);

  if (isSuccess) {
    // Delivery confirmed: advance cooldown timer and reset suppression counter
    lastSentAt.set(key, Date.now());
    suppressedSinceLastSend.set(key, 0);
    return { sent: true, severity, eventType, dedupKey: key, timestamp, telegram: telegramResult };
  }

  // Delivery failed (Telegram API error, unconfigured, or exception):
  // Do NOT advance lastSentAt, do NOT reset suppressedSinceLastSend
  return {
    sent: false,
    reason: telegramResult?.reason || 'delivery_failed',
    severity,
    eventType,
    dedupKey: key,
    timestamp,
    telegram: telegramResult,
  };
}

function _resetForTests() {
  lastSentAt = new Map();
  suppressedSinceLastSend = new Map();
}

module.exports = { notify, SEVERITY, NOTIFICATION_POLICY, buildOperatorMessage, _resetForTests };
