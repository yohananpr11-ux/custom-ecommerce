/**
 * First-party visitor/session telemetry + frontend error reporting (PR #34).
 *
 * No third-party analytics, no fingerprinting, no polling. Two calls only:
 *   - initTelemetry()      -- once per browser session, on app bootstrap
 *   - reportFrontendError() -- from the existing window error / unhandledrejection handlers
 *
 * Both are silent-failure by design: telemetry must never affect rendering,
 * never throw into the app, and never block anything the customer is doing.
 * Both are production-only (no-op in dev/test builds).
 */

// import.meta.env is Vite-injected and always present in a real build; this
// module is also imported directly (no Vite) by telemetry.test.js, where
// import.meta.env is undefined -- guarded so that keeps working rather than
// throwing at import time.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const API_BASE = (env.VITE_API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com').replace(/\/$/, '');

const VISITOR_ID_KEY = 'jono_visitor_id';
const SESSION_ID_KEY = 'jono_session_id';
const SESSION_SENT_KEY = 'jono_session_start_sent';

const isProd = Boolean(env.PROD);

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // fall through to the Math.random fallback below
  }
  let out = '';
  for (let i = 0; i < 24; i += 1) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

/**
 * Opaque, non-identifying, persisted across sessions on this browser.
 */
export function getOrCreateVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId(); // storage unavailable (private mode, etc.) -- non-persistent fallback only
  }
}

/**
 * Opaque, persisted for this browser session only. A reload/refresh reuses
 * the same value (sessionStorage survives reload, clears on tab close) --
 * this is what makes "reload does not create a new session" true.
 */
export function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

function sourceHintFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    return utmSource ? utmSource.slice(0, 40) : '';
  } catch {
    return ''; // the backend falls back to classifying document.referrer itself
  }
}

/**
 * Call once on app bootstrap. Sends session-start at most once per browser
 * session. Never blocks rendering, never throws, silent on failure.
 */
export function initTelemetry() {
  if (!isProd) return;
  try {
    if (sessionStorage.getItem(SESSION_SENT_KEY) === '1') return;
    // Set the guard before the request completes -- a fast reload while the
    // request is still in flight must not be able to send it twice.
    sessionStorage.setItem(SESSION_SENT_KEY, '1');

    const payload = {
      visitorId: getOrCreateVisitorId(),
      sessionId: getOrCreateSessionId(),
      landingPath: window.location.pathname,
      referrer: document.referrer || '',
      source: sourceHintFromQuery(),
    };

    fetch(`${API_BASE}/api/telemetry/session-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // localStorage/sessionStorage unavailable or anything else went wrong --
    // telemetry is best-effort only, never allowed to affect the app.
  }
}

const MAX_CLIENT_MESSAGE_LEN = 200;
const ERROR_REPORT_WINDOW_MS = 60 * 1000;
const ERROR_REPORT_MAX_PER_WINDOW = 5;
const RECENT_SIGNATURE_LIMIT = 20;
let errorReportCount = 0;
let errorReportWindowStart = 0;
const recentErrorSignatures = new Set();

function shouldSendErrorReport(signature) {
  const now = Date.now();
  if (now - errorReportWindowStart > ERROR_REPORT_WINDOW_MS) {
    errorReportWindowStart = now;
    errorReportCount = 0;
  }
  if (errorReportCount >= ERROR_REPORT_MAX_PER_WINDOW) return false;
  if (recentErrorSignatures.has(signature)) return false;
  errorReportCount += 1;
  recentErrorSignatures.add(signature);
  if (recentErrorSignatures.size > RECENT_SIGNATURE_LIMIT) recentErrorSignatures.clear();
  return true;
}

/**
 * Report a production frontend error (window 'error' or 'unhandledrejection').
 * Client-side rate-limited and deduped; the backend independently dedupes
 * again via technical-issues.js, so this only needs to avoid obviously
 * flooding the network, not be a perfect limiter. Never throws -- reporting
 * an error must never itself become a source of errors.
 *
 * @param {{message?: string, source?: 'window.error'|'unhandledrejection', context?: 'checkout'|'general'}} info
 */
export function reportFrontendError(info = {}) {
  if (!isProd) return;
  try {
    const safeMessage = String(info.message || 'Unknown error').slice(0, MAX_CLIENT_MESSAGE_LEN);
    const source = info.source === 'unhandledrejection' ? 'unhandledrejection' : 'window.error';
    const signature = `${source}|${safeMessage}`;
    if (!shouldSendErrorReport(signature)) return;

    const payload = {
      sessionId: getOrCreateSessionId(),
      message: safeMessage,
      source,
      path: window.location.pathname,
      context: info.context === 'checkout' ? 'checkout' : 'general',
    };

    fetch(`${API_BASE}/api/telemetry/frontend-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Never let error reporting itself throw.
  }
}
