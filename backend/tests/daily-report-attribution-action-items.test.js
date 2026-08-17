'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const sqlite3 = require('sqlite3').verbose();

const visitorTelemetry = require('../services/visitor-telemetry');
const dailyOwnerReport = require('../services/daily-owner-report');

// ── 1. Source Classification Unit Scenarios ───────────────────────────────

test('1. resolveSessionSource canonical classification scenarios', () => {
  // Scenario A: chatgpt.com referrer with no UTM source
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://chatgpt.com/' }),
    'chatgpt.com'
  );

  // Scenario B: chatgpt.com referrer with deep path and queries
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://chatgpt.com/c/68b81cf7-8b04-800d-a3d8-30ad50eb5001?token=secret123' }),
    'chatgpt.com'
  );

  // Scenario C: Explicit UTM source overrides referrer
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://chatgpt.com/', source: 'spring_campaign' }),
    'spring_campaign'
  );

  // Scenario D: Instagram referral variations
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://l.instagram.com/' }),
    'instagram.com'
  );

  // Scenario E: Google referral with search query
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://www.google.co.il/search?q=jono+store' }),
    'google.co.il'
  );

  // Scenario F: True direct traffic
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: '', source: '' }),
    'direct'
  );
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: null, source: null }),
    'direct'
  );

  // Scenario G: Internal site navigation is treated as direct (not self-referral)
  assert.equal(
    visitorTelemetry.resolveSessionSource({ referrer: 'https://shopjono.com/products/16' }),
    'direct'
  );
});

test('2. extractReferrerDomain strips all queries, paths, tokens, and PII', () => {
  const dirtyUrl = 'https://chatgpt.com/share/abc-123?utm_source=chatgpt&token=SUPER_SECRET_TOKEN#heading';
  const clean = visitorTelemetry.extractReferrerDomain(dirtyUrl);
  assert.equal(clean, 'chatgpt.com');
  assert.doesNotMatch(clean, /SUPER_SECRET_TOKEN/);
  assert.doesNotMatch(clean, /\?/);
  assert.doesNotMatch(clean, /\//);
  assert.doesNotMatch(clean, /#/);
});

test('3. formatSourceDisplay provides clean Hebrew/English presentation', () => {
  assert.equal(visitorTelemetry.formatSourceDisplay('chatgpt.com'), 'chatgpt.com');
  assert.equal(visitorTelemetry.formatSourceDisplay('spring_campaign'), 'spring_campaign');
  assert.equal(visitorTelemetry.formatSourceDisplay('direct'), 'Direct / ישיר');
  assert.equal(visitorTelemetry.formatSourceDisplay(''), 'Direct / ישיר');
  assert.equal(visitorTelemetry.formatSourceDisplay(null), 'Direct / ישיר');
});

// ── 2. Daily Report Traffic Aggregation & Action Items Scenarios ──────────

test('4. End-to-End: chatgpt.com session aggregates as chatgpt.com in daily report', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-report-test-'));
  const testDbPath = path.join(tmpDir, 'test.db');

  const db = new sqlite3.Database(testDbPath);

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE visitor_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          visitor_id TEXT NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          landing_path TEXT,
          referrer TEXT,
          source TEXT,
          device_category TEXT,
          ua_classification TEXT NOT NULL DEFAULT 'human',
          is_human INTEGER NOT NULL DEFAULT 1,
          notified INTEGER NOT NULL DEFAULT 0
        )
      `);

      db.run(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL,
          totalAmount REAL NOT NULL,
          expected_payment_currency TEXT,
          expected_payment_amount REAL,
          paid_at DATETIME
        )
      `);

      db.run(`
        CREATE TABLE order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          orderId INTEGER,
          productId INTEGER,
          quantity INTEGER,
          price REAL,
          supplier_id TEXT,
          fulfillment_status TEXT
        )
      `);

      db.run(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          is_hidden INTEGER DEFAULT 0
        )
      `);

      db.run(`
        CREATE TABLE technical_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT,
          severity TEXT,
          route TEXT,
          message TEXT,
          occurrence_count INTEGER DEFAULT 1,
          first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed 1 real human session from chatgpt.com
      db.run(
        `INSERT INTO visitor_sessions (visitor_id, session_id, started_at, landing_path, referrer, source, device_category, is_human)
         VALUES (?, ?, '2026-08-17 14:30:00', '/', 'chatgpt.com', 'chatgpt.com', 'Mobile', 1)`,
        ['vid_12345', '4c751f6055a442079df2ee346de0432e'],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  });

  // Create a valid backup fixture so backup status is healthy
  fs.writeFileSync(path.join(tmpDir, 'ecommerce-20260817-120000Z.db'), 'mock-sqlite-backup');
  fs.writeFileSync(path.join(tmpDir, 'ecommerce-20260817-120000Z.db.sha256'), 'mock-sha');

  const metrics = await dailyOwnerReport.getReportMetrics({
    dateStr: '2026-08-17',
    db,
    env: {},
    backupDir: tmpDir,
  });

  // Verify traffic summary
  assert.equal(metrics.traffic.humanSessions, 1);
  assert.equal(metrics.traffic.uniqueHumanVisitors, 1);
  assert.deepEqual(metrics.traffic.topReferrers, [
    { domain: 'chatgpt.com', count: 1 }
  ]);

  // Format HTML message
  const html = dailyOwnerReport.buildDailyReportMessage(metrics);

  // 1. Must contain "chatgpt.com (1)" in traffic sources
  assert.match(html, /מקורות הגעה:\s*chatgpt\.com \(1\)/);
  assert.doesNotMatch(html, /מקורות הגעה:\s*Direct \/ ישיר/);

  // 2. "Integrity OK" must NEVER appear in action items
  assert.doesNotMatch(html, /🎯 <b>מה דורש תשומת לב<\/b>[\s\S]*Integrity:\s*OK/);
  assert.doesNotMatch(html, /🎯 <b>מה דורש תשומת לב<\/b>[\s\S]*שלמות מסד הנתונים תקינה/);

  // 3. 1 visit / 0 sales must NOT produce an alarm action item
  assert.doesNotMatch(html, /🎯 <b>מה דורש תשומת לב<\/b>[\s\S]*ביקורים ללא רכישות/);
  assert.match(html, /• אין כרגע פעולה דחופה שנדרשת\./);

  db.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('5. Action Items: Genuine actionable failures are reported properly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-action-test-'));
  const testDbPath = path.join(tmpDir, 'action.db');

  const db = new sqlite3.Database(testDbPath);

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE visitor_sessions (id INTEGER PRIMARY KEY, visitor_id TEXT, session_id TEXT UNIQUE, started_at DATETIME, last_seen_at DATETIME, landing_path TEXT, referrer TEXT, source TEXT, device_category TEXT, ua_classification TEXT, is_human INTEGER, notified INTEGER)`);
      db.run(`CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, totalAmount REAL, expected_payment_currency TEXT, expected_payment_amount REAL, paid_at DATETIME)`);
      db.run(`CREATE TABLE order_items (id INTEGER PRIMARY KEY, orderId INTEGER, productId INTEGER, quantity INTEGER, price REAL, supplier_id TEXT, fulfillment_status TEXT)`);
      db.run(`CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT)`);
      db.run(`CREATE TABLE technical_issues (id INTEGER PRIMARY KEY, type TEXT, severity TEXT, route TEXT, message TEXT, occurrence_count INTEGER, first_seen_at DATETIME, last_seen_at DATETIME)`);

      // Seed a manual fulfillment pending item
      db.run(`INSERT INTO orders (id, status, totalAmount, paid_at) VALUES (1, 'paid', 250, '2026-08-17 12:00:00')`);
      db.run(`INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (1, 1, 1, 250, 'manual', 'pending')`);

      // Seed a critical technical error
      db.run(`INSERT INTO technical_issues (type, severity, route, message, first_seen_at, last_seen_at) VALUES ('PAYMENT_500', 'CRITICAL', '/api/checkout/create-order', 'Database locked', '2026-08-17 13:00:00', '2026-08-17 13:00:00')`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  });

  const metrics = await dailyOwnerReport.getReportMetrics({
    dateStr: '2026-08-17',
    db,
    env: {},
    backupDir: tmpDir,
  });

  const html = dailyOwnerReport.buildDailyReportMessage(metrics);

  // Both genuine actionable items must appear in the numbered list
  assert.match(html, /1\. 📦 ישנן 1 הזמנות להגשמה ידנית הממתינות לטיפול/);
  assert.match(html, /2\. 🚨 נרשמו 1 תקלות קריטיות בחלון זה/);
  assert.doesNotMatch(html, /אין כרגע פעולה דחופה שנדרשת/);

  db.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
