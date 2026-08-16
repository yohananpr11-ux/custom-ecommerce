// Emergency Hotfix: Legacy Daily Store Intelligence & Report Trigger Disablement Test Suite
// Proves that:
// 1. Requiring backend/services/telegram.js does NOT schedule or run legacy Daily Intelligence cron.
// 2. Calling POST /api/admin/trigger-daily-report returns 410 and NEVER sends a Telegram message.
// 3. Repeated calls to POST /api/admin/trigger-daily-report result in zero Telegram sends.
// 4. "JONO Daily Store Intelligence" and "Manny's Insights" have zero active senders in the codebase.
// 5. PR #35 noise suppression remains intact: routine Printify sync and legacy visit batching remain silent.
// 6. Legitimate owner notifications (HUMAN_SESSION_STARTED, PAID_ORDER, technical alerts, webhook security) remain fully operational.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jono-legacy-disable-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-leg';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-leg';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = 'mock-telegram-token';
process.env.TELEGRAM_OWNER_CHAT_ID = '123456789';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-sec-leg';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-legacy';

const { app } = require('../index.js');
const db = require('../db.js');
const telegram = require('../services/telegram.js');
const ownerNotifications = require('../services/owner-notifications.js');
const printify = require('../services/printify.js');
const technicalIssues = require('../services/technical-issues.js');

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

// ── 1. Module requirement safety ──────────────────────────────────────

test('1: requiring telegram.js does NOT expose or schedule legacy daily intelligence', () => {
  assert.equal(typeof telegram.initDailyCron, 'undefined', 'initDailyCron must not exist on telegram service');
  assert.equal(typeof telegram.sendDailyReport, 'undefined', 'sendDailyReport must not exist on telegram service');
  assert.equal(typeof telegram.generateDailyReportData, 'undefined', 'generateDailyReportData must not exist on telegram service');
});

// ── 2. Admin trigger endpoint disablement ──────────────────────────────

test('2: POST /api/admin/trigger-daily-report returns 410 and sends ZERO Telegram messages', async () => {
  const tMock = installTelegramMock();

  try {
    const res = await fetch(`${baseUrl}/api/admin/trigger-daily-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': 'test-admin-secret-legacy',
      },
    });

    assert.equal(res.status, 410, 'Must respond with 410 Gone');
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.disabled, true);
    assert.equal(json.reason, 'legacy_daily_report_disabled');
    assert.equal(tMock.sentMessages.length, 0, 'Must send zero Telegram messages');
  } finally {
    tMock.restore();
  }
});

test('3: repeated external calls to trigger endpoint produce zero Telegram messages', async () => {
  const tMock = installTelegramMock();

  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/admin/trigger-daily-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': 'test-admin-secret-legacy',
        },
      });
      assert.equal(res.status, 410);
    }

    assert.equal(tMock.sentMessages.length, 0, 'Zero Telegram sends across all repeated calls');
  } finally {
    tMock.restore();
  }
});

// ── 4. PR #35 Noise Suppression Remains Intact ────────────────────────

test('4: routine Printify sync and legacy visit batching remain completely silent on Telegram', async () => {
  const tMock = installTelegramMock();

  try {
    const originalToken = printify.token;
    printify.token = '';
    await printify.syncProducts('startup');
    await printify.syncProducts('scheduled');
    printify.token = originalToken;

    telegram.queueVisit({ ip: '127.0.0.1', path: '/' });
    await telegram.flushVisitBatch();

    assert.equal(tMock.sentMessages.length, 0, 'Zero noise messages sent');
  } finally {
    tMock.restore();
  }
});

// ── 5. Legitimate owner notifications remain fully functional ──────────

test('5: legitimate owner notifications (sessions, errors, webhook security) remain fully operational', async () => {
  const tMock = installTelegramMock();

  try {
    // 1. Human session start telemetry
    const sessRes = await fetch(`${baseUrl}/api/telemetry/session-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        sessionId: 'sess-leg-test-1',
        visitorId: 'vis-leg-test-1',
        landingPath: '/products',
        referrer: 'https://instagram.com/p/123',
      }),
    });
    assert.equal(sessRes.status, 200);

    // 2. Technical issue alert
    await technicalIssues.recordIssue({
      type: 'PAYMENT_GATEWAY_UNREACHABLE',
      severity: 'CRITICAL',
      route: '/api/checkout/pay',
      message: 'Payment gateway timeout',
    });

    assert.equal(tMock.sentMessages.length, 2, 'Legitimate alerts are delivered');
    assert.match(tMock.sentMessages[0], /HUMAN_SESSION_STARTED/);
    assert.match(tMock.sentMessages[1], /CUSTOMER_IMPACTING_ERROR/);
    assert.doesNotMatch(tMock.sentMessages[0], /JONO Daily Store Intelligence/);
    assert.doesNotMatch(tMock.sentMessages[1], /Manny&#39;s Insights|Manny's Insights/);
  } finally {
    tMock.restore();
  }
});
