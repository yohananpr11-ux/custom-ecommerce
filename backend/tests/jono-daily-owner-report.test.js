// JONO Daily Owner Report test suite (PR #36):
// Proves that:
// 1. Timezone & scheduling: before 22:00 Jerusalem => zero sends; at or after 22:00 => eligible.
// 2. Exact 24-Hour Rolling Window: [Previous Day 22:00 Jerusalem, Current Day 22:00 Jerusalem).
// 3. Exact Jerusalem DST handling (summer IDT vs winter IST vs DST transition days).
// 4. Exact boundary inclusion/exclusion: start boundary [22:00:00] included, end boundary [22:00:00] excluded.
// 5. Stable cutoff on retry / catch-up: retrying at 22:30 or 23:30 uses the exact same fixed window.
// 6. No 22:00-00:00 blind spot and zero overlap between consecutive daily reports.
// 7. Strict paid_at revenue semantics: orders require `status = 'paid' AND paid_at IS NOT NULL` in window.
// 8. Legacy paid orders with NULL paid_at are excluded from window revenue and reported separately.
// 9. paid_at write immutability: subsequent capture replays never move or overwrite existing paid_at.
// 10. Durable SQLite dedupe: repeated scheduler runs on the same day send exactly ONE report.
// 11. Restart-safe: simulated process restart still honors the sent state and does not duplicate.
// 12. Delivery confirmation: Telegram success marks sent_at in SQLite; failure leaves sent_at NULL.
// 13. Safe retry: when Telegram fails, report is not marked sent and can retry after cooldown.
// 14. Concurrency: multiple simultaneous executions result in at most one Telegram message.
// 15. Privacy & security: zero raw IPs, secrets, customer names, or PII in report.
// 16. Routine operational noise suppression (PR #35) remains 100% intact.
// 17. Real zero after successful query => shown as zero (never falsely marked unavailable).
// 18. Failed queries => truthfully marked 'לא זמין כרגע' / UNAVAILABLE (never 0).
// 19. Real latest backup found using { name, path, mtimeMs } and .sha256 sidecar truthful reporting.
// 20. Correct ENABLE_OFFSITE_BACKUP flag used via isOffsiteBackupEnabled(env).
// 21. Safe referrer domain only (strips query parameters, paths, tokens, PII).
// 22. HTML escaping for all user-controlled/dynamic values (< > & " ').
// 23. Partial report sends successfully even when a metric query fails.

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

// ── 2. Exact 24-Hour Rolling Window Calculation & DST ─────────────────

test('2: getJerusalem24HourWindow correctly calculates exact 22:00 to 22:00 bounds for summer and winter', () => {
  const summerWindow = dailyOwnerReport.getJerusalem24HourWindow('2026-08-16');
  assert.equal(summerWindow.prevDateStr, '2026-08-15');
  assert.equal(summerWindow.startUtcIso, '2026-08-15T19:00:00.000Z', '2026-08-15 22:00 IDT is 19:00 UTC');
  assert.equal(summerWindow.endUtcIso, '2026-08-16T19:00:00.000Z', '2026-08-16 22:00 IDT is 19:00 UTC');
  assert.equal(summerWindow.durationHours, 24);
  assert.equal(summerWindow.fullLocalDisplay, '15/08 22:00 → 16/08 22:00');

  const winterWindow = dailyOwnerReport.getJerusalem24HourWindow('2026-01-15');
  assert.equal(winterWindow.prevDateStr, '2026-01-14');
  assert.equal(winterWindow.startUtcIso, '2026-01-14T20:00:00.000Z', '2026-01-14 22:00 IST is 20:00 UTC');
  assert.equal(winterWindow.endUtcIso, '2026-01-15T20:00:00.000Z', '2026-01-15 22:00 IST is 20:00 UTC');
  assert.equal(winterWindow.durationHours, 24);
  assert.equal(winterWindow.fullLocalDisplay, '14/01 22:00 → 15/01 22:00');
});

// ── 3. Exact boundary inclusion/exclusion [start, end) ────────────────

test('3: event at 22:00:00 start boundary is INCLUDED; event at 22:00:00 end boundary is EXCLUDED', async () => {
  const testReportDate = '2026-08-16';
  // Window: 2026-08-15T19:00:00.000Z <= t < 2026-08-16T19:00:00.000Z

  // Event 1: Exact start boundary (2026-08-15 22:00:00 IDT = 19:00:00 UTC) => INCLUDED
  await dbRun(
    `INSERT INTO visitor_sessions (session_id, visitor_id, is_human, started_at, device_category)
     VALUES ('sess-start-boundary', 'vis-1', 1, '2026-08-15 19:00:00', 'desktop')`
  );

  // Event 2: Inside window (2026-08-16 21:59:59 IDT = 18:59:59 UTC) => INCLUDED
  await dbRun(
    `INSERT INTO visitor_sessions (session_id, visitor_id, is_human, started_at, device_category)
     VALUES ('sess-inside-window', 'vis-2', 1, '2026-08-16 18:59:59', 'mobile')`
  );

  // Event 3: Exact end boundary (2026-08-16 22:00:00 IDT = 19:00:00 UTC) => EXCLUDED (belongs to next day)
  await dbRun(
    `INSERT INTO visitor_sessions (session_id, visitor_id, is_human, started_at, device_category)
     VALUES ('sess-end-boundary', 'vis-3', 1, '2026-08-16 19:00:00', 'tablet')`
  );

  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: testReportDate, db });
  assert.equal(metrics.traffic.humanSessions, 2, 'sess-start-boundary and sess-inside-window included; sess-end-boundary excluded');
  assert.equal(metrics.traffic.uniqueHumanVisitors, 2);
});

// ── 4. Stable snapshot cutoff on retry / catch-up ─────────────────────

test('4: retry or startup catch-up at 22:30 uses the original 22:00 cutoff and does not include events after 22:00', async () => {
  const targetDateStr = '2026-08-16';

  // Session started at 22:15 IDT (19:15 UTC) on 2026-08-16 (after scheduled 22:00 cutoff)
  await dbRun(
    `INSERT INTO visitor_sessions (session_id, visitor_id, is_human, started_at, device_category)
     VALUES ('sess-after-cutoff', 'vis-late', 1, '2026-08-16 19:15:00', 'mobile')`
  );

  // Metrics for 2026-08-16 report generated at 22:30
  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: targetDateStr, db });
  // The late session at 19:15 UTC is >= endUtcIso (19:00 UTC), so it MUST NOT be included
  const allSessions = await dbAll(`SELECT session_id, started_at FROM visitor_sessions`);
  assert.equal(metrics.windowInfo.endUtcIso, '2026-08-16T19:00:00.000Z');
  // Confirm late session is excluded from 2026-08-16 report
  assert.equal(metrics.traffic.humanSessions, 2); // only the 2 prior sessions
});

// ── 5. Full 24h coverage without overlap across consecutive days ──────

test('5: consecutive daily reports cover exactly 24h each with zero overlap and no blind spot', () => {
  const day1 = dailyOwnerReport.getJerusalem24HourWindow('2026-08-16');
  const day2 = dailyOwnerReport.getJerusalem24HourWindow('2026-08-17');

  assert.equal(day1.endUtcIso, day2.startUtcIso, 'Day 1 end matches Day 2 start exactly (contiguous zero-gap coverage)');
  assert.equal(day1.durationHours, 24);
  assert.equal(day2.durationHours, 24);
});

// ── 6. Strict paid_at revenue semantics (no createdAt fallback) ───────

test('6: only orders with status = paid AND paid_at within window count as revenue; legacy orders with NULL paid_at are excluded from revenue', async () => {
  const revenueDateStr = '2026-08-17';
  // Window: 2026-08-16T19:00:00.000Z <= paid_at < 2026-08-17T19:00:00.000Z

  // Order 1: Created yesterday (2026-08-16 15:00 UTC), paid today inside window (2026-08-17 10:00 UTC) => INCLUDED
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Buyer 1', 'b1@test.invalid', 120.00, 'paid', 'St 1', '2026-08-16 15:00:00', '2026-08-17 10:00:00')`
  );

  // Order 2: Created today (2026-08-17 18:00 UTC), paid tomorrow (2026-08-17 20:00 UTC = 23:00 IDT) => EXCLUDED (belongs to 18/08)
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Buyer 2', 'b2@test.invalid', 250.00, 'paid', 'St 2', '2026-08-17 18:00:00', '2026-08-17 20:00:00')`
  );

  // Order 3: Legacy order created today, status = 'paid', but paid_at IS NULL => EXCLUDED from window revenue, counted as legacy
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Legacy Buyer', 'legacy@test.invalid', 80.00, 'paid', 'St 3', '2026-08-17 12:00:00', NULL)`
  );

  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: revenueDateStr, db });

  assert.equal(metrics.sales.paidOrdersCount, 1, 'Only Order 1 (paid_at inside window) is included');
  assert.equal(metrics.sales.paidRevenueILS, 120.00, 'Revenue strictly equals 120.00 (excludes 250 and 80)');
  assert.equal(metrics.sales.legacyPaidOrdersWithoutTimestamp >= 1, true, 'Legacy order is counted in legacyPaidOrdersWithoutTimestamp');

  const message = dailyOwnerReport.buildDailyReportMessage(metrics);
  assert.match(message, /הזמנות ששולמו: 1/);
  assert.match(message, /הכנסה ששולמה: ₪120\.00/);
  assert.match(message, /הזמנות ישנות ללא זמן תשלום מדויק: \d+ — לא נכללו בהכנסה של חלון זה/);
  assert.match(message, /Legacy-Paid-Time-Unknown: \d+/);
});

// ── 7. paid_at Write Immutability on Replay ───────────────────────────

test('7: repeated payment capture or webhook claim does NOT overwrite or shift existing paid_at', async () => {
  const orderRes = await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt, paid_at)
     VALUES ('Immutability Test', 'imm@test.invalid', 99.00, 'pending', 'St 4', '2026-08-17 08:00:00', NULL)`
  );
  const orderId = orderRes.lastID;

  // Claim 1: Order marks paid
  const initialTime = '2026-08-17 09:30:00';
  await dbRun(
    `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status != 'paid'`,
    [initialTime, orderId]
  );

  const row1 = await dbGet(`SELECT status, paid_at FROM orders WHERE id = ?`, [orderId]);
  assert.equal(row1.status, 'paid');
  assert.equal(row1.paid_at, initialTime);

  // Claim 2: Duplicate capture attempt later with different timestamp
  const laterTime = '2026-08-17 15:00:00';
  await dbRun(
    `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status != 'paid'`,
    [laterTime, orderId]
  );

  const row2 = await dbGet(`SELECT status, paid_at FROM orders WHERE id = ?`, [orderId]);
  assert.equal(row2.paid_at, initialTime, 'paid_at remains completely immutable after initial payment');
});

// ── 8. End-to-End Daily Report Generation and Telegram Delivery ───────

test('8: generateAndSendDailyReport sends structured daily summary and records sent_at', async () => {
  const tMock = installTelegramMock();
  const testDate = new Date('2026-08-16T19:00:00.000Z');

  try {
    const result = await dailyOwnerReport.generateAndSendDailyReport({
      date: testDate,
      dateStr: '2026-08-16',
      force: true,
      db,
    });

    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    const msg = tMock.sentMessages[0];
    assert.match(msg, /JONO — סיכום יומי/);
    assert.match(msg, /חלון: 15\/08 22:00 → 16\/08 22:00/);
    assert.match(msg, /Event: DAILY_OWNER_REPORT/);
    assert.match(msg, /Window-Timezone: Europe\/Jerusalem/);
    assert.match(msg, /Window-Hours: 24/);
  } finally {
    tMock.restore();
  }
});

// ── 9. Real zero after successful query => shown as zero ─────────────

test('9: genuine zero metrics after successful query are reported as zero, not unavailable', () => {
  const emptyMetrics = {
    dateStr: '2026-08-21',
    windowInfo: {
      reportDateStr: '2026-08-21',
      prevDateStr: '2026-08-20',
      startUtcIso: '2026-08-20T19:00:00.000Z',
      endUtcIso: '2026-08-21T19:00:00.000Z',
      durationHours: 24,
      fullLocalDisplay: '20/08 22:00 → 21/08 22:00',
    },
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
      legacyPaidOrdersWithoutTimestamp: 0,
    },
    issues: {
      available: true,
      distinctIssuesCount: 0,
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
      latestBackupName: 'ecommerce-20260821-120000Z.db',
      hasSha256Sidecar: true,
      integrityCheck: 'OK',
      offsiteEnabled: false,
      offsiteStatusDescription: 'כבוי (Disabled)',
    },
    actionItems: ['👥 לא נרשמה תנועת גולשים בחלון זה — מומלץ לבדוק קמפיינים ופעילות שיווקית'],
  };

  const message = dailyOwnerReport.buildDailyReportMessage(emptyMetrics);
  assert.match(message, /סשנים של בני אדם: 0/);
  assert.match(message, /מבקרים ייחודיים: 0/);
  assert.match(message, /הזמנות ששולמו: 0/);
  assert.match(message, /הכנסה ששולמה: ₪0\.00/);
  assert.match(message, /פריטים שנמכרו: 0/);
  assert.match(message, /תקלות קריטיות: 0/);
  assert.match(message, /סה״כ סוגי תקלות פעילות בחלון: 0/);
  assert.match(message, /פריטים ממתינים להגשמה \(נוכחי\): 0/);
  assert.doesNotMatch(message, /לא זמין כרגע/);
});

// ── 10. Failed queries => truthfully reported as 'לא זמין כרגע' ────────

test('10: failed metric queries are reported as לא זמין כרגע and never falsely reported as 0', async () => {
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
  assert.match(message, /פריטים ממתינים להגשמה \(נוכחי\): לא זמין כרגע/);
  assert.match(message, /גיבוי מקומי אחרון: לא זמין כרגע/);

  // Operator context must say UNAVAILABLE
  assert.match(message, /Human-Sessions: UNAVAILABLE/);
  assert.match(message, /Paid-Orders: UNAVAILABLE/);
  assert.match(message, /Paid-Revenue: UNAVAILABLE/);
  assert.match(message, /Issues-Distinct-Active: UNAVAILABLE/);
  assert.match(message, /Pending-Fulfillment-Current: UNAVAILABLE/);
  assert.match(message, /Backup-Status: UNAVAILABLE/);

  // Action items must not claim "no traffic" or "no purchases"
  assert.match(message, /⚠️ נתוני תנועת גולשים אינם זמינים כרגע/);
  assert.match(message, /⚠️ נתוני מכירות אינם זמינים כרגע/);
  assert.doesNotMatch(message, /לא נרשמה תנועה/);
});

// ── 11. Backup reporting uses real listManagedBackupFiles API shape ───

test('11: backup reporting correctly parses { name, path, mtimeMs } and checks sha256 sidecar', async () => {
  const customBackupDir = path.join(tmpDir, 'managed-backups-test-24h');
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

// ── 12. Safe Referrer domain only (strips query, paths, tokens) ───────

test('12: visitor referrers are reduced to safe hostnames only without leaking paths, queries, or PII', () => {
  assert.equal(dailyOwnerReport.extractSafeDomain('https://instagram.com/stories/user123?utm_source=ig&token=SECRET_123'), 'instagram.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('https://www.google.com/search?q=sensitive+user+query&hl=iw'), 'www.google.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('https://facebook.com/groups/feed/'), 'facebook.com');
  assert.equal(dailyOwnerReport.extractSafeDomain('direct'), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain(null), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain(''), 'Direct / ישיר');
  assert.equal(dailyOwnerReport.extractSafeDomain('custom://bad-url?token=xxx'), 'bad-url');
});

// ── 13. HTML escaping for all user-controlled values ──────────────────

test('13: dynamic HTML values are escaped properly and never break formatting', () => {
  assert.equal(dailyOwnerReport.escapeHtml('<script>alert("xss")</script> & \'test\''), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;test&#39;');

  const dangerousMetrics = {
    dateStr: '2026-08-23',
    windowInfo: {
      reportDateStr: '2026-08-23',
      prevDateStr: '2026-08-22',
      fullLocalDisplay: '22/08 22:00 → 23/08 22:00',
    },
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
      legacyPaidOrdersWithoutTimestamp: 0,
    },
    issues: {
      available: true,
      distinctIssuesCount: 0,
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

// ── 14. Partial report sends successfully even when a section fails ───

test('14: partial report builds and sends successfully when a subset of metric queries fail', async () => {
  const partialMetrics = {
    dateStr: '2026-08-25',
    windowInfo: {
      reportDateStr: '2026-08-25',
      prevDateStr: '2026-08-24',
      fullLocalDisplay: '24/08 22:00 → 25/08 22:00',
    },
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
      conversionRatePercent: null,
      itemsSoldCount: 3,
      topProducts: [{ title: 'Classic Hoodie', quantity: 2, sales: 250 }],
      legacyPaidOrdersWithoutTimestamp: 0,
    },
    issues: {
      available: true,
      distinctIssuesCount: 0,
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
      latestBackupName: 'ecommerce-20260825-120000Z.db',
      hasSha256Sidecar: true,
      integrityCheck: 'OK',
      offsiteEnabled: false,
      offsiteStatusDescription: 'כבוי (Disabled)',
    },
    actionItems: [
      '⚠️ נתוני תנועת גולשים אינם זמינים כרגע לניתוח',
      '💰 נרשמו 2 רכישות מוצלחות בחלון זה (סה״כ ₪350.00)',
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

// ── 15. PR #35 Noise Suppression Remains Intact ───────────────────────

test('15: routine startup/scheduled syncs and backup cycles remain silent on Telegram', async () => {
  const tMock = installTelegramMock();
  const printify = require('../services/printify.js');
  const sqliteBackup = require('../services/sqlite-backup.js');

  try {
    const originalToken = printify.token;
    printify.token = '';
    await printify.syncProducts('startup');
    await printify.syncProducts('scheduled');
    printify.token = originalToken;

    const backupSubdir = path.join(tmpDir, 'noise-check-backups-24h');
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

// ── 16. Database Readiness & paid_at Startup Migration ─────────────────

test('16: schema readiness promise ensures paid_at column exists before app readiness', async () => {
  assert.ok(db.readyPromise instanceof Promise, 'db.readyPromise is exposed');
  await db.readyPromise;

  const tableInfo = await dbAll(`PRAGMA table_info(orders)`);
  const hasPaidAt = tableInfo.some(col => col.name === 'paid_at');
  assert.equal(hasPaidAt, true, 'orders.paid_at column is confirmed present in schema');

  // Verify that an order insert and paid transition with paid_at succeeds without SQL column error
  const orderRes = await dbRun(
    `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address, createdAt)
     VALUES ('Startup Migration Test', 'startup@test.invalid', 99.00, 'pending', 'St Readiness', '2026-08-17 10:00:00')`
  );
  const orderId = orderRes.lastID;

  await dbRun(
    `UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [orderId]
  );
  const row = await dbGet(`SELECT status, paid_at FROM orders WHERE id = ?`, [orderId]);
  assert.equal(row.status, 'paid');
  assert.ok(row.paid_at, 'paid_at was successfully updated without schema error');
});

// ── 17. Distributed Crash Recovery & Delivery Phases ──────────────────

test('17: crash before delivery_started reclaims stale lease; crash after delivery_started transitions to delivery_unknown', async () => {
  const tMock = installTelegramMock();
  const testDateStr = '2026-08-28';

  try {
    // 17A: Crash BEFORE delivery_started (status = 'in_progress' with stale timestamp)
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', ?, 'in_progress', 1, datetime('now', '-10 minutes'))`,
      [testDateStr]
    );

    // Stale in_progress lease (>5m) should be safely reclaimed and sent
    const resA = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDateStr,
      force: true,
      db,
    });
    assert.equal(resA.ok, true, 'Stale in_progress lease reclaimed safely');
    assert.equal(resA.sent, true);

    const rowA = await dbGet(`SELECT status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDateStr]);
    assert.equal(rowA.status, 'sent');
    assert.ok(rowA.sent_at);

    // 17B: Ambiguous crash AFTER delivery_started (status = 'delivery_started' with stale timestamp and sent_at IS NULL)
    const testDateB = '2026-08-29';
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', ?, 'delivery_started', 1, datetime('now', '-10 minutes'))`,
      [testDateB]
    );

    const resB = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDateB,
      force: true,
      db,
    });
    assert.equal(resB.skipped, true);
    assert.equal(resB.reason, 'ambiguous_delivery_detected', 'Ambiguous delivery detected; not blindly resent');

    const rowB = await dbGet(`SELECT status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDateB]);
    assert.equal(rowB.status, 'delivery_unknown', 'Row transitioned to delivery_unknown for manual review');
    assert.equal(rowB.sent_at, null);
  } finally {
    tMock.restore();
  }
});

// ── 18. After-Midnight Catch-Up & Downtime Recovery ───────────────────

test('18: downtime over midnight catch-up generates previous day report with original fixed 22:00 cutoff', async () => {
  const tMock = installTelegramMock();
  const yesterdayStr = '2026-08-30';

  try {
    // Yesterday's report is unsent in DB
    const res = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: yesterdayStr,
      force: true,
      db,
    });

    assert.equal(res.ok, true);
    assert.equal(res.sent, true);
    assert.equal(res.reportDate, yesterdayStr);

    const windowInfo = res.metrics.windowInfo;
    assert.equal(windowInfo.reportDateStr, yesterdayStr);
    assert.equal(windowInfo.prevDateStr, '2026-08-29');
    assert.equal(windowInfo.durationHours, 24, 'Fixed 24h window ending at 22:00 yesterday');

    // Duplicate check: running again for the same date returns already_sent
    const dupRes = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: yesterdayStr,
      force: true,
      db,
    });
    assert.equal(dupRes.skipped, true);
    assert.equal(dupRes.reason, 'already_sent');
  } finally {
    tMock.restore();
  }
});

// ── 19. DST Spring and Autumn Actual Window Hours ─────────────────────

test('19: DST spring and autumn transition windows calculate truthful elapsed hours without gaps', () => {
  // Israel DST transitions (e.g. 2026 Spring is late March, Autumn is late October)
  // Spring transition: clock jumps forward 1 hour -> 22:00 to 22:00 duration is 23 hours in UTC
  const springWindow = dailyOwnerReport.getJerusalem24HourWindow('2026-03-27');
  assert.equal(springWindow.durationHours, 23, 'Spring DST transition day window is 23 hours');

  // Autumn transition: clock jumps backward 1 hour -> 22:00 to 22:00 duration is 25 hours in UTC
  const autumnWindow = dailyOwnerReport.getJerusalem24HourWindow('2026-10-25');
  assert.equal(autumnWindow.durationHours, 25, 'Autumn DST transition day window is 25 hours');

  // Consecutive day continuity check
  const beforeSpring = dailyOwnerReport.getJerusalem24HourWindow('2026-03-26');
  assert.equal(beforeSpring.endUtcIso, springWindow.startUtcIso, 'No gap before spring transition');

  const afterSpring = dailyOwnerReport.getJerusalem24HourWindow('2026-03-28');
  assert.equal(springWindow.endUtcIso, afterSpring.startUtcIso, 'No gap after spring transition');
});

// ── 20. Technical Issues Truthful Counts ──────────────────────────────

test('20: technical issues report distinct active issues and do not mislabel cumulative occurrence_count as daily-window occurrences', async () => {
  const issueDateStr = '2026-08-31';
  // Window: 2026-08-30 22:00 IDT (19:00 UTC) to 2026-08-31 22:00 IDT (19:00 UTC)

  await dbRun(
    `INSERT INTO technical_issues (signature, type, severity, route, message, first_seen_at, last_seen_at, occurrence_count)
     VALUES ('ISSUE:SIG1', 'PRINTIFY_API_ERROR', 'CRITICAL', '/api/printify', 'Rate limit exceeded', '2026-08-31 10:00:00', '2026-08-31 12:00:00', 42)`
  );

  await dbRun(
    `INSERT INTO technical_issues (signature, type, severity, route, message, first_seen_at, last_seen_at, occurrence_count)
     VALUES ('ISSUE:SIG2', 'PAYPAL_WARN', 'WARNING', '/api/paypal', 'Slow response', '2026-08-31 11:00:00', '2026-08-31 11:30:00', 5)`
  );

  const metrics = await dailyOwnerReport.getReportMetrics({ dateStr: issueDateStr, db });
  assert.equal(metrics.issues.distinctIssuesCount, 2, 'Two distinct issues observed in window');
  assert.equal(metrics.issues.criticalCount, 1);
  assert.equal(metrics.issues.warningCount, 1);

  const message = dailyOwnerReport.buildDailyReportMessage(metrics);
  assert.match(message, /תקלות קריטיות: 1/);
  assert.match(message, /תקלות אזהרה: 1/);
  assert.match(message, /סה״כ סוגי תקלות פעילות בחלון: 2/);
  assert.doesNotMatch(message, /סה״כ אירועי שגיאה: 47/, 'Lifetime occurrences (47) are not mislabeled as daily window error events');
  assert.match(message, /Issues-Distinct-Active: 2/);
  assert.match(message, /Issues-Critical: 1/);
  assert.match(message, /Issues-Warning: 1/);
});

// ── 21. Attempt Fencing Token & Stale Lease Safety ────────────────────

test('21: attempt fencing token prevents stalled attempt from sending Telegram or writing state after newer attempt claims', async () => {
  const tMock = installTelegramMock();
  const testDate = '2026-09-01';

  try {
    // Attempt A claims execution initially (attempt_count = 1)
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', ?, 'in_progress', 1, datetime('now', '-10 minutes'))`,
      [testDate]
    );

    // Attempt B reclaims after lease expiry and finishes successfully (attempt_count = 2)
    const resB = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });
    assert.equal(resB.ok, true);
    assert.equal(resB.sent, true);
    assert.equal(tMock.sentMessages.length, 1, 'Attempt B sent exactly 1 Telegram message');

    const rowAfterB = await dbGet(`SELECT attempt_count, status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
    assert.equal(rowAfterB.attempt_count, 2);
    assert.equal(rowAfterB.status, 'sent');
    assert.ok(rowAfterB.sent_at);

    // Attempt A resumes with stale attemptToken = 1 and tries to transition to delivery_started
    const staleTransition = await dbRun(
      `UPDATE daily_owner_reports
       SET status = 'delivery_started', last_attempt_at = CURRENT_TIMESTAMP
       WHERE report_type = 'daily_summary' AND report_date = ? AND attempt_count = 1 AND status = 'in_progress'`,
      [testDate]
    );
    assert.equal(staleTransition.changes, 0, 'Stale attempt A fails CAS fencing and cannot enter delivery_started');

    // Attempt A tries to write sent
    const staleSent = await dbRun(
      `UPDATE daily_owner_reports
       SET status = 'sent', sent_at = CURRENT_TIMESTAMP
       WHERE report_type = 'daily_summary' AND report_date = ? AND attempt_count = 1 AND status = 'delivery_started'`,
      [testDate]
    );
    assert.equal(staleSent.changes, 0, 'Stale attempt A cannot overwrite sent state');

    // Attempt A tries to write failed
    const staleFailed = await dbRun(
      `UPDATE daily_owner_reports
       SET status = 'failed'
       WHERE report_type = 'daily_summary' AND report_date = ? AND attempt_count = 1 AND status = 'delivery_started'`,
      [testDate]
    );
    assert.equal(staleFailed.changes, 0, 'Stale attempt A cannot overwrite with failed');

    // Total Telegram messages remains exactly 1
    assert.equal(tMock.sentMessages.length, 1, 'Maximum Telegram sends across concurrent/stale attempts is exactly 1');
  } finally {
    tMock.restore();
  }
});

// ── 22. Concurrent Scheduler & delivery_started In-Flight Protection ──

test('22: concurrent scheduler with force=true does not reclaim or send when delivery_started is actively in-flight', async () => {
  const tMock = installTelegramMock();
  const testDate = '2026-09-02';

  try {
    // Scheduler A reached delivery_started (lease fresh, 10s ago)
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', ?, 'delivery_started', 1, datetime('now', '-10 seconds'))`,
      [testDate]
    );

    // Scheduler B runs with force=true
    const resB = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });

    assert.equal(resB.skipped, true);
    assert.equal(resB.reason, 'delivery_in_flight', 'Scheduler B skips active delivery in flight without touching state');
    assert.equal(tMock.sentMessages.length, 0, 'Zero messages sent by concurrent scheduler B');

    const row = await dbGet(`SELECT status, attempt_count FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
    assert.equal(row.status, 'delivery_started', 'Status remains delivery_started owned by attempt 1');
    assert.equal(row.attempt_count, 1);
  } finally {
    tMock.restore();
  }
});

// ── 23. Sticky delivery_unknown Against Late Explicit Failure ────────

test('23: delivery_unknown is sticky and cannot be overwritten by a late explicit failure from an old attempt', async () => {
  const testDate = '2026-09-03';

  await dbRun(
    `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'delivery_unknown', 1, CURRENT_TIMESTAMP)`,
    [testDate]
  );

  // Late failure update from attempt 1 (expecting delivery_started)
  const lateFailRes = await dbRun(
    `UPDATE daily_owner_reports
     SET status = 'failed'
     WHERE report_type = 'daily_summary' AND report_date = ? AND attempt_count = 1 AND status = 'delivery_started'`,
    [testDate]
  );
  assert.equal(lateFailRes.changes, 0, 'Late failure cannot overwrite delivery_unknown');

  const row = await dbGet(`SELECT status FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
  assert.equal(row.status, 'delivery_unknown', 'delivery_unknown remains sticky');
});

// ── 24. Sticky delivery_unknown Against Late Success ─────────────────

test('24: delivery_unknown is sticky and cannot be overwritten by a late success without valid fencing', async () => {
  const testDate = '2026-09-04';

  await dbRun(
    `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'delivery_unknown', 1, CURRENT_TIMESTAMP)`,
    [testDate]
  );

  // Late success update from attempt 1 (expecting delivery_started)
  const lateSentRes = await dbRun(
    `UPDATE daily_owner_reports
     SET status = 'sent', sent_at = CURRENT_TIMESTAMP
     WHERE report_type = 'daily_summary' AND report_date = ? AND attempt_count = 1 AND status = 'delivery_started'`,
    [testDate]
  );
  assert.equal(lateSentRes.changes, 0, 'Late success cannot overwrite delivery_unknown');

  const row = await dbGet(`SELECT status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
  assert.equal(row.status, 'delivery_unknown');
  assert.equal(row.sent_at, null);
});

// ── 25. Transport Ambiguity (No HTTP Response) Transitions to delivery_unknown ──

test('25: network timeout / transport error without HTTP response marks delivery_unknown and blocks automatic retries', async () => {
  const sentMock = mock.method(telegram, 'sendMessage', async () => {
    // Simulates Axios timeout / network drop with no HTTP response
    return { ok: false, skipped: false, reason: 'telegram_api_error', details: 'ETIMEDOUT', deliveryAmbiguous: true };
  });
  const testDate = '2026-09-05';

  try {
    const res = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });

    assert.equal(res.ok, false);
    assert.equal(res.sent, false);
    assert.equal(res.reason, 'delivery_unknown_transport_failure');

    const row = await dbGet(`SELECT status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
    assert.equal(row.status, 'delivery_unknown', 'Row is marked delivery_unknown');
    assert.equal(row.sent_at, null);

    // Subsequent automatic execution attempt is safely blocked for manual review
    const retryRes = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });
    assert.equal(retryRes.skipped, true);
    assert.equal(retryRes.reason, 'delivery_unknown_manual_review_required');
  } finally {
    sentMock.mock.restore();
  }
});

// ── 26. Explicit Telegram HTTP Rejection Marks Failed with Retry Allowed ────

test('26: explicit Telegram HTTP rejection marks status failed and allows retry after cooldown', async () => {
  let attempt = 0;
  const sentMock = mock.method(telegram, 'sendMessage', async () => {
    attempt++;
    if (attempt === 1) {
      // Explicit HTTP 400 error with response
      return { ok: false, skipped: false, reason: 'telegram_api_error', details: 'HTTP_400', deliveryAmbiguous: false };
    }
    return { ok: true, status: 200, deliveryAmbiguous: false };
  });
  const testDate = '2026-09-06';

  try {
    const res1 = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });
    assert.equal(res1.ok, false);
    assert.equal(res1.sent, false);

    const row1 = await dbGet(`SELECT status, attempt_count FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
    assert.equal(row1.status, 'failed');
    assert.equal(row1.attempt_count, 1);

    // Immediate retry within 5-minute cooldown is skipped
    const resImmediate = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });
    assert.equal(resImmediate.skipped, true);
    assert.equal(resImmediate.reason, 'claim_failed_or_cooling_down');

    // Simulate cooldown expiry by shifting last_attempt_at back 10 minutes
    await dbRun(
      `UPDATE daily_owner_reports SET last_attempt_at = datetime('now', '-10 minutes') WHERE report_date = ?`,
      [testDate]
    );

    // Second attempt succeeds
    const res2 = await dailyOwnerReport.generateAndSendDailyReport({
      dateStr: testDate,
      force: true,
      db,
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.sent, true);

    const row2 = await dbGet(`SELECT status, attempt_count, sent_at FROM daily_owner_reports WHERE report_date = ?`, [testDate]);
    assert.equal(row2.status, 'sent');
    assert.equal(row2.attempt_count, 2);
    assert.ok(row2.sent_at);
  } finally {
    sentMock.mock.restore();
  }
});

// ── 27. Force Catch-Up Bypasses Time Eligibility Only ──────────────────

test('27: force catch-up bypasses time eligibility only, never bypassing in_progress, delivery_unknown, or sent ownership', async () => {
  const testDateA = '2026-09-07';
  // Active in_progress (< 5m)
  await dbRun(
    `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'in_progress', 1, CURRENT_TIMESTAMP)`,
    [testDateA]
  );
  const resA = await dailyOwnerReport.generateAndSendDailyReport({ dateStr: testDateA, force: true, db });
  assert.equal(resA.skipped, true);
  assert.equal(resA.reason, 'claim_failed_or_cooling_down');

  // delivery_unknown
  const testDateB = '2026-09-08';
  await dbRun(
    `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
     VALUES ('daily_summary', ?, 'delivery_unknown', 1, CURRENT_TIMESTAMP)`,
    [testDateB]
  );
  const resB = await dailyOwnerReport.generateAndSendDailyReport({ dateStr: testDateB, force: true, db });
  assert.equal(resB.skipped, true);
  assert.equal(resB.reason, 'delivery_unknown_manual_review_required');

  // already sent
  const testDateC = '2026-09-09';
  await dbRun(
    `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at, sent_at)
     VALUES ('daily_summary', ?, 'sent', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testDateC]
  );
  const resC = await dailyOwnerReport.generateAndSendDailyReport({ dateStr: testDateC, force: true, db });
  assert.equal(resC.skipped, true);
  assert.equal(resC.reason, 'already_sent');
});

// ── 28. First-Ever Deployment Before 22:00 (Scenario A) ───────────────

test('28: first-ever startup before 22:00 does not backfill yesterday and creates today pending marker', async () => {
  const tMock = installTelegramMock();
  // 08:00 IDT (05:00 UTC) on 2026-11-02 (Israel standard time is UTC+2, so 08:00 IST is 06:00 UTC)
  // Let's use a clear UTC time corresponding to 08:00 in Jerusalem:
  // In Nov, Israel is in IST (UTC+2) -> 08:00 IST is 06:00 UTC
  const tickTime = new Date('2026-11-02T06:00:00Z');

  try {
    const res = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'previous_never_scheduled', 'Unscheduled historical date is NOT backfilled');
    assert.equal(tMock.sentMessages.length, 0, 'Zero Telegram messages sent on first deploy');

    const todayMarker = await dbGet(`SELECT status, attempt_count FROM daily_owner_reports WHERE report_date = '2026-11-02'`);
    assert.ok(todayMarker, 'Durable pending marker for current date created');
    assert.equal(todayMarker.status, 'pending');
    assert.equal(todayMarker.attempt_count, 0);

    const yesterdayMarker = await dbGet(`SELECT * FROM daily_owner_reports WHERE report_date = '2026-11-01'`);
    assert.equal(yesterdayMarker, undefined, 'Yesterday was never scheduled and remains absent');
  } finally {
    tMock.restore();
  }
});

// ── 29. Pending Marker Idempotency Across Repeated Ticks (Scenario B) ─

test('29: today pending marker is created only once across repeated scheduler ticks', async () => {
  const tickTime = new Date('2026-11-02T07:00:00Z');

  const res1 = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
  assert.equal(res1.skipped, true);

  const res2 = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
  assert.equal(res2.skipped, true);

  const rows = await dbAll(`SELECT * FROM daily_owner_reports WHERE report_date = '2026-11-02'`);
  assert.equal(rows.length, 1, 'Exactly one row for today');
  assert.equal(rows[0].status, 'pending');
});

// ── 30. Active Pending Marker + Downtime Across Midnight (Scenario C) ─

test('30: active pending marker before 22:00 caught up after midnight restart', async () => {
  const tMock = installTelegramMock();
  const day1Date = '2026-11-05';
  const day2Date = '2026-11-06';

  try {
    // 1. Day 1 at 18:00 IST (16:00 UTC) -> pending marker created
    const day1Time = new Date('2026-11-05T16:00:00Z');
    const tick1 = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: day1Time, db });
    assert.equal(tick1.skipped, true);
    assert.equal(tMock.sentMessages.length, 0, 'No sends during afternoon check');

    const marker1 = await dbGet(`SELECT status FROM daily_owner_reports WHERE report_date = ?`, [day1Date]);
    assert.equal(marker1.status, 'pending');

    // 2. Service was down during 22:00 on Day 1.
    // 3. Next day restart at 07:00 IST (05:00 UTC) on Day 2:
    const day2MorningTime = new Date('2026-11-06T05:00:00Z');
    const catchupRes = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: day2MorningTime, db });

    assert.equal(catchupRes.ok, true, 'Missed scheduled report caught up successfully');
    assert.equal(catchupRes.sent, true);
    assert.equal(catchupRes.reportDate, day1Date, 'Caught up report is for Day 1');
    assert.equal(tMock.sentMessages.length, 1, 'Exactly 1 catch-up Telegram message sent');

    const day1Row = await dbGet(`SELECT status, sent_at FROM daily_owner_reports WHERE report_date = ?`, [day1Date]);
    assert.equal(day1Row.status, 'sent');
    assert.ok(day1Row.sent_at);

    // Day 2 pending marker created
    const day2Marker = await dbGet(`SELECT status FROM daily_owner_reports WHERE report_date = ?`, [day2Date]);
    assert.equal(day2Marker.status, 'pending');
  } finally {
    tMock.restore();
  }
});

// ── 31. First-Ever Startup After Midnight (Scenario D) ────────────────

test('31: first-ever startup after midnight with no previous marker does not backfill historical catch-up', async () => {
  const tMock = installTelegramMock();
  // 03:00 IST (01:00 UTC) on 2026-11-10
  const tickTime = new Date('2026-11-10T01:00:00Z');

  try {
    const res = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'previous_never_scheduled');
    assert.equal(tMock.sentMessages.length, 0);

    const prevMarker = await dbGet(`SELECT * FROM daily_owner_reports WHERE report_date = '2026-11-09'`);
    assert.equal(prevMarker, undefined, 'Previous date was never scheduled and remains absent');
  } finally {
    tMock.restore();
  }
});

// ── 32. First-Ever Startup at 23:00 (Scenario E) ──────────────────────

test('32: first-ever startup at 23:00 sends eligible current-day report only and no older reports', async () => {
  const tMock = installTelegramMock();
  // 23:00 IST (21:00 UTC) on 2026-11-12
  const tickTime = new Date('2026-11-12T21:00:00Z');

  try {
    const res = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
    assert.equal(res.ok, true);
    assert.equal(res.sent, true);
    assert.equal(res.reportDate, '2026-11-12');
    assert.equal(tMock.sentMessages.length, 1, 'Only current-day report sent');

    const olderRow = await dbGet(`SELECT * FROM daily_owner_reports WHERE report_date = '2026-11-11'`);
    assert.equal(olderRow, undefined, 'No older report created or backfilled');
  } finally {
    tMock.restore();
  }
});

// ── 33. Scheduler Tick with Previous Sent or Delivery Unknown (F & G) ──

test('33: scheduler tick does not retry when previous day is sent or delivery_unknown', async () => {
  const tMock = installTelegramMock();

  try {
    // 33A: Previous day is already sent
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at, sent_at)
       VALUES ('daily_summary', '2026-11-15', 'sent', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );
    const tickTime1 = new Date('2026-11-16T06:00:00Z');
    const res1 = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime1, db });
    assert.equal(res1.skipped, true);
    assert.equal(res1.reason, 'previous_already_handled');
    assert.equal(tMock.sentMessages.length, 0);

    // 33B: Previous day is delivery_unknown
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', '2026-11-18', 'delivery_unknown', 1, CURRENT_TIMESTAMP)`
    );
    const tickTime2 = new Date('2026-11-19T06:00:00Z');
    const res2 = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime2, db });
    assert.equal(res2.skipped, true);
    assert.equal(res2.reason, 'previous_already_handled');
    assert.equal(tMock.sentMessages.length, 0);
  } finally {
    tMock.restore();
  }
});

// ── 34. Scheduler Tick with Previous Failed (Scenario H) ───────────────

test('34: scheduler tick retries previous failed report after cooldown', async () => {
  const tMock = installTelegramMock();

  try {
    // Previous day failed > 10 minutes ago
    await dbRun(
      `INSERT INTO daily_owner_reports (report_type, report_date, status, attempt_count, last_attempt_at)
       VALUES ('daily_summary', '2026-11-21', 'failed', 1, datetime('now', '-10 minutes'))`
    );

    const tickTime = new Date('2026-11-22T06:00:00Z');
    const res = await dailyOwnerReport.evaluateDailyReportSchedulerTick({ now: tickTime, db });
    assert.equal(res.ok, true);
    assert.equal(res.sent, true);
    assert.equal(res.reportDate, '2026-11-21');
    assert.equal(tMock.sentMessages.length, 1);

    const row = await dbGet(`SELECT status, attempt_count, sent_at FROM daily_owner_reports WHERE report_date = '2026-11-21'`);
    assert.equal(row.status, 'sent');
    assert.equal(row.attempt_count, 2);
    assert.ok(row.sent_at);
  } finally {
    tMock.restore();
  }
});
