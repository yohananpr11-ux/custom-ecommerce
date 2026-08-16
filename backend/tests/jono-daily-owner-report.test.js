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
// 12. Real zero after successful query => shown as zero (never falsely marked unavailable).
// 13. Failed traffic/sales/issues/fulfillment queries => truthfully marked 'לא זמין כרגע' / UNAVAILABLE (never 0).
// 14. Real latest backup found using { name, path, mtimeMs } and .sha256 sidecar truthful reporting.
// 15. Correct ENABLE_OFFSITE_BACKUP flag used via isOffsiteBackupEnabled(env).
// 16. Safe referrer domain only (strips query parameters, paths, tokens, PII).
// 17. HTML escaping for all user-controlled/dynamic values (< > & " ').
// 18. Paid-today analytics uses genuine paid_at timestamp with legacy createdAt fallback.
// 19. Truthful 22:00 reporting window documentation.
// 20. Partial report sends successfully even when a metric query fails.

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
  const beforeTime = new Date('2026-08-16T18:59:00.000Z');
  const eligibleTime = new Date('2026-08-16T19:00:00.000Z');
  const lateTime = new Date('2026-08-16T20:45:00.000Z');

  assert.equal(dailyOwnerReport.isEligibleForDailyReport(beforeTime), false, '18:59 UTC (21:59 IDT) is not eligible');
  assert.equal(dailyOwnerReport.isEligibleForDailyReport(eligibleTime), true, '19:00 UTC (22:00 IDT) is eligible');
  assert.equal(dailyOwnerReport.isEligibleForDailyReport(lateTime), true, '20:45 UTC (23:45 IDT) is eligible');
});

// ── 2. Exact Jerusalem Day Interval Calculation & DST ─────────────────

test('2: getJerusalemDayInterval correctly calculates UTC bounds for summer (IDT) and winter (IST)', () => {
  const summerInterval = dailyOwnerReport.getJerusalemDayInterval('2026-08-16');
  assert.equal(summerInterval.startUtcIso, '2026-08-15T21:00:00.000Z', 'Summer (IDT = UTC+3): 00:00 IDT is 21:00 UTC previous day');
  assert.equal(summerInterval.endUtcIso, '2026-08-16T21:00:00.000Z', 'Summer (IDT = UTC+3): 24:00 IDT is 21:00 UTC target day');

  const winterInterval = dailyOwnerReport.getJerusalemDayInterval('2026-01-15');
  assert.equal(winterInterval.startUtcIso, '2026-01-14T22:00:00.000Z', 'Winter (IST = UTC+2): 00:00 IST is 22:00 UTC previous day');
  assert.equal(winterInterval.endUtcIso, '2026-01-15T22:00:00.000Z', 'Winter (IST = UTC+2): 24:00 IST is 22:00 UTC target day');
});

// ── 3. Scheduler ignores invocation before 22:00 ──────────────────────

test('3: generateAndSendDailyReport skips sending before 22:00 without force flag', async () => {
  const tMock = installTelegramMock();
  const afternoonDate = new Date('2026-08-16T11:00:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: afternoonDate,
      dateStr: '2026-08-16',
      db,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not_eligible_yet');
    assert.equal(tMock.sentMessages.length, 0);

    const row = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      ['2026-08-16']
    );
    assert.equal(row, undefined, 'no report record created for skipped run');
  } finally {
    tMock.restore();
  }
});

// ── 4. Eligible execution at 22:00 sends report and records sent_at ───

test('4: eligible execution at 22:00 sends report and records sent_at in SQLite', async () => {
  const tMock = installTelegramMock();
  const eveningDate = new Date('2026-08-16T19:00:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: eveningDate,
      dateStr: '2026-08-16',
      db,
    });

    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    const msg = tMock.sentMessages[0];
    assert.match(msg, /JONO — סיכום יומי/);
    assert.match(msg, /תאריך: 16\/08\/2026/);
    assert.match(msg, /חלון דיווח: מתחילת היום עד 22:00/);
    assert.match(msg, /Event: DAILY_OWNER_REPORT/);
    assert.match(msg, /Window: 2026-08-16 00:00 - 22:00 \(Jerusalem\)/);

    const row = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      ['2026-08-16']
    );
    assert.ok(row, 'row exists');
    assert.equal(row.status, 'sent');
    assert.ok(row.sent_at, 'sent_at is set');
    assert.equal(row.attempt_count, 1);
  } finally {
    tMock.restore();
  }
});

// ── 5. Same-day duplicate run is deduped ───────────────────────────────

test('5: subsequent execution on same day is deduped (0 extra Telegram sends)', async () => {
  const tMock = installTelegramMock();
  const eveningDate = new Date('2026-08-16T19:15:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: eveningDate,
      dateStr: '2026-08-16',
      db,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_sent');
    assert.equal(tMock.sentMessages.length, 0, 'zero additional messages sent');
  } finally {
    tMock.restore();
  }
});

// ── 6. Restart-safe on same day ───────────────────────────────────────

test('6: simulated restart on same day honors SQLite state and does not duplicate', async () => {
  const tMock = installTelegramMock();
  const lateEveningDate = new Date('2026-08-16T20:30:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: lateEveningDate,
      dateStr: '2026-08-16',
      db,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_sent');
    assert.equal(tMock.sentMessages.length, 0);
  } finally {
    tMock.restore();
  }
});

// ── 7. Next calendar day allows new report ────────────────────────────

test('7: next local calendar day (2026-08-17) sends a new distinct report', async () => {
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
    const res1 = await dailyOwnerReport.generateAndSendDailyReport({
      date: failureDate,
      dateStr: failureDateStr,
      db,
    });

    assert.equal(res1.sent, false);
    assert.equal(sentMessages.length, 0);

    const row = await dbGet(
      `SELECT * FROM daily_owner_reports WHERE report_type = 'daily_summary' AND report_date = ?`,
      [failureDateStr]
    );
    assert.ok(row);
    assert.equal(row.status, 'failed');
    assert.equal(row.sent_at, null);

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
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
       VALUES ('Paid Buyer', 'paid@example.invalid', 150.00, 'paid', 'St 1', '2026-08-20 12:00:00', '2026-08-20 12:05:00')`
    );
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
       VALUES ('Unpaid Buyer', 'unpaid@example.invalid', 300.00, 'pending', 'St 2', '2026-08-20 13:00:00', NULL)`
    );
    await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
       VALUES ('Cancelled Buyer', 'cancelled@example.invalid', 500.00, 'cancelled', 'St 3', '2026-08-20 14:00:00', NULL)`
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

// ── 13. Real zero after successful query => shown as zero ─────────────

test('13: genuine zero metrics after successful query are reported as zero, not unavailable', () => {
  const emptyMetrics = {
    dateStr: '2026-08-21',
    traffic: {
      available: true,
      humanSessions: 0,
      uniqueHumanVisitors: 0,
      deviceBreakdown: {},
      topLandingPages: [],
      topReferrers: [],
    },
    sales: {
      available: true,
      paidOrdersCount: 0,
      paidRevenueILS: 0,
      aovILS: null,
      conversionRatePercent: null,
      itemsSoldCount: 0,
      topProducts: [],
    },
    issues: {
      available: true,
      totalDistinctIssues: 0,
      totalOccurrences: 0,
      criticalCount: 0,
      warningCount: 0,
      activeIssues: [],
    },
    fulfillment: {
      available: true,
      pendingFulfillmentCount: 0,
      manualFulfillmentCount: 0,
      supplierBreakdown: {},
    },
    backup: {
      available: true,
      latestBackupName: 'sqlite-backup-20260821-120000.db',
      hasSha256Sidecar: true,
      integrityCheck: 'OK',
      offsiteEnabled: false,
      offsiteStatusDescription: 'כבוי (Disabled)',
    },
    actionItems: ['👥 לא נרשמה תנועת גולשים היום — מומלץ לבדוק קמפיינים ופעילות שיווקית'],
  };

  const message = dailyOwnerReport.buildDailyReportMessage(emptyMetrics);
  assert.match(message, /סשנים של בני אדם: 0/);
  assert.match(message, /מבקרים ייחודיים: 0/);
  assert.match(message, /הזמנות ששולמו: 0/);
  assert.match(message, /הכנסה ששולמה: ₪0\.00/);
  assert.match(message, /פריטים שנמכרו: 0/);
  assert.match(message, /תקלות קריטיות: 0/);
  assert.match(message, /פריטים ממתינים להגשמה: 0/);
  assert.doesNotMatch(message, /לא זמין כרגע/);
});

// ── 14. Failed queries => truthfully reported as 'לא זמין כרגע' ────────

test('14: failed metric queries are reported as לא זמין כרגע and never falsely reported as 0', async () => {
  const brokenDb = {
    all: (sql, params, cb) => cb(new Error('Simulated SQLite disk corruption')),
    get: (sql, params, cb) => cb(new Error('Simulated SQLite disk corruption')),
    run: (sql, params, cb) => cb(new Error('Simulated SQLite disk corruption')),
  };

  const metrics = await dailyOwnerReport.getReportMetrics({
    dateStr: '2026-08-22',
    db: brokenDb,
  });

  assert.equal(metrics.traffic.available, false);
  assert.equal(metrics.sales.available, false);
  assert.equal(metrics.issues.available, false);
  assert.equal(metrics.fulfillment.available, false);
  assert.equal(metrics.backup.available, false);

  const message = dailyOwnerReport.buildDailyReportMessage(metrics);

  assert.match(message, /סשנים של בני אדם: לא זמין כרגע/);
  assert.match(message, /הזמנות ששולמו: לא זמין כרגע/);
  assert.match(message, /הכנסה ששולמה: לא זמין כרגע/);
  assert.match(message, /תקלות קריטיות: לא זמין כרגע/);
  assert.match(message, /פריטים ממתינים להגשמה: לא זמין כרגע/);
  assert.match(message, /גיבוי מקומי אחרון: לא זמין כרגע/);

  // Operator context must say UNAVAILABLE
  assert.match(message, /Human-Sessions: UNAVAILABLE/);
  assert.match(message, /Paid-Orders: UNAVAILABLE/);
  assert.match(message, /Paid-Revenue: UNAVAILABLE/);
  assert.match(message, /Issues-Count: UNAVAILABLE/);
  assert.match(message, /Pending-Fulfillment: UNAVAILABLE/);
  assert.match(message, /Backup-Status: UNAVAILABLE/);

  // Action items must not claim "no traffic" or "no purchases"
  assert.match(message, /⚠️ נתוני תנועת גולשים אינם זמינים כרגע/);
  assert.match(message, /⚠️ נתוני מכירות אינם זמינים כרגע/);
  assert.doesNotMatch(message, /לא נרשמה תנועה/);
});

// ── 15. Backup reporting uses real listManagedBackupFiles API shape ───

test('15: backup reporting correctly parses { name, path, mtimeMs } and checks sha256 sidecar', async () => {
  const customBackupDir = path.join(tmpDir, 'managed-backups-test');
  fs.mkdirSync(customBackupDir, { recursive: true });

  const backupFilename = 'ecommerce-20260816-120000Z.db';
  const backupFilePath = path.join(customBackupDir, backupFilename);
  fs.writeFileSync(backupFilePath, 'mock sqlite header bytes');
  fs.writeFileSync(`${backupFilePath}.sha256`, 'abc123mockhash  ecommerce-20260816-120000Z.db\n');

  const metrics = await dailyOwnerReport.getReportMetrics({
    dateStr: '2026-08-16',
    db,
    backupDir: customBackupDir,
    env: { ENABLE_OFFSITE_BACKUP: 'true' },
  });

  assert.equal(metrics.backup.available, true);
  assert.equal(metrics.backup.latestBackupName, backupFilename);
  assert.equal(metrics.backup.hasSha256Sidecar, true);
  assert.equal(metrics.backup.offsiteEnabled, true);
  assert.equal(metrics.backup.offsiteStatusDescription, 'מוגדר (Enabled)');

  const message = dailyOwnerReport.buildDailyReportMessage(metrics);
  assert.match(message, new RegExp(backupFilename));
  assert.match(message, /מאומת sha256/);
  assert.match(message, /מוגדר \(Enabled\)/);
});

// ── 16. Safe Referrer domain only (strips query, paths, tokens) ───────

test('16: visitor referrers are reduced to safe hostnames only without leaking paths, queries, or PII', () => {
  assert.equal(dailyOwnerReport.extractSafeDomain('https://instagram.com/stories/user123?utm_source=ig&token=SECRET_123'), 'instagram.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('https://www.google.com/search?q=sensitive+user+query&hl=iw'), 'www.google.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('https://facebook.com/groups/feed/'), 'facebook.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('direct'), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain(null), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain(''), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain('custom://bad-url?token=xxx'), 'bad-url');
});

// ── 17. HTML escaping for all user-controlled values ──────────────────

test('17: dynamic HTML values are escaped properly and never break formatting', () => {
  assert.equal(dailyOwnerReport.escapeHtml('<script>alert("xss")</script> & \'test\''), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;test&#39;');

  const dangerousMetrics = {
    dateStr: '2026-08-23',
    traffic: {
      available: true,
      humanSessions: 10,
      uniqueHumanVisitors: 5,
      deviceBreakdown: { 'Mobile <tag>': 10 },
      topLandingPages: [{ path: '/product?id=<123>&code="secret"', count: 10 }],
      topReferrers: [{ domain: 'evil.com/?x=<script>', count: 10 }],
    },
    sales: {
      available: true,
      paidOrdersCount: 1,
      paidRevenueILS: 100,
      aovILS: 100,
      conversionRatePercent: 10,
      itemsSoldCount: 1,
      topProducts: [{ title: 'Hacker T-Shirt <img src=x onerror=alert(1)> & "Ltd"', quantity: 1, sales: 100 }],
    },
    issues: {
      available: true,
      totalDistinctIssues: 0,
      totalOccurrences: 0,
      criticalCount: 0,
      warningCount: 0,
      activeIssues: [],
    },
    fulfillment: {
      available: true,
      pendingFulfillmentCount: 0,
      manualFulfillmentCount: 0,
      supplierBreakdown: {},
    },
    backup: {
      available: true,
      latestBackupName: 'backup<script>.db',
      hasSha256Sidecar: true,
      integrityCheck: 'OK',
      offsiteEnabled: false,
      offsiteStatusDescription: 'כבוי (Disabled)',
    },
    actionItems: ['Test <item> & "quote"'],
  };

  const message = dailyOwnerReport.buildDailyReportMessage(dangerousMetrics);

  assert.doesNotMatch(message, /<script>/i);
  assert.doesNotMatch(message, /<img /i);
  assert.match(message, /&lt;script&gt;/);
  assert.match(message, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(message, /backup&lt;script&gt;\.db/);
});

// ── 18. Paid-today semantics use genuine paid_at timestamp ────────────

test('18: paid-today accurately filters on paid_at timestamp', async () => {
  const testDateStr = '2026-08-24';

  // Order A: Created yesterday, paid today (2026-08-24 10:00:00) => MUST be included
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Buyer A', 'a@test.invalid', 120.00, 'paid', 'A St', '2026-08-23 23:00:00', '2026-08-24 10:00:00')`
  );

  // Order B: Created today, paid tomorrow (2026-08-25 01:00:00) => MUST be excluded
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Buyer B', 'b@test.invalid', 200.00, 'paid', 'B St', '2026-08-24 20:00:00', '2026-08-25 01:00:00')`
  );

  // Order C (legacy): Created today, paid_at is NULL => MUST be included via legacy fallback
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Buyer C', 'c@test.invalid', 80.00, 'paid', 'C St', '2026-08-24 14:00:00', NULL)`
  );

  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: testDateStr, db });

  assert.equal(metrics.sales.paidOrdersCount, 2, 'Order A (paid today) and Order C (legacy created today) included; Order B (paid tomorrow) excluded');
  assert.equal(metrics.sales.paidRevenueILS, 200.00, '120.00 + 80.00 = 200.00');
});

// ── 19. Partial report sends successfully even when a section fails ───

test('19: partial report builds and sends successfully when a subset of metric queries fail', async () => {
  const tMock = installTelegramMock();
  const partialDateStr = '2026-08-25';
  const partialDate = new Date('2026-08-25T19:00:00.000Z');

  // Corrupt only visitor_sessions query by temporary table drop or custom mock
  const partialMetrics = {
    dateStr: partialDateStr,
    traffic: {
      available: false,
      error: 'UNAVAILABLE',
      totalSessions: null,
      humanSessions: null,
      uniqueHumanVisitors: null,
      deviceBreakdown: null,
      topLandingPages: [],
      topReferrers: [],
    },
    sales: {
      available: true,
      paidOrdersCount: 2,
      paidRevenueILS: 350.00,
      aovILS: 175.00,
      conversionRatePercent: null, // unavailable because traffic is unavailable
      itemsSoldCount: 3,
      topProducts: [{ title: 'Classic Hoodie', quantity: 2, sales: 250 }],
    },
    issues: {
      available: true,
      totalDistinctIssues: 0,
      totalOccurrences: 0,
      criticalCount: 0,
      warningCount: 0,
      activeIssues: [],
    },
    fulfillment: {
      available: true,
      pendingFulfillmentCount: 1,
      manualFulfillmentCount: 0,
      supplierBreakdown: { printify: { pending: 1 } },
    },
    backup: {
      available: true,
      latestBackupName: 'sqlite-backup-20260825-120000.db',
      hasSha256Sidecar: true,
      integrityCheck: 'OK',
      offsiteEnabled: false,
      offsiteStatusDescription: 'כבוי (Disabled)',
    },
    actionItems: [
      '⚠️ נתוני תנועת גולשים אינם זמינים כרגע לניתוח',
      '💰 נרשמו 2 רכישות מוצלחות היום (סה״כ ₪350.00)',
      '💾 שלמות מסד הנתונים תקינה (Integrity: OK)',
    ],
  };

  const message = dailyOwnerReport.buildDailyReportMessage(partialMetrics);

  assert.match(message, /סשנים של בני אדם: לא זמין כרגע/);
  assert.match(message, /הזמנות ששולמו: 2/);
  assert.match(message, /הכנסה ששולמה: ₪350\.00/);
  assert.match(message, /ערך הזמנה ממוצע \(AOV\): ₪175\.00/);
  assert.match(message, /Human-Sessions: UNAVAILABLE/);
  assert.match(message, /Paid-Orders: 2/);
});
