// Structured, deduped customer-impacting technical-issue telemetry (PR
// #34): first occurrence alerts, repeats increment occurrence_count and are
// cooled-down (never floods Telegram), distinct issues get their own alert,
// and the frontend-error intake endpoint sanitizes/truncates unsafe input.
//
// Same real-app harness pattern as paid-order-notifications.test.js --
// separate process/file, isolated temp DB. No real Telegram network call.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-issues-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-issues';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-issues';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-issues';

const { app } = require('../index.js');
const db = require('../db.js');
const ownerNotifications = require('../services/owner-notifications.js');
const technicalIssues = require('../services/technical-issues.js');
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

// Wraps (not replaces) owner-notifications.notify() -- the REAL
// cooldown/dedup logic in owner-notifications.js still runs, this only
// records what was requested and what it actually decided (sent vs
// suppressed-by-cooldown). telegram.sendMessage itself is never mocked --
// it already safely no-ops with TELEGRAM_BOT_TOKEN unset in this suite.
function installTelegramSpy() {
  const calls = [];
  const originalNotify = ownerNotifications.notify.bind(ownerNotifications);
  const spy = mock.method(ownerNotifications, 'notify', async (params) => {
    const result = await originalNotify(params);
    calls.push({ ...params, sent: result.sent, reason: result.reason });
    return result;
  });
  return { calls, restore: () => spy.mock.restore() };
}

function uniqueType(label) {
  return `test_issue_${label}_${Math.random().toString(36).slice(2)}`;
}

// ── L. First customer-impacting issue ───────────────────────────────────

test('L: the first occurrence of a customer-impacting issue is stored and alerts immediately', async () => {
  const spy = installTelegramSpy();
  const type = uniqueType('first');
  try {
    const result = await technicalIssues.recordIssue({ type, route: '/api/paypal/capture-order', message: 'boom', severity: 'WARNING' });
    assert.equal(result.occurrenceCount, 1);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].eventType, 'customer_impacting_technical_issue');
    assert.equal(spy.calls[0].sent, true, 'the first occurrence must actually send, not be suppressed');

    const row = await dbGet(`SELECT * FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.ok(row);
    assert.equal(row.occurrence_count, 1);
    assert.equal(row.type, type);
  } finally {
    spy.restore();
  }
});

// ── M. Repeated identical issue: occurrence_count increments, deduped ───

test('M: a repeated identical issue increments occurrence_count but is deduped/cooled down, not re-alerted', async () => {
  const spy = installTelegramSpy();
  const type = uniqueType('repeat');
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/paypal/create-order', message: 'same failure', severity: 'WARNING' });
    const second = await technicalIssues.recordIssue({ type, route: '/api/paypal/create-order', message: 'same failure', severity: 'WARNING' });
    const third = await technicalIssues.recordIssue({ type, route: '/api/paypal/create-order', message: 'same failure', severity: 'WARNING' });

    assert.equal(first.signature, second.signature, 'identical type+route+message must share one signature');
    assert.equal(second.signature, third.signature);
    assert.equal(third.occurrenceCount, 3, 'occurrence_count keeps incrementing every time');

    assert.equal(spy.calls.length, 3, 'notify() is asked every time (occurrence tracking never stops)');
    const sentCalls = spy.calls.filter((c) => c.sent);
    assert.equal(sentCalls.length, 1, 'only the first occurrence may actually send -- the rest are cooled down');
    assert.equal(spy.calls[1].reason, 'cooldown');
    assert.equal(spy.calls[2].reason, 'cooldown');

    const row = await dbGet(`SELECT occurrence_count FROM technical_issues WHERE signature = ?`, [first.signature]);
    assert.equal(row.occurrence_count, 3, 'DB truth reflects every occurrence even though Telegram was suppressed');
  } finally {
    spy.restore();
  }
});

// ── N. A distinct issue gets its own separate alert ─────────────────────

test('N: a distinct issue (different type) gets its own separate alert, independent of an unrelated issue\'s cooldown', async () => {
  const spy = installTelegramSpy();
  const typeA = uniqueType('a');
  const typeB = uniqueType('b');
  try {
    await technicalIssues.recordIssue({ type: typeA, route: '/api/paypal/capture-order', message: 'failure A', severity: 'WARNING' });
    await technicalIssues.recordIssue({ type: typeA, route: '/api/paypal/capture-order', message: 'failure A', severity: 'WARNING' }); // deduped
    await technicalIssues.recordIssue({ type: typeB, route: '/api/paypal/capture-order', message: 'failure B', severity: 'WARNING' }); // distinct

    const sentCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue' && c.sent);
    assert.equal(sentCalls.length, 2, 'issue A sends once, issue B sends once -- independently');
    assert.notEqual(sentCalls[0].dedupKey, sentCalls[1].dedupKey);
  } finally {
    spy.restore();
  }
});

// ── O. Harmless/non-customer issue never alerts the owner ──────────────

test('O: a 400 client-validation error on checkout create-order is not recorded as a technical issue', async () => {
  const spy = installTelegramSpy();
  try {
    const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }), // empty cart -- ordinary validation failure, not a technical issue
    });
    assert.equal(res.status, 400);

    const eventCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.equal(eventCalls.length, 0, 'an ordinary empty-cart 400 must never page the owner');
  } finally {
    spy.restore();
  }
});

// ── P. Telemetry endpoint sanitizes/truncates unsafe input ─────────────

test('P: recordIssue truncates an overlong message and strips query-string/PII-shaped content from route', async () => {
  const spy = installTelegramSpy();
  const type = uniqueType('sanitize');
  const hugeMessage = 'A'.repeat(5000);
  try {
    const result = await technicalIssues.recordIssue({
      type,
      route: '/api/checkout?token=SECRET-SHOULD-NOT-PERSIST&email=someone@example.com',
      message: hugeMessage,
      severity: 'WARNING',
    });

    const row = await dbGet(`SELECT route, message FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.ok(row.message.length <= 200, `message must be truncated, got length ${row.message.length}`);
    assert.doesNotMatch(row.route, /token=SECRET-SHOULD-NOT-PERSIST/, 'query string must be stripped from the stored route');
    assert.doesNotMatch(row.route, /email=/);
    assert.equal(row.route, '/api/checkout');
  } finally {
    spy.restore();
  }
});

test('P (frontend-error endpoint): oversized/garbage input is rejected or safely truncated, never stored raw', async () => {
  const humanHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const noMessage = await fetch(`${baseUrl}/api/telemetry/frontend-error`, {
    method: 'POST',
    headers: humanHeaders,
    body: JSON.stringify({ sessionId: 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36) }),
  });
  assert.equal(noMessage.status, 400, 'a report with no message must be rejected');

  const overlong = await fetch(`${baseUrl}/api/telemetry/frontend-error`, {
    method: 'POST',
    headers: humanHeaders,
    body: JSON.stringify({
      sessionId: 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
      message: 'B'.repeat(2000),
      source: 'window.error',
      path: '/checkout?secret=SHOULD-NOT-PERSIST',
      context: 'checkout',
    }),
  });
  assert.equal(overlong.status, 200);

  const row = await dbGet(`SELECT route, message FROM technical_issues WHERE type = 'frontend_uncaught_error' ORDER BY id DESC LIMIT 1`);
  assert.ok(row, 'the sanitized report must still be stored');
  assert.ok(row.message.length <= 220, `stored message must be bounded, got length ${row.message.length}`);
  assert.doesNotMatch(row.route, /secret=/);

  const oversizedBody = await fetch(`${baseUrl}/api/telemetry/frontend-error`, {
    method: 'POST',
    headers: humanHeaders,
    body: JSON.stringify({ message: 'x'.repeat(20000) }),
  });
  assert.ok(oversizedBody.status === 400 || oversizedBody.status === 413, `oversized body must be rejected, got ${oversizedBody.status}`);
});
