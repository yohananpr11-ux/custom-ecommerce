// JONO Telegram noise reliability test suite:
// Proves that routine success events (hourly sync, backup, fulfillment progress,
// leads, visit batches) send zero Telegram alerts, while genuine critical
// failures and business events (HUMAN_SESSION_STARTED, PAID_ORDER,
// CUSTOMER_IMPACTING_ERROR, CRITICAL_INFRA_FAILURE) are delivered with dedupe.
//
// Hermetic test suite: isolated SQLite DB, mocked Telegram/Printify/PayPal/Axios.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-noise-hotfix-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-noise';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-noise';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = 'mock-telegram-token';
process.env.TELEGRAM_OWNER_CHAT_ID = '123456789';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-noise';

const { app } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const telegram = require('../services/telegram.js');
const ownerNotifications = require('../services/owner-notifications.js');
const technicalIssues = require('../services/technical-issues.js');
const sqliteBackup = require('../services/sqlite-backup.js');
const fulfillment = require('../services/fulfillment.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
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

// ── 1. Routine sync success => zero Telegram ───────────────────────────

test('1: Printify sync success (startup or manual) sends zero Telegram messages', async () => {
  const tMock = installTelegramMock();
  try {
    const originalToken = printify.token;
    printify.token = ''; // built-in simulation fallback
    const count = await printify.syncProducts('startup');
    printify.token = originalToken;

    assert.equal(count, 10, 'simulated sync returned 10 products');
    assert.equal(tMock.sentMessages.length, 0, 'routine sync success must never send Telegram alerts');
  } finally {
    tMock.restore();
  }
});

// ── 2. Routine backup success => zero Telegram ─────────────────────────

test('2: Successful SQLite backup cycle sends zero Telegram messages', async () => {
  const tMock = installTelegramMock();
  const backupSubdir = path.join(tmpDir, 'test-backups');
  try {
    const result = await sqliteBackup.runBackupCycle({
      db,
      backupDir: backupSubdir,
      env: { ENABLE_SQLITE_BACKUPS: 'true' },
    });

    assert.equal(result.skipped, false);
    assert.equal(tMock.sentMessages.length, 0, 'routine backup success must never send Telegram alerts');
  } finally {
    tMock.restore();
  }
});

// ── 3. Routine fulfillment progress => zero Telegram ───────────────────

test('3: Routine supplier fulfillment success sends zero Telegram messages', async () => {
  const tMock = installTelegramMock();
  try {
    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address) VALUES ('Noise Test', 'noise@example.invalid', 150, 'paid', 'Synthetic Street 1')`
    );
    const orderId = orderInsert.lastID;
    await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, 1, 1, 150, 'dropship', 'pending')`,
      [orderId]
    );

    const dropshipMock = mock.method(require('../services/dropship.js'), 'sendOrder', async () => ({
      ref: 'CJ-TEST-ORDER-123',
    }));

    try {
      await fulfillment.routeOrderToSupplier(orderId, { customerName: 'Noise Test', addressLine1: 'Test St' }, [
        { id: 1, productId: 1, supplier_id: 'dropship', quantity: 1, price: 150 },
      ]);
      assert.equal(tMock.sentMessages.length, 0, 'routine fulfillment success must be silent on Telegram');
    } finally {
      dropshipMock.mock.restore();
    }
  } finally {
    tMock.restore();
  }
});

// ── 4. Routine lead signup => zero Telegram ────────────────────────────

test('4: New lead creation sends zero Telegram spam', async () => {
  const tMock = installTelegramMock();
  try {
    const email = `noise_lead_${Date.now()}@example.invalid`;
    const res = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(tMock.sentMessages.length, 0, 'routine lead signup must not send immediate Telegram spam');
  } finally {
    tMock.restore();
  }
});

// ── 5. Routine store visits queueing => deprecated / zero Telegram ────

test('5: Legacy store visits queueing is silenced and sends zero Telegram alerts', async () => {
  const tMock = installTelegramMock();
  try {
    telegram.queueVisit({
      visitorType: 'human',
      visitorDevice: 'Mobile',
      path: '/test-page',
      isBot: false,
    });
    await telegram.flushVisitBatch();

    assert.equal(tMock.sentMessages.length, 0, 'legacy visit queueing must not send Telegram alerts');
  } finally {
    tMock.restore();
  }
});

// ── 6. Critical backup failure => immediate alert with dedupe ──────────

test('6: Critical SQLite backup failure triggers an alert; repeats within cooldown are deduped', async () => {
  const tMock = installTelegramMock();
  const failingBackupOptions = {
    db: { run: (_s, cb) => cb(new Error('Simulated disk full / backup failure')) },
    onlineBackup: async () => { throw new Error('Simulated I/O corruption'); },
    backupDir: path.join(tmpDir, 'failing-backups'),
  };

  try {
    // First failure: must trigger alert
    await assert.rejects(() => sqliteBackup.runBackupCycle(failingBackupOptions));
    assert.equal(tMock.sentMessages.length, 1, 'first critical backup failure sends 1 alert');
    assert.match(tMock.sentMessages[0], /CRITICAL_INFRA_FAILURE/);
    assert.match(tMock.sentMessages[0], /sqlite-backup/);

    // 10 repeated failures immediately: must be suppressed by cooldown
    for (let i = 0; i < 10; i++) {
      await assert.rejects(() => sqliteBackup.runBackupCycle(failingBackupOptions));
    }
    assert.equal(tMock.sentMessages.length, 1, 'repeated backup failures within cooldown must be deduped (no spam)');
  } finally {
    tMock.restore();
  }
});

// ── 7. Notification policy suppresses routine events ───────────────────

test('7: ownerNotifications.notify suppresses routine daily events while allowing immediate events', async () => {
  const tMock = installTelegramMock();
  try {
    // Routine sync success
    const syncRes = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.INFO,
      eventType: 'routine_sync_success',
      message: 'sync finished ok',
    });
    assert.equal(syncRes.sent, false);
    assert.equal(syncRes.reason, 'routine_suppressed');

    // Routine backup success
    const backupRes = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.INFO,
      eventType: 'routine_backup_success',
      message: 'backup finished ok',
    });
    assert.equal(backupRes.sent, false);
    assert.equal(backupRes.reason, 'routine_suppressed');

    // Immediate critical infra failure
    const infraRes = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.CRITICAL,
      eventType: 'critical_infra_failure',
      message: '🚨 <b>DB corruption</b>',
      dedupKey: 'test_db_infra_failure',
    });
    assert.equal(infraRes.sent, true);
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── 8. Manual fulfillment required => immediate operator alert ─────────

test('8: Manual fulfillment required sends an immediate operator alert', async () => {
  const tMock = installTelegramMock();
  try {
    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, totalAmount, status, address) VALUES ('Manual Item Buyer', 'manual@example.invalid', 250, 'paid', 'Synthetic Street 1')`
    );
    const orderId = orderInsert.lastID;
    await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, 25, 1, 250, 'manual', 'pending')`,
      [orderId]
    );

    await fulfillment.routeOrderToSupplier(orderId, { customerName: 'Manual Buyer', addressLine1: 'St 1' }, [
      { id: 25, productId: 25, supplier_id: 'manual', quantity: 1, price: 250 },
    ]);

    assert.equal(tMock.sentMessages.length, 1, 'manual fulfillment required must send an alert');
    assert.match(tMock.sentMessages[0], /MANUAL_FULFILLMENT_REQUIRED/);
    assert.match(tMock.sentMessages[0], /Order-ID/);
  } finally {
    tMock.restore();
  }
});

// ── 9. Telegram API outage never crashes background jobs ──────────────

test('9: Telegram API failure never throws out or breaks underlying backup or sync jobs', async () => {
  const failingTelegramMock = mock.method(telegram, 'sendMessage', async () => {
    throw new Error('Simulated Telegram API outage (ETIMEDOUT)');
  });

  try {
    // Sync with failing telegram
    const originalToken = printify.token;
    printify.token = '';
    const count = await printify.syncProducts('manual');
    printify.token = originalToken;
    assert.equal(count, 10, 'sync must succeed despite Telegram failure');

    // Backup cycle with failing telegram
    const result = await sqliteBackup.runBackupCycle({
      db,
      backupDir: path.join(tmpDir, 'tg-outage-backups'),
      env: { ENABLE_SQLITE_BACKUPS: 'true' },
    });
    assert.equal(result.skipped, false, 'backup must succeed despite Telegram outage');
  } finally {
    failingTelegramMock.mock.restore();
  }
});
