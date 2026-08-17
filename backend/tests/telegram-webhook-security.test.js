// Telegram webhook security (PR #33): secret_token validation, fail-closed
// chat authorization, and confirmation that MENI_CORE's admin-secret
// integration path and existing legitimate commands are unaffected.
//
// Reuses the same real-app harness as paid-order-notifications.test.js
// (separate process/file, separate isolated temp DB -- node:test runs each
// file in its own process). No real Telegram network call is ever made
// (TELEGRAM_BOT_TOKEN is empty, so telegram.sendMessage short-circuits).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-webhook-security-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-tgsec';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-tgsec';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-tgsec-configured';
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-tgsec';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-tgsec';
process.env.TELEGRAM_OWNER_CHAT_ID = 'test-authorized-chat-12345';
delete process.env.TELEGRAM_WEBHOOK_SECRET;

// Capture the one-time startup warning emitted while requiring index.js
// (TELEGRAM_WEBHOOK_SECRET must be unset at this exact point -- see above).
const capturedStartupLines = [];
const _origWarnAtRequire = console.warn;
console.warn = (...args) => { capturedStartupLines.push(args.map(String).join(' ')); _origWarnAtRequire(...args); };
const { app } = require('../index.js');
const telegram = require('../services/telegram.js');
console.warn = _origWarnAtRequire;

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

async function apiPost(pathname, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

const AUTHORIZED_CHAT_ID = 'test-authorized-chat-12345';
const WEBHOOK_SECRET = 'test-webhook-secret-abc123XYZ';

function couponClearUpdate(chatId = AUTHORIZED_CHAT_ID) {
  return { message: { text: '/coupon clear', chat: { id: chatId } } };
}

// ── H/I. Backward-compatible mode when TELEGRAM_WEBHOOK_SECRET is unset ────

test('H: missing TELEGRAM_WEBHOOK_SECRET keeps temporary backward-compatible mode (no header required)', async () => {
  assert.equal(process.env.TELEGRAM_WEBHOOK_SECRET, undefined, 'precondition: secret must be unset for this test');
  const res = await apiPost('/api/webhooks/telegram', couponClearUpdate());
  assert.equal(res.status, 200);
  assert.equal(res.json.received, true);
  assert.equal(res.json.action, 'coupon_cleared');
});

test('I: backward-compatible mode emits a clear startup security warning', () => {
  const warned = capturedStartupLines.some(
    (line) => line.includes('TELEGRAM_WEBHOOK_SECRET') && line.toUpperCase().includes('SECURITY')
  );
  assert.equal(warned, true, 'expected a SECURITY warning mentioning TELEGRAM_WEBHOOK_SECRET at startup');
});

// ── A/B/C. Secret_token validation once TELEGRAM_WEBHOOK_SECRET is set ─────

test('A: configured webhook secret + correct header is accepted', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    const res = await apiPost('/api/webhooks/telegram', couponClearUpdate(), {
      'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.received, true);
    assert.equal(res.json.action, 'coupon_cleared');
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

test('B: configured secret + missing header is rejected', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    const res = await apiPost('/api/webhooks/telegram', couponClearUpdate());
    assert.equal(res.status, 401);
    assert.equal(res.json.received, false);
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

test('C: configured secret + wrong header is rejected', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    const res = await apiPost('/api/webhooks/telegram', couponClearUpdate(), {
      'X-Telegram-Bot-Api-Secret-Token': 'totally-wrong-value',
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.received, false);
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

// ── D. Secret values are never logged ───────────────────────────────────────

test('D: secret values are never logged, on success or failure', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...a) => lines.push(a.map(String).join(' '));
  console.warn = (...a) => lines.push(a.map(String).join(' '));
  console.error = (...a) => lines.push(a.map(String).join(' '));
  try {
    await apiPost('/api/webhooks/telegram', couponClearUpdate(), { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET });
    await apiPost('/api/webhooks/telegram', couponClearUpdate());
    await apiPost('/api/webhooks/telegram', couponClearUpdate(), {
      'X-Telegram-Bot-Api-Secret-Token': 'wrong-header-value-should-not-leak',
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
  const joined = lines.join('\n');
  assert.equal(joined.includes(WEBHOOK_SECRET), false, 'the configured secret must never appear in logs');
  assert.equal(joined.includes('wrong-header-value-should-not-leak'), false, 'a rejected header value must never appear in logs');
});

// ── E. Authorized-chat rules remain enforced ────────────────────────────────

test('E: commands from an unauthorized chat are rejected even with a valid webhook secret', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    const res = await apiPost('/api/webhooks/telegram', couponClearUpdate('some-other-chat-id'), {
      'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ignored, true);
    assert.equal(res.json.reason, 'unauthorized_chat');
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

test('E: fail-closed -- if no authorized chat id is configured at all, inbound commands are rejected', async () => {
  const savedChatId = telegram.chatId;
  telegram.chatId = null;
  try {
    const res = await apiPost('/api/webhooks/telegram', couponClearUpdate());
    assert.equal(res.status, 503);
    assert.equal(res.json.received, false);
    assert.equal(res.json.error, 'no_authorized_chat_configured');
  } finally {
    telegram.chatId = savedChatId;
  }
});

// ── F. No new mutation-capable command was introduced ───────────────────────

test('F: unrecognized command text introduces no new mutation -- falls through to the existing ignore path', async () => {
  const attempts = ['/admin delete-order 5', '/set-price 1 999', '/refresh-prices', '/shutdown'];
  for (const text of attempts) {
    const res = await apiPost('/api/webhooks/telegram', { message: { text, chat: { id: AUTHORIZED_CHAT_ID } } });
    assert.equal(res.status, 200);
    assert.equal(res.json.received, true);
    assert.equal(res.json.ignored, true);
    assert.equal(res.json.reason, 'missing_session_id', `"${text}" must not be treated as a new command`);
  }
});

// ── G. Current legitimate commands still work when authorized ──────────────

test('G: /coupon set still works when authorized', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const res = await apiPost('/api/webhooks/telegram', {
      message: { text: '/coupon 15 2', chat: { id: AUTHORIZED_CHAT_ID } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.received, true);
    assert.equal(res.json.discount, 15);
    assert.equal(res.json.hours, 2);
    assert.match(res.json.coupon, /^MENI-[A-F0-9]{6}$/);
  } finally {
    t.mock.timers.reset();
  }
});

test('G: /reply <session_id> is still recognized when authorized', async () => {
  const res = await apiPost('/api/webhooks/telegram', {
    message: { text: '/reply session_doesnotexist hello there', chat: { id: AUTHORIZED_CHAT_ID } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.received, true);
  assert.equal(res.json.sessionId, 'session_doesnotexist');
  assert.equal(res.json.routed, false, 'no such session exists in this isolated test db');
});

// ── J. MENI_CORE's admin-secret integration path is unaffected ─────────────

test('J: /api/admin/set-coupon still requires JONO_ADMIN_SECRET', async () => {
  const res = await apiPost('/api/admin/set-coupon', { couponCode: 'SHOULD-FAIL', discountPercent: 10 });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'Unauthorized');
});

test('J: /api/admin/set-coupon still succeeds with the correct JONO_ADMIN_SECRET', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const res = await apiPost(
      '/api/admin/set-coupon',
      { couponCode: 'JONO-OK', discountPercent: 10 },
      { 'X-Admin-Secret': process.env.JONO_ADMIN_SECRET }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  } finally {
    t.mock.timers.reset();
  }
});
