// Durable (SQLite-backed) issue-notification dedupe/cooldown (PR #34
// follow-up hardening): the alert cooldown decision survives a process
// restart, a failed Telegram delivery never counts as a successful
// notification, occurrence_count always increments regardless of
// notification outcome, and two near-simultaneous duplicate occurrences
// cannot both send a real alert.
//
// Same real-app harness pattern as the rest of this suite -- isolated temp
// DB, no real Telegram network call ever made (telegram.sendMessage is
// mocked to simulate genuine success/failure deterministically).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'technical-issue-durable-dedupe-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-durable';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-durable';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-durable';

// require index.js (not strictly needed here, but keeps this file's DB
// initialization identical to every other test file in the suite -- db.js
// alone does not await its own migration Promise before other code runs).
require('../index.js');
const db = require('../db.js');
const ownerNotifications = require('../services/owner-notifications.js');
const technicalIssues = require('../services/technical-issues.js');
const telegram = require('../services/telegram.js');

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});

test.before(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test.after(async () => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

test.beforeEach(() => {
  ownerNotifications._resetForTests();
});

function uniqueType(label) {
  return `test_durable_${label}_${Math.random().toString(36).slice(2)}`;
}

function installGenuineTelegramDelivery() {
  return mock.method(telegram, 'sendMessage', async () => ({ ok: true, status: 200 }));
}

function installFailingTelegramDelivery() {
  return mock.method(telegram, 'sendMessage', async () => ({ ok: false, skipped: false, reason: 'telegram_api_error', details: 'HTTP_500' }));
}

// Wraps (not replaces) owner-notifications.notify() so the REAL cooldown/
// dedup logic keeps running; only records what was requested/decided.
function installNotifySpy() {
  const calls = [];
  const originalNotify = ownerNotifications.notify.bind(ownerNotifications);
  const spy = mock.method(ownerNotifications, 'notify', async (params) => {
    const result = await originalNotify(params);
    calls.push({ ...params, sent: result.sent, reason: result.reason });
    return result;
  });
  return { calls, restore: () => spy.mock.restore() };
}

// ── A. First issue => one alert ─────────────────────────────────────────

test('A: the first occurrence of an issue durably records a successful notification', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = uniqueType('first');
  try {
    const result = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(result.occurrenceCount, 1);
    assert.equal(result.notifiedCount, 1);
    assert.equal(spy.calls.length, 1);

    const row = await dbGet(`SELECT * FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.ok(row.last_notified_at, 'last_notified_at must be durably set');
    assert.equal(row.notified_count, 1);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── B. Duplicate inside cooldown => zero second alert ───────────────────

test('B: a duplicate occurrence inside the cooldown window sends zero additional alerts', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = uniqueType('cooldown');
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    const second = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });

    assert.equal(first.notifiedCount, 1);
    assert.equal(second.occurrenceCount, 2, 'occurrence_count still increments');
    assert.equal(second.notifiedCount, 1, 'notified_count unchanged -- still inside cooldown');
    assert.equal(spy.calls.length, 1, 'notify() is never even invoked for the suppressed occurrence');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── C. Simulated backend restart: cooldown state survives ──────────────

test('C: a fresh technical-issues module instance (simulated process restart) still honors the durable DB cooldown', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = uniqueType('restart');
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(first.notifiedCount, 1);

    // Simulate a process restart: clear this module (and only this
    // module) from require.cache and re-require it fresh. Any in-memory
    // cooldown state would be lost here -- owner-notifications.js and db.js
    // stay cached, exactly like a real restart would reset THIS process's
    // memory but not the on-disk SQLite file.
    delete require.cache[require.resolve('../services/technical-issues.js')];
    const freshTechnicalIssues = require('../services/technical-issues.js');

    const second = await freshTechnicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(second.occurrenceCount, 2);
    assert.equal(second.notifiedCount, 1, 'still 1 -- the fresh module instance reads last_notified_at from SQLite and correctly suppresses');
    assert.equal(spy.calls.length, 1, 'the fresh instance never re-invoked notify()');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── D. Cooldown expired => alert allowed again ──────────────────────────

test('D: once the durable cooldown window has genuinely elapsed, the same issue may alert again', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = uniqueType('expired');
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(first.notifiedCount, 1);

    // Backdate last_notified_at well beyond the WARNING cooldown (15min)
    // instead of actually waiting -- exercises the same DB-driven
    // cooldown-elapsed check deterministically and fast.
    await dbRun(`UPDATE technical_issues SET last_notified_at = datetime('now', '-20 minutes') WHERE signature = ?`, [first.signature]);

    const second = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(second.occurrenceCount, 2);
    assert.equal(second.notifiedCount, 2, 'cooldown elapsed -- a second real alert is allowed');
    assert.equal(spy.calls.length, 2);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── E. Successful alert updates durable notification state ─────────────

test('E: a successful delivery durably records last_notified_at and increments notified_count', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const type = uniqueType('successstate');
  try {
    const before = Date.now();
    const result = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    const row = await dbGet(`SELECT last_notified_at, notified_count FROM technical_issues WHERE signature = ?`, [result.signature]);
    assert.equal(row.notified_count, 1);
    assert.ok(row.last_notified_at, 'last_notified_at must be set');
    const notifiedAtMs = new Date(row.last_notified_at + 'Z').getTime();
    assert.ok(notifiedAtMs >= before - 5000, 'last_notified_at must reflect roughly now, not a stale/default value');
  } finally {
    telegramMock.mock.restore();
  }
});

// ── F. Failed Telegram alert does NOT update successful-notification state ──

test('F: a failed Telegram delivery does not durably mark the issue as notified, and does not block a fast genuine retry', async () => {
  const failMock = installFailingTelegramDelivery();
  let failMockRestored = false;
  const type = uniqueType('faildeliver');
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
    assert.equal(first.notifiedCount, 0, 'a failed delivery must not count as a successful notification');

    const row = await dbGet(`SELECT last_notified_at, notified_count, occurrence_count FROM technical_issues WHERE signature = ?`, [first.signature]);
    assert.equal(row.last_notified_at, null, 'last_notified_at must remain unset after a failed delivery');
    assert.equal(row.notified_count, 0);
    assert.equal(row.occurrence_count, 1, 'occurrence tracking still happened despite the failed delivery');

    failMock.mock.restore();
    failMockRestored = true;
    const okMock = installGenuineTelegramDelivery();
    try {
      // Immediately retry, no real wait -- must not be blocked by any
      // cooldown, since the prior attempt never durably succeeded.
      const second = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'boom', severity: 'WARNING' });
      assert.equal(second.notifiedCount, 1, 'a genuine retry immediately after a failed delivery must be allowed');
    } finally {
      okMock.mock.restore();
    }
  } finally {
    if (!failMockRestored) failMock.mock.restore();
  }
});

// ── G. occurrence_count always increments correctly ─────────────────────

test('G: occurrence_count increments on every call regardless of notification outcome (fail, then success, then cooldown)', async () => {
  const type = uniqueType('alwaysincrement');
  const failMock = installFailingTelegramDelivery();
  const r1 = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' }); // fails delivery
  failMock.mock.restore();

  const okMock = installGenuineTelegramDelivery();
  const r2 = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' }); // succeeds (never durably claimed before)
  const r3 = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' }); // cooldown-suppressed
  okMock.mock.restore();

  assert.equal(r1.occurrenceCount, 1);
  assert.equal(r2.occurrenceCount, 2);
  assert.equal(r3.occurrenceCount, 3);
  assert.equal(r1.notifiedCount, 0);
  assert.equal(r2.notifiedCount, 1);
  assert.equal(r3.notifiedCount, 1);
});

// ── H. Concurrency: near-simultaneous duplicates send only one alert ────

test('H: two near-simultaneous recordIssue calls for the same brand-new signature send only one real alert', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = uniqueType('concurrent');
  try {
    const [a, b] = await Promise.all([
      technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' }),
      technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' }),
    ]);

    const notifiedCounts = [a.notifiedCount, b.notifiedCount].sort();
    assert.deepEqual(notifiedCounts, [0, 1], 'exactly one of the two concurrent calls wins the atomic notify claim');
    assert.equal(spy.calls.length, 1, 'notify() is invoked exactly once across both concurrent calls');

    const row = await dbGet(`SELECT occurrence_count, notified_count FROM technical_issues WHERE signature = ?`, [a.signature]);
    assert.equal(row.occurrence_count, 2, 'both concurrent calls are still counted as real occurrences');
    assert.equal(row.notified_count, 1);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});
