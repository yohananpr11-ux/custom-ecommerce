// Global Express error handler: customer-facing 5xx issue capture (PR #34
// follow-up). Conservative allowlist (not "alert on every exception"),
// deduped/cooled-down via the same durable technical-issues.js pipeline,
// no recursion risk from the telemetry endpoints themselves, and no
// sensitive request data ever persisted.
//
// isCustomerFacingPath / recordCustomerFacing5xxIssue are exported from
// index.js specifically so this suite can exercise the REAL production
// function directly (constructed err/req) without needing to force a live
// route into an uncaught throw -- every route in this codebase already
// catches its own errors by design, so there is no naturally-occurring
// "uncaught exception on a customer route" to trigger end-to-end.
//
// Same real-app harness pattern as the rest of this suite -- isolated temp
// DB, no real Telegram network call ever made.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-5xx-issue-capture-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-5xx';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-5xx';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-5xx';

const { app, isCustomerFacingPath, recordCustomerFacing5xxIssue } = require('../index.js');
const db = require('../db.js');
const ownerNotifications = require('../services/owner-notifications.js');
const telegram = require('../services/telegram.js');

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

test.beforeEach(() => {
  ownerNotifications._resetForTests();
});

function installGenuineTelegramDelivery() {
  return mock.method(telegram, 'sendMessage', async () => ({ ok: true, status: 200 }));
}

function installNotifySpy() {
  const calls = [];
  const originalNotify = ownerNotifications.notify.bind(ownerNotifications);
  const spy = mock.method(ownerNotifications, 'notify', async (params) => {
    const result = await originalNotify(params);
    calls.push({ ...params, sent: result.sent });
    return result;
  });
  return { calls, restore: () => spy.mock.restore() };
}

function fakeReq({ path: reqPath, method = 'GET', body = {} }) {
  return { path: reqPath, url: reqPath, method, body };
}

// ── I. Customer-facing storefront 500 => issue recorded + owner alert ──

test('I: a customer-facing storefront 500 records an issue and alerts the owner', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const req = fakeReq({ path: '/api/products', method: 'GET' });
    const result = await recordCustomerFacing5xxIssue(new Error('Simulated DB outage'), req);

    assert.equal(result.recorded, true);
    assert.equal(result.notifiedCount, 1);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].eventType, 'customer_impacting_technical_issue');
    assert.equal(spy.calls[0].sent, true);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── J. Repeated same storefront 500 => count increments, alert deduped ──

test('J: a repeated identical storefront 500 increments occurrence_count but is deduped, not re-alerted', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const req = fakeReq({ path: '/api/coupons/active', method: 'GET' });
    const err = new Error('Simulated repeated failure');

    const first = await recordCustomerFacing5xxIssue(err, req);
    const second = await recordCustomerFacing5xxIssue(err, req);
    const third = await recordCustomerFacing5xxIssue(err, req);

    assert.equal(third.occurrenceCount, 3, 'occurrence_count keeps incrementing');
    assert.equal(third.notifiedCount, 1, 'still 1 -- durable cooldown suppressed the repeats');
    assert.equal(spy.calls.length, 1, 'notify() only invoked for the first occurrence');
    assert.equal(first.signature, second.signature);
    assert.equal(second.signature, third.signature);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── K. Checkout 500 => issue recorded ───────────────────────────────────

test('K: a checkout/payment-path 500 is recorded as an issue', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  try {
    const req = fakeReq({ path: '/api/paypal/create-order', method: 'POST', body: { items: [] } });
    const result = await recordCustomerFacing5xxIssue(new Error('Simulated checkout failure'), req);
    assert.equal(result.recorded, true);

    const row = await dbGet(`SELECT type, route FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.equal(row.type, 'backend_5xx');
    assert.equal(row.route, '/api/paypal/create-order');
  } finally {
    telegramMock.mock.restore();
  }
});

// ── L. Health/admin/internal paths are excluded by policy ──────────────

test('L: non-customer-facing paths (health, admin, webhooks, telemetry, dev/test routes) are never recorded as issues', async () => {
  const excludedPaths = [
    '/',
    '/api/admin/sync-status',
    '/api/admin/retry-emails',
    '/api/webhooks/stripe',
    '/api/webhooks/payplus',
    '/api/webhooks/telegram',
    '/api/telemetry/session-start',
    '/api/telemetry/frontend-error',
    '/api/test/whatever',
    '/api/analytics/event',
    '/api/analytics/visit',
  ];
  for (const p of excludedPaths) {
    assert.equal(isCustomerFacingPath(p), false, `${p} must not be classified as customer-facing`);
    const result = await recordCustomerFacing5xxIssue(new Error('x'), fakeReq({ path: p, method: 'GET' }));
    assert.equal(result.recorded, false, `${p} must never be recorded as a technical issue`);
  }
});

// ── M. 404 => no issue alert ────────────────────────────────────────────

test('M: a genuine 404 on a nonexistent route never records an issue', async () => {
  const spy = installNotifySpy();
  try {
    const res = await fetch(`${baseUrl}/api/this-route-does-not-exist-${Date.now()}`);
    assert.equal(res.status, 404);

    const eventCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.equal(eventCalls.length, 0, 'a 404 must never reach the global error handler or record an issue');
  } finally {
    spy.restore();
  }
});

// ── N. Ordinary validation 400 => no issue alert ────────────────────────

test('N: an ordinary validation 400 (empty cart on checkout) never records an issue', async () => {
  const spy = installNotifySpy();
  try {
    const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 400);

    const eventCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.equal(eventCalls.length, 0, 'an ordinary 400 must never page the owner');
  } finally {
    spy.restore();
  }
});

// ── O. Telemetry endpoint failure cannot recursively trigger an issue loop ──

test('O: a simulated internal failure attributed to a telemetry-endpoint path is never recorded (no recursive telemetry-about-telemetry loop)', async () => {
  const result = await recordCustomerFacing5xxIssue(
    new Error('Simulated internal telemetry failure'),
    fakeReq({ path: '/api/telemetry/session-start', method: 'POST', body: { visitorId: 'v', sessionId: 's' } })
  );
  assert.equal(result.recorded, false, '/api/telemetry/* is structurally excluded from the customer-facing allowlist');
});

// ── P. No sensitive request values in stored issue context/signature ───

test('P: sensitive request data (body fields, tokens, query string) never reaches the stored issue row or the rendered Telegram text', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const req = fakeReq({
      path: '/api/leads?token=SECRET-QUERY-TOKEN&email=leaked@example.com',
      method: 'POST',
      body: {
        email: 'plain-body-email@example.com',
        password: 'SUPER-SECRET-PASSWORD',
        authorization: 'Bearer SECRET-BEARER-TOKEN',
        cookie: 'session=SECRET-COOKIE-VALUE',
        cardNumber: '4111111111111111',
      },
    });
    const result = await recordCustomerFacing5xxIssue(new Error('Simulated failure with sensitive-looking context'), req);
    assert.equal(result.recorded, true);

    const row = await dbGet(`SELECT route, message FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.equal(row.route, '/api/leads', 'query string must never be persisted');
    assert.doesNotMatch(row.route, /token=|email=/);
    assert.doesNotMatch(row.message, /SECRET|password|Bearer|cookie|4111111111111111|leaked@|plain-body-email@/i);
    assert.equal(row.message, 'Error', 'only the error class is stored in the message column, nothing from the request body');

    const sentText = spy.calls.find((c) => c.eventType === 'customer_impacting_technical_issue').message;
    assert.doesNotMatch(sentText, /SECRET|password|Bearer|cookie|4111111111111111|leaked@|plain-body-email@/i, 'the full rendered Telegram text must also be clean, not just the DB row');
    assert.match(sentText, /Method: POST/, 'the safe method field is still present');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});
