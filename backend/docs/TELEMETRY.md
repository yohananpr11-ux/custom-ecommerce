# JONO Telemetry (PR #34)

First-party visitor/session telemetry and immediate owner notifications for
new human sessions, paid purchases, and customer-impacting technical
issues. Everything here routes through `backend/services/owner-notifications.js`
— nothing added in this PR calls the Telegram service directly.

Scope: telemetry + real-time alerts only. The 22:00 daily report and
Telegram owner commands are **not** part of this PR — see PR #35.

## What's new

| File | Purpose |
|---|---|
| `db.js` | `visitor_sessions` and `technical_issues` tables (idempotent migration) |
| `services/visitor-telemetry.js` | Idempotent session-start insert, source classification |
| `services/technical-issues.js` | Deduped/cooled-down issue recording, owner alerts |
| `routes/telemetry.js` | `POST /api/telemetry/session-start`, `POST /api/telemetry/frontend-error` |
| `frontend/src/utils/telemetry.js` | visitor_id/session_id, session-start send, frontend error reporting |
| `index.js` (PayPal capture-order) | Paid-purchase owner notification, replacing two prior direct Telegram sends |

## AVAILABLE (real data PR #35 can build on)

- **Human sessions**: one row per browser session in `visitor_sessions`, keyed by an
  opaque, non-identifying `session_id` (UNIQUE). Reload/duplicate-safe.
- **Unique visitor IDs**: `visitor_id`, opaque, persisted in the browser's `localStorage`
  (not derived from IP or any fingerprint).
- **Human vs. bot/crawler breakdown**: `visitor_sessions.is_human` /
  `ua_classification`, from the existing `middleware/botDetector.js` classifier.
- **Sources/referrers**: `visitor_sessions.source` (classified: google / meta / tiktok /
  search / referral / direct) and the raw (length-capped) `referrer`.
- **Devices**: `visitor_sessions.device_category` (iOS / Android / Mobile / Tablet / Desktop).
- **Landing pages**: `visitor_sessions.landing_path` (query string stripped).
- **Paid orders / revenue**: unchanged existing `orders`/`order_items` tables — every
  order this PR notifies on is a real, atomically-claimed `status = 'paid'` transition.
- **Technical issues**: `technical_issues` — `type`, `severity`, `route`, a sanitized/
  truncated `message`, `occurrence_count`, `first_seen_at`/`last_seen_at`,
  `session_id`/`order_id` where known. Currently recorded: `payment_capture_failure`,
  `checkout_request_failure` (PayPal only — see below), `frontend_uncaught_error`.

## NOT AVAILABLE (do not assume these exist)

- **Pageviews per route.** Only one event per session (session-start). No
  per-navigation tracking was added in this PR.
- **Stripe / PayPlus paid-purchase notifications.** Only the PayPal
  capture-order path was audited and wired per this PR's explicit scope.
  `sendPaymentNotification`/`telegram.notifyNewOrder` still fire directly
  (unchanged, out of scope) for Stripe and PayPlus orders.
- **Backend 5xx issue recording outside checkout/capture.** The global
  Express error handler (`app.use((err, req, res, next) => ...)` at the
  bottom of `index.js`) still sends its own raw, unstructured Telegram
  alert for *any* unhandled exception app-wide (admin routes included) —
  this was NOT migrated or rewired in this PR; doing so would have been a
  much broader change than "customer-impacting" telemetry.
- **The pre-existing `/api/analytics/event` and `/api/analytics/visit`
  routes are untouched** and out of scope. `/api/analytics/event` inserts
  into a table (`analytics_events`) that does not exist in the schema —
  it does not work today and this PR does not fix it. `/api/analytics/visit`
  sends directly via `telegram.queueVisit`, bypassing owner-notifications.js
  entirely — left as-is; do not build on it.
- **Raw IP address.** Never stored as a durable analytics identifier.
- **Any 22:00 digest / batch report.** `owner-notifications.notify()`'s
  `INFO` severity already logs "not sent immediately (daily-batch only, not
  yet implemented)" — the batch itself is PR #35.
- **Telegram owner commands** (e.g. querying today's sessions/issues from
  chat) — PR #35.
- **Cross-restart notification memory.** `owner-notifications.js`'s
  cooldown/dedup state is in-process only and resets on every deploy/restart
  (pre-existing limitation, not introduced here).
