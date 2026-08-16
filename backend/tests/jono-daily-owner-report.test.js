// JONO Daily Owner Report test suite (PR #36):
// Proves that:
// 1. Timezone & scheduling: before 22:00 Jerusalem => zero sends; at or after 22:00 => eligible.
// 2. Exact Jerusalem DST handling (summer IDT vs winter IST intervals).
// 3. Durable SQLite dedupe: repeated scheduler runs on the same day send exactly ONE report.
// 4. Restart-safe: simulated process restart still honors the sent state and does not duplicate.
// 5. Next local calendar day allows a new report.
// 6. Delivery confirmation: Telegram success marks sent_at in SQLite; failure leaves sent_at NULL.
// 7. Safe retry: when Telegram fails, report is not marked sent and can retry after cooldown.
// 8. Concurrency: multiple simultaneous executions result in at most one Telegram message.
// 9. Real metrics only: definitively paid orders count as revenue; pending/unpaid orders do NOT.
// 10. Privacy & security: zero raw IPs, secrets, customer names, or PII in report.
// 11. Routine operational noise suppression (PR #35) remains 100% intact.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-daily-report-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-daily';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-daily';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = 'mock-telegram-token';
process.env.TELEGRAM_OWNER_CHAT_ID = '123456789';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-daily';

const { app } = require('../index.js');
const db = require('../db.js');
const telegram = require('../services/telegram.js');
const ownerNotifications = require('../services/owner-notifications.js');
const dailyOwnerReport = require('../services/daily-owner-report.js');
const technicalIssues = require('../services/technical-issues.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
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
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test.beforeEach(() => {
  ownerNotifications._resetForTests();
});

function installTelegramMock() {
  const sentMessages = [];
  const mockHandle = mock.method(telegram, 'sendMessage', async (text) => {
    sentMessages.push(text);
    return { ok: true, status: 200 };
  });
  return {
    sentMessages,
    restore: () => mockHandle.mock.restore(),
  };
}

// ── 1. Eligibility & Scheduling at 22:00 Europe/Jerusalem ─────────────

test('1: before 22:00 Europe/Jerusalem is not eligible; at/after 22:00 is eligible', () => {
  // Test dates formatted as UTC equivalent of Jerusalem hours
  // In Jerusalem (UTC+3 summer): 21:59 local is 18:59 UTC; 22:00 local is 19:00 UTC
  const beforeTime = new Date('2026-08-16T18:59:00.000Z');
  const eligibleTime = new Date('2026-08-16T19:00:00.000Z');
  const lateTime = new Date('2026-08-16T20:45:00.000Z');

  assert.equal(dailyOwnerReport.isEligibleForDailyReport(beforeTime), false, '18:59 UTC (21:59 IDT) is not eligible');
  assert.equal(dailyOwnerReport.isEligibleForDailyReport(eligibleTime), true, '19:00 UTC (22:00 IDT) is eligible');
  assert.equal(dailyOwnerReport.isEligibleForDailyReport(lateTime), true, '20:45 UTC (23:45 IDT) is eligible');
});

// ── 2. Timezone & DST Calculation ─────────────────────────────────────

test('2: Europe/Jerusalem DST interval calculation handles summer (IDT) and winter (IST)', () => {
  const summerInterval = dailyOwnerReport.getJerusalemDayInterval('2026-08-16');
  assert.equal(summerInterval.startUtcIso, '2026-08-15T21:00:00.000Z', 'Summer midnight in IDT is 21:00 UTC previous day');
  assert.equal(summerInterval.endUtcIso, '2026-08-16T21:00:00.000Z');

  const winterInterval = dailyOwnerReport.getJerusalemDayInterval('2026-01-16');
  assert.equal(winterInterval.startUtcIso, '2026-01-15T22:00:00.000Z', 'Winter midnight in IST is 22:00 UTC previous day');
  assert.equal(winterInterval.endUtcIso, '2026-01-16T22:00:00.000Z');
});

// ── 3. Before 22:00 => zero sends ─────────────────────────────────────

test('3: generateAndSendDailyReport before 22:00 skips sending without force flag', async () => {
  const tMock = installTelegramMock();
  try {
    const afternoonDate = new Date('2026-08-16T12:00:00.000Z'); // 15:00 local
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: afternoonDate,
      db,
      force: false,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not_eligible_yet');
    assert.equal(tMock.sentMessages.length, 0, 'zero telegram messages sent before 22:00');
  } finally {
    tMock.restore();
  }
});

// ── 4. Eligible after 22:00 => sends exactly ONE report ───────────────

test('4: generateAndSendDailyReport sends report when eligible, recording sent_at in SQLite', async () => {
  const tMock = installTelegramMock();
  const testDateStr = '2026-08-16';
  const eveningDate = new Date('2026-08-16T19:05:00.000Z'); // 22:05 IDT

  try {
    // Seed some real data for today
    await dbRun(
      `INSERT INTO visitor_sessions (visitor_id, session_id, started_at, is_human, device_category, landing_path, referrer)
       VALUES ('vis_test_1', 'sess_test_1', '2026-08-16 10:00:00', 1, 'Mobile', '/product/1', 'instagram.com')`
    );
    await dbRun(
      `INSERT INTO visitor_sessions (visitor_id, session_id, started_at, is_human, device_category, landing_path, referrer)
       VALUES ('vis_test_2', 'sess_test_2', '2026-08-16 11:00:00', 1, 'Desktop', '/', 'direct')`
    );

    // Paid order
    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt)
       VALUES ('Test Buyer', 'buyer@example.invalid', 199.00, 'paid', 'Main St 10', '2026-08-16 12:00:00')`
    );
    const orderId = orderInsert.lastID;
    await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status)
       VALUES (?, 1, 1, 199.00, 'dropship', 'pending')`,
      [orderId]
    );

    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: eveningDate,
      dateStr: testDateStr,
      db,
    });

    assert.equal(result.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    const msg = tMock.sentMessages[0];
    assert.match(msg, /JONO — סיכום יומי/);
    assert.match(msg, /16\/08\/2026/);
    assert.match(msg, /סשנים של בני אדם: 2/);
    assert.match(msg, /הזמנות ששולמו: 1/);
    assert.match(msg, /199\.00/);
    assert.match(msg, /Event: DAILY_OWNER_REPORT/);
    assert.match(msg, /Date: 2026-08-16/);

    // Verify row in daily_owner_reports
    const row = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      [testDateStr]
    );
    assert.ok(row, 'row exists in DB');
    assert.equal(row.status, 'sent');
    assert.ok(row.sent_at, 'sent_at is populated');
  } finally {
    tMock.restore();
  }
});

// ── 5. Duplicate call same day => deduped / zero extra sends ──────────

test('5: repeated scheduler calls on the same day are deduped by SQLite state', async () => {
  const tMock = installTelegramMock();
  const testDateStr = '2026-08-16';
  const eveningDate = new Date('2026-08-16T19:10:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: eveningDate,
      dateStr: testDateStr,
      db,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_sent');
    assert.equal(tMock.sentMessages.length, 0, 'zero additional telegram messages sent');
  } finally {
    tMock.restore();
  }
});

// ── 6. Restart simulation => still deduped (survives restart) ─────────

test('6: simulated backend restart on same day honors SQLite state and does not re-send', async () => {
  const tMock = installTelegramMock();
  const testDateStr = '2026-08-16';
  const eveningDate = new Date('2026-08-16T19:30:00.000Z');

  try {
    // Reset all in-memory state
    ownerNotifications._resetForTests();

    // Call report after simulated restart
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: eveningDate,
      dateStr: testDateStr,
      db,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_sent');
    assert.equal(tMock.sentMessages.length, 0, 'no duplicate message sent after restart');
  } finally {
    tMock.restore();
  }
});

// ── 7. Next calendar day => new report allowed ────────────────────────

test('7: next local calendar day is treated as a new cycle and allows report send', async () => {
  const tMock = installTelegramMock();
  const nextDayStr = '2026-08-17';
  const nextEveningDate = new Date('2026-08-17T19:00:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: nextEveningDate,
      dateStr: nextDayStr,
      db,
    });

    assert.equal(result.sent, true);
    assert.equal(tMock.sentMessages.length, 1);
    assert.match(tMock.sentMessages[0], /17\/08\/2026/);
  } finally {
    tMock.restore();
  }
});

// ── 8. Telegram delivery failure does NOT mark sent ───────────────────

test('8: Telegram failure does not mark report sent, enabling safe later retry', async () => {
  let shouldFail = true;
  const sentMessages = [];
  const tMock = mock.method(telegram, 'sendMessage', async (text) => {
    if (shouldFail) {
      return { ok: false, reason: 'network_error' };
    }
    sentMessages.push(text);
    return { ok: true, status: 200 };
  });

  const failureDateStr = '2026-08-18';
  const failureDate = new Date('2026-08-18T19:00:00.000Z');

  try {
    // Attempt 1: Telegram fails
    const res1 = await dailyOwnerReport.generateAndSendDailyReport({
      date: failureDate,
      dateStr: failureDateStr,
      db,
    });

    assert.equal(res1.sent, false);
    assert.equal(sentMessages.length, 0);

    // Verify DB row: status is 'failed', sent_at is NULL
    const row = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      [failureDateStr]
    );
    assert.ok(row);
    assert.equal(row.status, 'failed');
    assert.equal(row.sent_at, null);

    // Attempt 2: Telegram recovered, force flag to bypass retry cooldown
    shouldFail = false;
    const res2 = await dailyOwnerReport.generateAndSendDailyReport({
      date: failureDate,
      dateStr: failureDateStr,
      force: true,
      db,
    });

    assert.equal(res2.sent, true);
    assert.equal(sentMessages.length, 1);

    const rowAfter = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      [failureDateStr]
    );
    assert.equal(rowAfter.status, 'sent');
    assert.ok(rowAfter.sent_at);
  } finally {
    tMock.mock.restore();
  }
});

// ── 9. Concurrent scheduler runs => max one send ──────────────────────

test('9: two concurrent generateAndSendDailyReport calls result in exactly one Telegram message', async () => {
  const tMock = installTelegramMock();
  const concurrentDateStr = '2026-08-19';
  const concurrentDate = new Date('2026-08-19T19:00:00.000Z');

  try {
    const [res1, res2] = await Promise.all([
      dailyOwnerReport.generateAndSendDailyReport({ date: concurrentDate, dateStr: concurrentDateStr, db }),
      dailyOwnerReport.generateAndSendDailyReport({ date: concurrentDate, dateStr: concurrentDateStr, db }),
    ]);

    const sentCount = (res1.sent ? 1 : 0) + (res2.sent ? 1 : 0);
    assert.equal(sentCount, 1, 'exactly one concurrent call succeeded');
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── 10. Only paid orders count as revenue ─────────────────────────────

test('10: pending and unpaid orders are excluded from paid revenue and counts', async () => {
  const tMock = installTelegramMock();
  const revenueDateStr = '2026-08-20';
  const revenueDate = new Date('2026-08-20T19:00:00.000Z');

  try {
    // 1 Paid order of 150
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt)
       VALUES ('Paid Buyer', 'paid@example.invalid', 150.00, 'paid', 'St 1', '2026-08-20 12:00:00')`
    );

    // 1 Unpaid pending order of 300
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt)
       VALUES ('Unpaid Buyer', 'unpaid@example.invalid', 300.00, 'pending', 'St 2', '2026-08-20 13:00:00')`
    );

    // 1 Cancelled order of 500
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt)
       VALUES ('Cancelled Buyer', 'cancelled@example.invalid', 500.00, 'cancelled', 'St 3', '2026-08-20 14:00:00')`
    );

    const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: revenueDateStr, db });
    assert.equal(metrics.sales.paidOrdersCount, 1, 'only paid orders counted');
    assert.equal(metrics.sales.paidRevenueILS, 150.00, 'revenue equals paid amount only (excludes 300 and 500)');

    const message = dailyOwnerReport.buildDailyReportMessage(metrics);
    assert.match(message, /הזמנות ששולמו: 1/);
    assert.match(message, /הכנסה ששולמה: ₪150\.00/);
    assert.doesNotMatch(message, /₪950\.00/);
  } finally {
    tMock.restore();
  }
});

// ── 11. Privacy & Security: zero PII / Secrets in Report ───────────────

test('11: report contains no customer names, emails, raw IP addresses, or secrets', async () => {
  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: '2026-08-20', db });
  const message = dailyOwnerReport.buildDailyReportMessage(metrics);

  assert.doesNotMatch(message, /paid@example\.invalid/);
  assert.doesNotMatch(message, /Paid Buyer/);
  assert.doesNotMatch(message, /mock-telegram-token/);
  assert.doesNotMatch(message, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
});

// ── 12. PR #35 Noise Suppression Remains Intact ───────────────────────

test('12: routine startup/scheduled syncs and backup cycles remain silent on Telegram', async () => {
  const tMock = installTelegramMock();
  const printify = require('../services/printify.js');
  const sqliteBackup = require('../services/sqlite-backup.js');

  try {
    const originalToken = printify.token;
    printify.token = '';
    await printify.syncProducts('startup');
    await printify.syncProducts('scheduled');
    printify.token = originalToken;

    const backupSubdir = path.join(tmpDir, 'noise-check-backups');
    await sqliteBackup.runBackupCycle({
      db,
      backupDir: backupSubdir,
      env: { ENABLE_SQLITE_BACKUPS: 'true' },
    });

    assert.equal(tMock.sentMessages.length, 0, 'PR #35 noise suppression remains 100% intact');
  } finally {
    tMock.restore();
  }
});
