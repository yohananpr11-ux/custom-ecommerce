'use strict';

// First-party telemetry intake (PR #34): new human visitor sessions only.
// Narrowly scoped on purpose -- no pageview-per-route event, no polling.
// Every owner-facing alert goes through services/owner-notifications.js;
// nothing here ever calls the Telegram service directly.

const express = require('express');
const router = express.Router();

const { botDetectorMiddleware } = require('../middleware/botDetector');
const visitorTelemetry = require('../services/visitor-telemetry');
const technicalIssues = require('../services/technical-issues');
const ownerNotifications = require('../services/owner-notifications');

function referrerDomain(referrer) {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname;
    return host || undefined;
  } catch {
    return undefined;
  }
}

// Short, non-identifying prefix of an opaque id -- enough to eyeball/
// correlate in a message without printing the full value unnecessarily.
function abbreviateId(id) {
  if (!id) return undefined;
  return String(id).slice(0, 12);
}

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
};

// Opaque client-generated ids only -- long enough to not collide, short
// enough to bound storage/log size, restricted charset so nothing here can
// carry injection payloads or oversized garbage into SQLite/Telegram.
const ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const isValidId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

// Simple in-memory fixed-window limiter, same style as the existing
// visitNotificationCache Map+TTL pattern in index.js -- no new dependency.
// Public telemetry endpoints are an obvious abuse target (fake "human
// session" spam), so this bounds request volume per IP independent of any
// dedup logic further down.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitState = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitState.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodic cleanup so this Map can never grow unbounded across many
// distinct IPs over a long-running process. Unref'd so it never keeps the
// process alive on its own (matters for tests that spin the app up/down).
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitState.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitState.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function sanitizeReferrer(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\x20-\x7E]/g, '').slice(0, 300);
}

function sanitizeSource(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\x20-\x7E]/g, '').slice(0, 40);
}

router.post('/session-start', botDetectorMiddleware, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const { visitorId, sessionId } = body;

    if (!isValidId(visitorId) || !isValidId(sessionId)) {
      return res.status(400).json({ ok: false, error: 'invalid_ids' });
    }

    // Reuses technical-issues.sanitizeRoute for identical path normalization
    // (strip query string -- may carry tokens/PII -- then cap length) rather
    // than a second, slightly different implementation.
    const landingPath = technicalIssues.sanitizeRoute(typeof body.landingPath === 'string' ? body.landingPath : '/') || '/';
    const referrer = sanitizeReferrer(body.referrer);
    const clientSource = sanitizeSource(body.source);
    const deviceCategory = req.visitorDevice || 'Unknown';

    const { isNew, isHuman, source } = await visitorTelemetry.recordSessionStart({
      visitorId,
      sessionId,
      landingPath,
      referrer,
      source: clientSource,
      deviceCategory,
      uaClassification: req.visitorType,
    });

    // Only a truly new, human session ever reaches the owner. Bots/crawlers
    // and duplicate/replayed session_ids are stored (useful for PR #35
    // volume reporting) but never notify.
    if (isNew && isHuman) {
      const message = ownerNotifications.buildOperatorMessage({
        icon: '👤',
        titleHe: 'JONO — מבקר אנושי חדש',
        summaryHe: 'התחילה סשן גלישה אנושי חדש באתר.',
        fields: [
          ['Event', 'HUMAN_SESSION_STARTED'],
          ['Time', new Date().toISOString()],
          ['Session-ID', sessionId],
          ['Visitor-ID', abbreviateId(visitorId)],
          ['Source', source || 'direct'],
          ['Device', deviceCategory],
          ['Landing-Page', landingPath],
          ['Referrer-Domain', referrerDomain(referrer)],
          ['Human-Classification', req.visitorType],
        ],
      });

      try {
        // dedupKey is unique per session_id, and this branch is only ever
        // reached once per session_id (DB-level idempotency above already
        // guarantees that) -- the default WARNING cooldown here is a
        // defense-in-depth backstop, not the primary "once per session"
        // mechanism. Telegram itself safely no-ops when unconfigured (see
        // telegram.sendMessage), which is what keeps local/dev runs from
        // ever reaching a real production chat.
        await ownerNotifications.notify({
          severity: ownerNotifications.SEVERITY.WARNING,
          eventType: 'new_human_session',
          dedupKey: `new_human_session:${sessionId}`,
          message,
        });
        await visitorTelemetry.markNotified(sessionId);
      } catch (notifyErr) {
        console.error('[telemetry/session-start] owner notification failed (session still recorded):', notifyErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[telemetry/session-start] failed:', err.message);
    // A telemetry hiccup must never look like a real failure to the
    // storefront -- respond 200 regardless of what went wrong internally.
    return res.status(200).json({ ok: true, recorded: false });
  }
});

const ALLOWED_ERROR_SOURCES = new Set(['window.error', 'unhandledrejection']);
const MAX_ERROR_MESSAGE_LEN = 200;

// Frontend uncaught-error intake (PR #34, section 9). Client-side sends at
// most a short, already-truncated message + which handler caught it + the
// path it happened on -- never a stack trace, never localStorage/cookie
// contents. Dedup/cooldown is entirely delegated to
// technical-issues.recordIssue()'s signature-based upsert, so the same
// recurring frontend error can never flood Telegram.
router.post('/frontend-error', botDetectorMiddleware, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    // Bots/crawlers don't run our JS the way a real browser does, but a
    // stray automated POST here should still never reach the owner.
    if (req.visitorType !== 'human') {
      return res.status(200).json({ ok: true, recorded: false });
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const source = ALLOWED_ERROR_SOURCES.has(body.source) ? body.source : 'window.error';
    const sessionId = isValidId(body.sessionId) ? body.sessionId : null;
    const path = technicalIssues.sanitizeRoute(typeof body.path === 'string' ? body.path : '');
    const message = typeof body.message === 'string' ? body.message.slice(0, MAX_ERROR_MESSAGE_LEN) : '';

    if (!message) {
      return res.status(400).json({ ok: false, error: 'message is required' });
    }

    const context = body.context === 'checkout' ? 'checkout' : 'general';

    await technicalIssues.recordIssue({
      type: 'frontend_uncaught_error',
      route: path || '/',
      message: `[${context}/${source}] ${message}`,
      sessionId,
      severity: context === 'checkout'
        ? ownerNotifications.SEVERITY.CRITICAL
        : ownerNotifications.SEVERITY.WARNING,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[telemetry/frontend-error] failed:', err.message);
    return res.status(200).json({ ok: true, recorded: false });
  }
});

// Body-parser errors (oversized body, malformed JSON) are thrown by
// express.json() itself, before either handler's own try/catch runs --
// without this, they would fall through to the app's global error handler,
// which answers with a raw 500 AND pages the owner with a "Critical Server
// Error" Telegram alert over what is usually just abuse/garbage traffic on
// a public endpoint. Resolved to a clean, quiet 4xx instead.
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }
  return next(err);
});

module.exports = router;
