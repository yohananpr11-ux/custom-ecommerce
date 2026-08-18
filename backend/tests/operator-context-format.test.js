// Operator-context message formatting (PR #34 follow-up): every important
// @jono_store_bot notification carries a short Hebrew human summary PLUS a
// stable-field-name structured diagnostic block, useful both to the owner
// reading it normally and to an operator/LLM the owner pastes it into
// later. No secrets, no raw IP, no unbounded/user-controlled breakage.
//
// Same real-app harness pattern as the rest of this suite -- isolated temp
// DB, no real Telegram network call ever made.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-context-format-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-format';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-format';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-format';

const { app, recordCustomerFacing5xxIssue } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const ownerNotifications = require('../services/owner-notifications.js');
const technicalIssues = require('../services/technical-issues.js');
const telegram = require('../services/telegram.js');

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});
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
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

test.beforeEach(() => {
  ownerNotifications._resetForTests();
});

function installGenuineTelegramDelivery() {
  return mock.method(telegram, 'sendMessage', async () => ({ ok: true, status: 200 }));
}

function installNotifySpy() {
  const calls = [];
  const originalNotify = ownerNotifications.notify.bind(ownerNotifications);
  const spy = mock.method(ownerNotifications, 'notify', async (params) => {
    const result = await originalNotify(params);
    calls.push({ ...params, sent: result.sent });
    return result;
  });
  return { calls, restore: () => spy.mock.restore() };
}

const HUMAN_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function postSessionStart(body) {
  const res = await fetch(`${baseUrl}/api/telemetry/session-start`, {
    method: 'POST',
    headers: HUMAN_HEADERS,
    body: JSON.stringify(body),
  });
  return res;
}

// PayPal happy-path harness, matching the rest of this suite.
const SYNTHETIC_SHIPPING = {
  customerName: 'Test Customer', customerEmail: 'test@example.invalid',
  firstName: 'Test', lastName: 'Customer', phone: '+15550000000',
  addressLine1: 'Synthetic Street 1', city: 'Faketown', postalCode: '00000', country: 'US', region: 'CA',
};
let nextProductId = 930001;
async function seedPrintifyProduct({ price = 100 } = {}) {
  const id = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `Format Test Product ${id}`, 'synthetic fixture', price, price / 3.6, 999, 'printify', 'printify', `pf-format-${id}`]
  );
  const variantId = id * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, printifyVariantId, color, size, price, isEnabled, isAvailable) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    [variantId, id, `pf-variant-${id}`, 'Black', 'M', price]
  );
  return { productId: id, variantId, price };
}
function installAxiosPostMock() {
  const handlers = [];
  const mockHandle = mock.method(axios, 'post', async (url, data) => {
    for (const h of handlers) {
      if (typeof h.match === 'string' ? url.includes(h.match) : h.match(url)) return h.respond(url, data);
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });
  return { on(match, respond) { handlers.push({ match, respond }); }, restore() { mockHandle.mock.restore(); } };
}
function installPaypalHappyPathMocks(axiosMock) {
  const created = new Map();
  axiosMock.on('/v1/oauth2/token', async () => ({ data: { access_token: 'fake-token' } }));
  axiosMock.on('/v2/checkout/orders', async (url, data) => {
    if (url.endsWith('/capture')) {
      const paypalOrderId = url.split('/checkout/orders/')[1].split('/capture')[0];
      const record = created.get(paypalOrderId);
      return {
        data: {
          status: 'COMPLETED',
          purchase_units: [{
            reference_id: record.localOrderId, custom_id: record.localOrderId,
            payments: { captures: [{ id: `CAPTURE-${paypalOrderId}`, amount: { currency_code: record.currency, value: record.value } }] },
          }],
        },
      };
    }
    const unit = data.purchase_units[0];
    const paypalOrderId = `PPO-${Math.random().toString(36).slice(2)}`;
    created.set(paypalOrderId, { localOrderId: unit.custom_id, currency: unit.amount.currency_code, value: unit.amount.value });
    return { data: { id: paypalOrderId, status: 'CREATED' } };
  });
  return created;
}
function installPrintifySuccessMocks() {
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: `pf-order-${Math.random().toString(36).slice(2)}`, status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => ({ ok: true, order: { id, status: 'on-hold' } }));
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => ({ ok: true, matchCount: 0, order: null }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));
  return { restore() { createMock.mock.restore(); getMock.mock.restore(); findMock.mock.restore(); submitMock.mock.restore(); } };
}
async function payOneOrder({ price = 77 } = {}) {
  const product = await seedPrintifyProduct({ price });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...SYNTHETIC_SHIPPING, items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }], currency: 'ILS' }),
  }).then((r) => r.json());
  return { createRes, axiosMock, printifyMock };
}

// ── A. Human-session message contains structured operator context ─────

test('A: the human-session message contains the required structured operator-context fields', async () => {
  const spy = installNotifySpy();
  try {
    const sessionId = randomId('sid');
    await postSessionStart({ visitorId: randomId('vid'), sessionId, landingPath: '/shop', referrer: 'https://www.google.com/search?q=jono', source: '' });

    const call = spy.calls.find((c) => c.eventType === 'new_human_session');
    assert.ok(call, 'a new_human_session notification must have been attempted');
    const msg = call.message;
    assert.match(msg, /Event: HUMAN_SESSION_STARTED/);
    assert.match(msg, new RegExp(`Session-ID: ${sessionId}`));
    assert.match(msg, /Visitor-ID: \S+/);
    assert.match(msg, /Device: \S+/);
    assert.match(msg, /Landing-Page: \/shop/);
    assert.match(msg, /Referrer-Domain: www\.google\.com/);
    assert.match(msg, /Human-Classification: human/);
    assert.doesNotMatch(msg, /\bundefined\b|\bnull\b/);
  } finally {
    spy.restore();
  }
});

// ── B. Refresh duplicate still sends no second message ──────────────────

test('B: reposting the same session_id (refresh) sends no second human-session message', async () => {
  const spy = installNotifySpy();
  try {
    const visitorId = randomId('vid');
    const sessionId = randomId('sid');
    await postSessionStart({ visitorId, sessionId, landingPath: '/', referrer: '', source: '' });
    await postSessionStart({ visitorId, sessionId, landingPath: '/other', referrer: '', source: '' });

    const calls = spy.calls.filter((c) => c.eventType === 'new_human_session');
    assert.equal(calls.length, 1);
  } finally {
    spy.restore();
  }
});

// ── C. Paid-order message contains real order/payment context ──────────

test('C: the paid-order message contains real order/payment operator-context fields', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const { createRes, axiosMock, printifyMock } = await payOneOrder({ price: 61 });
    try {
      await fetch(`${baseUrl}/api/paypal/capture-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderID: createRes.orderID }),
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      axiosMock.restore();
      printifyMock.restore();
    }

    const call = spy.calls.find((c) => c.eventType === 'paid_purchase');
    assert.ok(call, 'a paid_purchase notification must have been attempted');
    const msg = call.message;
    assert.match(msg, /Event: PAID_ORDER/);
    assert.match(msg, /Severity: INFO/);
    assert.match(msg, new RegExp(`Order-ID: ${createRes.orderId}\\b`));
    assert.match(msg, /Payment-ID: CAPTURE-\S+/);
    const order = await dbGet(`SELECT totalAmount FROM orders WHERE id = ?`, [createRes.orderId]);
    assert.match(msg, new RegExp(`Amount: ${Number(order.totalAmount).toFixed(2).replace('.', '\\.')}`));
    assert.match(msg, /Items: 1/);
    assert.match(msg, /Products: 1x Format Test Product/);
    assert.doesNotMatch(msg, /\bundefined\b|\bnull\b/);
    // The message must make it obvious payment succeeded -- it should not
    // read as, or be confusable with, a failure/error alert.
    assert.doesNotMatch(msg, /Event: (PAYMENT_FAILURE|CUSTOMER_IMPACTING_ERROR)/);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── D. Payment replay sends no duplicate ────────────────────────────────

test('D: a repeated capture call for the same order sends no duplicate paid-order message', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const { createRes, axiosMock, printifyMock } = await payOneOrder({ price: 45 });
    try {
      await fetch(`${baseUrl}/api/paypal/capture-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderID: createRes.orderID }) });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await fetch(`${baseUrl}/api/paypal/capture-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderID: createRes.orderID }) });
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      axiosMock.restore();
      printifyMock.restore();
    }

    const calls = spy.calls.filter((c) => c.eventType === 'paid_purchase' && c.sent);
    assert.equal(calls.length, 1);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── E. Technical-issue message contains signature/count/timestamps ─────

test('E: the technical-issue message contains signature/occurrence/timestamp operator-context fields', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = `test_format_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await technicalIssues.recordIssue({ type, route: '/api/paypal/capture-order', message: 'simulated failure', method: 'POST', httpStatus: 500, severity: 'WARNING' });

    const call = spy.calls.find((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.ok(call);
    const msg = call.message;
    assert.match(msg, /Event: CUSTOMER_IMPACTING_ERROR/);
    assert.match(msg, new RegExp(`Error-Signature: ${result.signature.slice(0, 16)}`));
    assert.match(msg, /Route: \/api\/paypal\/capture-order/);
    assert.match(msg, /Method: POST/);
    assert.match(msg, /HTTP-Status: 500/);
    assert.match(msg, /Occurrences: 1/);
    assert.match(msg, /First-Seen: \S+/);
    assert.match(msg, /Last-Seen: \S+/);
    assert.match(msg, /Customer-Impact: YES/);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── F. Cooldown re-alert contains the updated occurrence count ─────────

test('F: a cooldown re-alert message reflects the real, updated accumulated occurrence count', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = `test_reaalert_${Math.random().toString(36).slice(2)}`;
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' });
    // Two more occurrences while still in cooldown -- suppressed, but
    // occurrence_count keeps climbing.
    await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' });
    await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' });

    // Backdate to force the cooldown to have elapsed, then re-alert.
    await dbRun(`UPDATE technical_issues SET last_notified_at = datetime('now', '-20 minutes') WHERE signature = ?`, [first.signature]);
    await technicalIssues.recordIssue({ type, route: '/api/x', message: 'm', severity: 'WARNING' });

    const sentCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue' && c.sent);
    assert.equal(sentCalls.length, 2, 'first alert + the re-alert after cooldown, nothing in between');
    assert.match(sentCalls[0].message, /Occurrences: 1/);
    assert.match(sentCalls[1].message, /Occurrences: 4/, 'the re-alert must show the real accumulated count, not reset to 1');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── G. Missing optional fields produce no "undefined"/"null" garbage ───

test('G: missing optional fields (no session, no order) never render as "undefined"/"null" text', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = `test_missingfields_${Math.random().toString(36).slice(2)}`;
  try {
    await technicalIssues.recordIssue({ type, route: '/api/geolocation', message: 'no session or order known here', severity: 'WARNING' });

    const call = spy.calls.find((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.doesNotMatch(call.message, /\bundefined\b/i);
    assert.doesNotMatch(call.message, /\bnull\b/i);
    assert.doesNotMatch(call.message, /Session-ID:\s*(undefined|null)?\s*\n/);
    assert.doesNotMatch(call.message, /Order-ID:/, 'an omitted field must not appear at all, not even with an empty value');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── H. Secrets/raw IP/body fields never appear in notification text ────

test('H: no notification (visitor, paid-order, or issue) ever contains a raw IP address or secret-shaped value', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    await postSessionStart({ visitorId: randomId('vid'), sessionId: randomId('sid'), landingPath: '/', referrer: '', source: '' });
    await technicalIssues.recordIssue({
      type: `test_h_${Math.random().toString(36).slice(2)}`,
      route: '/api/leads',
      message: 'boom',
      sessionId: randomId('sid'),
      severity: 'WARNING',
    });

    const ipLike = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    for (const call of spy.calls) {
      assert.doesNotMatch(call.message, ipLike, `no message may contain an IPv4-shaped string: ${call.eventType}`);
      assert.doesNotMatch(call.message, /TELEGRAM_BOT_TOKEN|Authorization|Bearer |password|api[_-]?key/i, `no message may contain secret-shaped text: ${call.eventType}`);
    }
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── I. Unusual user-controlled characters cannot break formatting ──────

test('I: HTML-breaking, newline-injecting, and very long user-controlled values cannot break message formatting', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const adversarialMessage = '<b>bold-injection</b> & "quotes" \'ticks\'\nFake-Field: injected\n'.repeat(3) + 'x'.repeat(1000);
  const type = `test_adversarial_${Math.random().toString(36).slice(2)}`;
  try {
    await assert.doesNotReject(() => technicalIssues.recordIssue({ type, route: '/api/x', message: adversarialMessage, severity: 'WARNING' }));

    const call = spy.calls.find((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.ok(call);
    // The raw injected tag must never appear unescaped.
    assert.doesNotMatch(call.message, /<b>bold-injection<\/b>/);
    assert.match(call.message, /&lt;b&gt;bold-injection&lt;\/b&gt;/, 'the tag must be HTML-escaped, not stripped silently');
    // A newline embedded in a VALUE must not be able to fake a new field
    // line inside the <pre> block.
    assert.doesNotMatch(call.message, /\nFake-Field: injected\n/);
    // Overall message must still be bounded, not unbounded by a huge value.
    assert.ok(call.message.length < 5000, `message must stay bounded, got length ${call.message.length}`);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── J. Telegram failure still cannot break business flow ───────────────

test('J: a Telegram/notify failure during message formatting+send never throws out of the calling code', async () => {
  const failingNotify = mock.method(ownerNotifications, 'notify', async () => { throw new Error('simulated Telegram outage'); });
  try {
    await assert.doesNotReject(() => technicalIssues.recordIssue({ type: `test_j_${Math.random().toString(36).slice(2)}`, route: '/api/x', message: 'm', severity: 'WARNING' }));
    await assert.doesNotReject(() => recordCustomerFacing5xxIssue(new Error('x'), { path: '/api/products', url: '/api/products', method: 'GET', body: {} }));
  } finally {
    failingNotify.mock.restore();
  }
});

// ── K. No new direct operational Telegram bypass exists ────────────────

test('K: the global error handler no longer sends a raw telegram.sendMessage for any path -- everything routes through owner-notifications.notify', async () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const handlerStart = indexSource.indexOf('// Global Error Handler');
  assert.ok(handlerStart >= 0, 'the global error handler must still exist');
  const handlerEnd = indexSource.indexOf('\n});', handlerStart) + 4;
  const handlerBody = indexSource.slice(handlerStart, handlerEnd);

  assert.doesNotMatch(handlerBody, /telegram\.sendMessage\(/, 'the global handler must not call telegram.sendMessage directly anymore');
  assert.match(handlerBody, /ownerNotifications\.notify\(/, 'the non-customer-facing branch must route through owner-notifications.notify');
  assert.match(handlerBody, /recordCustomerFacing5xxIssue/, 'the customer-facing branch must route through the structured issue pipeline');
});

// ── L. Durable issue dedupe across restart/reinitialization ────────────

test('L: durable issue dedupe suppresses repeat alerts across in-memory state reset (simulated process restart)', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  const type = `test_restart_${Math.random().toString(36).slice(2)}`;
  try {
    const first = await technicalIssues.recordIssue({ type, route: '/api/checkout', message: 'gateway timeout', severity: 'WARNING' });
    assert.equal(first.occurrenceCount, 1);
    assert.equal(first.notifiedCount, 1);

    // Simulate process restart: reset in-memory state in ownerNotifications
    ownerNotifications._resetForTests();

    // Second occurrence immediately after "restart" — should still be suppressed by durable SQLite last_notified_at
    const second = await technicalIssues.recordIssue({ type, route: '/api/checkout', message: 'gateway timeout', severity: 'WARNING' });
    assert.equal(second.occurrenceCount, 2);
    assert.equal(second.notifiedCount, 1, 'notification count must not increase after restart during cooldown');

    const sentCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue' && c.sent);
    assert.equal(sentCalls.length, 1, 'only one notification sent across simulated restart');
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── M. Meaningful customer-facing 5xx recording ────────────────────────

test('M: customer-facing 5xx error captures structured issue with route, method, status and notifies owner', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const req = { path: '/api/products', url: '/api/products', method: 'GET', body: { sessionId: 'sid_customer_5xx_test' } };
    const result = await recordCustomerFacing5xxIssue(new TypeError('Cannot read properties of undefined'), req);
    assert.equal(result.recorded, true);
    assert.equal(result.notifiedCount, 1);

    const call = spy.calls.find((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.ok(call, 'customer_impacting_technical_issue notification was triggered');
    assert.match(call.message, /Event: CUSTOMER_IMPACTING_ERROR/);
    assert.match(call.message, /Route: \/api\/products/);
    assert.match(call.message, /Method: GET/);
    assert.match(call.message, /HTTP-Status: 500/);
    assert.match(call.message, /Session-ID: sid_customer_5xx_test/);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── N. Repeated 5xx dedupe ──────────────────────────────────────────────

test('N: repeated customer-facing 5xx increments occurrence count but dedupes alert notifications', async () => {
  const telegramMock = installGenuineTelegramDelivery();
  const spy = installNotifySpy();
  try {
    const req = { path: '/api/coupons/active', url: '/api/coupons/active', method: 'GET', body: {} };
    const err = new Error('Database locked');

    const res1 = await recordCustomerFacing5xxIssue(err, req);
    const res2 = await recordCustomerFacing5xxIssue(err, req);
    const res3 = await recordCustomerFacing5xxIssue(err, req);

    assert.equal(res3.occurrenceCount, 3);
    assert.equal(res3.notifiedCount, 1);
    const issueCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.equal(issueCalls.length, 1);
  } finally {
    spy.restore();
    telegramMock.mock.restore();
  }
});

// ── O. Harmless 404/400 suppression ────────────────────────────────────

test('O: harmless 404 not found and 400 bad request do not trigger customer-impacting issue alerts', async () => {
  const spy = installNotifySpy();
  try {
    const res404 = await fetch(`${baseUrl}/api/nonexistent-endpoint-${Date.now()}`);
    assert.equal(res404.status, 404);

    const res400 = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res400.status, 400);

    const issueCalls = spy.calls.filter((c) => c.eventType === 'customer_impacting_technical_issue');
    assert.equal(issueCalls.length, 0, 'no issue alert must be sent for 404 or 400');
  } finally {
    spy.restore();
  }
});
