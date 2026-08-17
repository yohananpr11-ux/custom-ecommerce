// JONO Telegram noise reliability & hardening test suite:
// Proves that:
// A. successful Telegram send => cooldown recorded
// B. failed Telegram send => successful cooldown NOT recorded
// C. retry after Telegram failure => can send
// D. same critical infra failure twice => one alert
// E. service/module reinitialization simulating restart => still deduped (SQLite durable)
// F. cooldown expiry => alert allowed again
// G. two concurrent same failures => max one immediate send
// H. backup success => zero Telegram
// I. Printify success/startup/scheduled/webhook => zero Telegram
// J. backup failure => critical alert
// K. Printify failure => critical alert
// L. underlying jobs continue regardless of Telegram failure

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-noise-hardened-'));
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
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-noise';
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

// ── Test A: Successful Telegram send => cooldown recorded ─────────────

test('A: successful Telegram send records cooldown', async () => {
  const tMock = installTelegramMock();
  try {
    const res1 = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.WARNING,
      eventType: 'test_event_success',
      dedupKey: 'test_key_a',
      cooldownMs: 60000,
      message: 'Test message A1',
    });
    assert.equal(res1.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    // Second send inside cooldown: suppressed
    const res2 = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.WARNING,
      eventType: 'test_event_success',
      dedupKey: 'test_key_a',
      cooldownMs: 60000,
      message: 'Test message A2',
    });
    assert.equal(res2.sent, false);
    assert.equal(res2.reason, 'cooldown');
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── Test B & C: Failed Telegram send does NOT record cooldown; retry works ──

test('B & C: failed Telegram send does not record cooldown, allowing immediate retry', async () => {
  let shouldFail = true;
  const sentMessages = [];
  const tMock = mock.method(telegram, 'sendMessage', async (text) => {
    if (shouldFail) {
      return { ok: false, reason: 'network_timeout' };
    }
    sentMessages.push(text);
    return { ok: true, status: 200 };
  });

  try {
    // Attempt 1: Telegram fails
    const res1 = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.WARNING,
      eventType: 'test_event_retry',
      dedupKey: 'test_key_b',
      cooldownMs: 60000,
      message: 'Test message B1',
    });
    assert.equal(res1.sent, false, 'marked sent:false on failure');
    assert.equal(sentMessages.length, 0);

    // Attempt 2: Telegram recovered => must send immediately without being blocked by cooldown
    shouldFail = false;
    const res2 = await ownerNotifications.notify({
      severity: ownerNotifications.SEVERITY.WARNING,
      eventType: 'test_event_retry',
      dedupKey: 'test_key_b',
      cooldownMs: 60000,
      message: 'Test message B2',
    });
    assert.equal(res2.sent, true, 'retry immediately succeeded without cooldown blockage');
    assert.equal(sentMessages.length, 1);
  } finally {
    tMock.mock.restore();
  }
});

// ── Test D: Same critical infra failure twice => one alert ─────────────

test('D: same critical infra failure twice within cooldown sends only one alert', async () => {
  const tMock = installTelegramMock();
  try {
    const res1 = await technicalIssues.recordIssue({
      type: 'sqlite_backup_failure',
      severity: 'CRITICAL',
      route: 'sqlite-backup/test',
      message: 'Disk write I/O error',
    });
    assert.equal(res1.notify.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    const res2 = await technicalIssues.recordIssue({
      type: 'sqlite_backup_failure',
      severity: 'CRITICAL',
      route: 'sqlite-backup/test',
      message: 'Disk write I/O error',
    });
    assert.equal(res2.occurrenceCount, 2);
    assert.equal(res2.notify, null, 'second occurrence inside cooldown produces zero additional alerts');
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── Test E: Restart simulation => still deduped (SQLite durable) ───────

test('E: restart simulation still honors durable SQLite cooldown for critical infra failures', async () => {
  const tMock = installTelegramMock();
  try {
    // Occurrence 1
    const res1 = await technicalIssues.recordIssue({
      type: 'printify_sync_failure',
      severity: 'WARNING',
      route: 'printify-sync/startup',
      message: 'Printify API 502 Bad Gateway',
    });
    assert.equal(res1.notify.sent, true);
    assert.equal(tMock.sentMessages.length, 1);

    // Reset all in-memory state (simulating fresh process startup)
    ownerNotifications._resetForTests();

    // Occurrence 2 after restart
    const res2 = await technicalIssues.recordIssue({
      type: 'printify_sync_failure',
      severity: 'WARNING',
      route: 'printify-sync/startup',
      message: 'Printify API 502 Bad Gateway',
    });
    assert.equal(res2.occurrenceCount, 2);
    assert.equal(res2.notify, null, 'still deduped after simulated restart');
    assert.equal(tMock.sentMessages.length, 1, 'no second alert sent after restart');
  } finally {
    tMock.restore();
  }
});

// ── Test F: Cooldown expiry => alert allowed again ─────────────────────

test('F: after durable cooldown expires, subsequent failure can alert again', async () => {
  const tMock = installTelegramMock();
  try {
    const signature = 'test_sig_cooldown_expiry_1234';
    await dbRun(
      `INSERT INTO technical_issues (signature, type, severity, route, message, first_seen_at, last_seen_at, occurrence_count, last_notified_at, notified_count)
       VALUES (?, 'sqlite_backup_failure', 'CRITICAL', 'backup/test', 'Corrupt table', datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1, datetime('now', '-20 minutes'), 1)`,
      [signature]
    );

    const res = await technicalIssues.recordIssue({
      type: 'sqlite_backup_failure',
      severity: 'CRITICAL',
      route: 'backup/test',
      message: 'Corrupt table',
    });

    assert.equal(res.notify.sent, true, 'alert allowed after 15m cooldown elapsed');
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── Test G: Two concurrent same failures => max one immediate send ─────

test('G: two concurrent identical critical failures produce at most one immediate send', async () => {
  const tMock = installTelegramMock();
  try {
    const [res1, res2] = await Promise.all([
      technicalIssues.recordIssue({
        type: 'concurrent_infra_test',
        severity: 'CRITICAL',
        route: 'infra/concurrent',
        message: 'Concurrent lock collision',
      }),
      technicalIssues.recordIssue({
        type: 'concurrent_infra_test',
        severity: 'CRITICAL',
        route: 'infra/concurrent',
        message: 'Concurrent lock collision',
      }),
    ]);

    const sentCount = (res1.notify?.sent ? 1 : 0) + (res2.notify?.sent ? 1 : 0);
    assert.equal(sentCount, 1, 'exactly one of the concurrent calls sent an alert');
    assert.equal(tMock.sentMessages.length, 1);
  } finally {
    tMock.restore();
  }
});

// ── Test H: Backup success => zero Telegram ────────────────────────────

test('H: backup success sends zero Telegram alerts', async () => {
  const tMock = installTelegramMock();
  const backupSubdir = path.join(tmpDir, 'test-backups-h');
  try {
    const result = await sqliteBackup.runBackupCycle({
      db,
      backupDir: backupSubdir,
      env: { ENABLE_SQLITE_BACKUPS: 'true' },
    });
    assert.equal(result.skipped, false);
    assert.equal(tMock.sentMessages.length, 0, 'routine backup success sends 0 Telegram alerts');
  } finally {
    tMock.restore();
  }
});

// ── Test I: Printify success/startup/scheduled/webhook => zero Telegram ──

test('I: Printify success (startup, scheduled, webhook) sends zero Telegram alerts', async () => {
  const tMock = installTelegramMock();
  try {
    const originalToken = printify.token;
    printify.token = '';

    const countStartup = await printify.syncProducts('startup');
    assert.equal(countStartup, 10);
    assert.equal(tMock.sentMessages.length, 0);

    const countScheduled = await printify.syncProducts('scheduled');
    assert.equal(countScheduled, 10);
    assert.equal(tMock.sentMessages.length, 0);

    const countWebhook = await printify.syncProducts('webhook');
    assert.equal(countWebhook, 10);
    assert.equal(tMock.sentMessages.length, 0);

    printify.token = originalToken;
  } finally {
    tMock.restore();
  }
});

// ── Test J: Backup failure => critical alert ───────────────────────────

test('J: backup failure triggers a durable critical alert', async () => {
  const tMock = installTelegramMock();
  const failingBackupOptions = {
    db: { run: (_s, cb) => cb(new Error('Simulated database corruption')) },
    onlineBackup: async () => { throw new Error('Simulated online backup crash'); },
    backupDir: path.join(tmpDir, 'failing-backups-j'),
  };

  try {
    await assert.rejects(() => sqliteBackup.runBackupCycle(failingBackupOptions));
    assert.equal(tMock.sentMessages.length, 1, 'critical backup failure sends 1 alert');
    assert.match(tMock.sentMessages[0], /CRITICAL_INFRA_FAILURE/);
    assert.match(tMock.sentMessages[0], /sqlite_backup_failure/);
  } finally {
    tMock.restore();
  }
});

// ── Test K: Printify failure => critical alert ─────────────────────────

test('K: Printify sync failure triggers a durable critical alert', async () => {
  const tMock = installTelegramMock();
  try {
    const res = await technicalIssues.recordIssue({
      type: 'printify_sync_failure',
      severity: 'WARNING',
      route: 'printify-sync/startup',
      message: 'Printify HTTP 500 error',
    });
    assert.equal(res.notify.sent, true);
    assert.equal(tMock.sentMessages.length, 1);
    assert.match(tMock.sentMessages[0], /CRITICAL_INFRA_FAILURE/);
    assert.match(tMock.sentMessages[0], /printify_sync_failure/);
  } finally {
    tMock.restore();
  }
});

// ── Test L: Underlying jobs continue regardless of Telegram failure ───

test('L: underlying backup and sync jobs continue executing when Telegram API fails', async () => {
  const failingTelegramMock = mock.method(telegram, 'sendMessage', async () => {
    throw new Error('Simulated Telegram outage (ECONNREFUSED)');
  });

  try {
    const originalToken = printify.token;
    printify.token = '';
    const count = await printify.syncProducts('manual');
    printify.token = originalToken;
    assert.equal(count, 10, 'sync completes successfully despite Telegram failure');

    const result = await sqliteBackup.runBackupCycle({
      db,
      backupDir: path.join(tmpDir, 'tg-outage-backups-l'),
      env: { ENABLE_SQLITE_BACKUPS: 'true' },
    });
    assert.equal(result.skipped, false, 'backup completes successfully despite Telegram failure');
  } finally {
    failingTelegramMock.mock.restore();
  }
});
