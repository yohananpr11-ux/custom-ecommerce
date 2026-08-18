// First-party visitor/session telemetry (PR #34): idempotent session-start
// insert, exactly-once-per-session owner notification, bot filtering,
// malformed-payload rejection, and Telegram-outage isolation.
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-visitor-sessions-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-telemetry';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-telemetry';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-telemetry';

const { app } = require('../index.js');
const db = require('../db.js');
const ownerNotifications = require('../services/owner-notifications.js');

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

const HUMAN_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const BOT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept-Language': 'en-US,en;q=0.9',
};

function randomId(prefix = 'sid') {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function postSessionStart(body, headers = HUMAN_HEADERS) {
  const res = await fetch(`${baseUrl}/api/telemetry/session-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

function installTelegramSpy() {
  const calls = [];
  const spy = mock.method(ownerNotifications, 'notify', async (params) => {
    calls.push(params);
    return { sent: true, ...params };
  });
  return { calls, restore: () => spy.mock.restore() };
}

// ── A. First human session ──────────────────────────────────────────────

test('A: first human session inserts a row and sends exactly one owner notification', async () => {
  const spy = installTelegramSpy();
  const visitorId = randomId('vid');
  const sessionId = randomId('sid');
  try {
    const res = await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);

    const row = await dbGet(`SELECT * FROM visitor_sessions WHERE session_id = ?`, [sessionId]);
    assert.ok(row, 'session row must be inserted');
    assert.equal(row.is_human, 1);
    assert.equal(row.notified, 1);

    const sessionNotifies = spy.calls.filter((c) => c.eventType === 'new_human_session');
    assert.equal(sessionNotifies.length, 1, 'exactly one new_human_session notification');
    assert.equal(sessionNotifies[0].dedupKey, `new_human_session:${sessionId}`);
  } finally {
    spy.restore();
  }
});

// ── B/C. Same session again (reload-equivalent) ─────────────────────────

test('B/C: the same session_id posted again (reload/duplicate retry) never notifies twice', async () => {
  const spy = installTelegramSpy();
  const visitorId = randomId('vid');
  const sessionId = randomId('sid');
  try {
    const first = await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' });
    assert.equal(first.status, 200);
    // Simulate a reload (same session_id) and a duplicate HTTP retry of the
    // exact same request -- both must be complete no-ops for notification.
    const second = await postSessionStart({ visitorId, sessionId, landingPath: '/some-other-page', referrer: '', source: '' });
    const third = await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' });
    assert.equal(second.status, 200);
    assert.equal(third.status, 200);

    const sessionNotifies = spy.calls.filter((c) => c.eventType === 'new_human_session');
    assert.equal(sessionNotifies.length, 1, 'only the first insert may ever notify');

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM visitor_sessions WHERE session_id = ?`, [sessionId], (err, r) => (err ? reject(err) : resolve(r)));
    });
    assert.equal(rows.length, 1, 'no duplicate row -- session_id is the idempotency key');
    // Landing page from the FIRST insert is preserved; a reload never
    // rewrites session-start fields.
    assert.equal(rows[0].landing_path, '/');
  } finally {
    spy.restore();
  }
});

// ── D. A genuinely new session_id notifies again ────────────────────────

test('D: a different new session_id from the same visitor produces its own notification', async () => {
  const spy = installTelegramSpy();
  const visitorId = randomId('vid');
  try {
    await postSessionStart({ visitorId, sessionId: randomId('sid'), landingPath: '/', referrer: '', source: '' });
    await postSessionStart({ visitorId, sessionId: randomId('sid'), landingPath: '/', referrer: '', source: '' });

    const sessionNotifies = spy.calls.filter((c) => c.eventType === 'new_human_session');
    assert.equal(sessionNotifies.length, 2, 'two distinct sessions must each notify once');
    assert.notEqual(sessionNotifies[0].dedupKey, sessionNotifies[1].dedupKey);
  } finally {
    spy.restore();
  }
});

// ── E. Obvious bot never notifies ───────────────────────────────────────

test('E: an obvious bot/crawler is stored (if at all) without ever notifying the owner', async () => {
  const spy = installTelegramSpy();
  const visitorId = randomId('vid');
  const sessionId = randomId('sid');
  try {
    const res = await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' }, BOT_HEADERS);
    assert.equal(res.status, 200);

    const sessionNotifies = spy.calls.filter((c) => c.eventType === 'new_human_session');
    assert.equal(sessionNotifies.length, 0, 'a bot/crawler must never trigger a human-session notification');

    const row = await dbGet(`SELECT is_human, notified FROM visitor_sessions WHERE session_id = ?`, [sessionId]);
    if (row) {
      assert.equal(row.is_human, 0);
      assert.equal(row.notified, 0);
    }
  } finally {
    spy.restore();
  }
});

// ── F. Malformed payload is rejected safely ─────────────────────────────

test('F: malformed payloads are rejected with 4xx and never crash the endpoint', async () => {
  const spy = installTelegramSpy();
  try {
    const missingIds = await postSessionStart({ landingPath: '/' });
    assert.equal(missingIds.status, 400);

    const shortId = await postSessionStart({ visitorId: 'x', sessionId: 'y', landingPath: '/' });
    assert.equal(shortId.status, 400);

    const wrongTypes = await fetch(`${baseUrl}/api/telemetry/session-start`, {
      method: 'POST',
      headers: HUMAN_HEADERS,
      body: JSON.stringify({ visitorId: 12345, sessionId: { not: 'a string' } }),
    });
    assert.equal(wrongTypes.status, 400);

    const oversized = await fetch(`${baseUrl}/api/telemetry/session-start`, {
      method: 'POST',
      headers: HUMAN_HEADERS,
      body: JSON.stringify({ visitorId: randomId('vid'), sessionId: randomId('sid'), landingPath: 'x'.repeat(20000) }),
    });
    assert.ok(oversized.status === 400 || oversized.status === 413, `oversized body must be rejected, got ${oversized.status}`);

    assert.equal(spy.calls.filter((c) => c.eventType === 'new_human_session').length, 0, 'no malformed request may ever notify');
  } finally {
    spy.restore();
  }
});

// ── G. Telegram failure never breaks the endpoint ───────────────────────

test('G: an owner-notification failure still leaves the session endpoint succeeding and the row recorded', async () => {
  const failingNotify = mock.method(ownerNotifications, 'notify', async () => { throw new Error('simulated Telegram outage'); });
  const visitorId = randomId('vid');
  const sessionId = randomId('sid');
  try {
    const res = await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);

    const row = await dbGet(`SELECT * FROM visitor_sessions WHERE session_id = ?`, [sessionId]);
    assert.ok(row, 'the session row must still be recorded even though notification failed');
    assert.equal(row.notified, 0, 'notified stays 0 since the notify call itself threw');
  } finally {
    failingNotify.mock.restore();
  }
});

// ── Rate limiting sanity (not one of the lettered requirements, but cheap
// insurance that the limiter itself does not accidentally block normal use) ──

test('rate limiting: a handful of ordinary requests from one IP all succeed', async () => {
  const spy = installTelegramSpy();
  try {
    for (let i = 0; i < 5; i += 1) {
      const res = await postSessionStart({ visitorId: randomId('vid'), sessionId: randomId('sid'), landingPath: '/', referrer: '', source: '' });
      assert.equal(res.status, 200);
    }
  } finally {
    spy.restore();
  }
});
