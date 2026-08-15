// Paid-purchase owner notification (PR #34): the PayPal capture-order route
// now sends exactly one owner-notifications.js alert per genuinely new paid
// order (replacing the previous two separate direct Telegram sends), with
// no duplicate on a PayPal retry or a second capture call, and payment
// truth/order success is fully independent of notification success.
//
// Same real-app harness pattern as paid-order-notifications.test.js --
// separate process/file, isolated temp DB. No real PayPal/Telegram network.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-owner-notification-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-owner-notif';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-owner-notif';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-owner-notif';

const { app } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const ownerNotifications = require('../services/owner-notifications.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
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

async function apiPost(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const SYNTHETIC_SHIPPING = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.invalid',
  firstName: 'Test', lastName: 'Customer', phone: '+15550000000',
  addressLine1: 'Synthetic Street 1', city: 'Faketown', postalCode: '00000', country: 'US', region: 'CA',
};

let nextProductId = 920001;
async function seedPrintifyProduct({ price = 100 } = {}) {
  const id = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `Owner Notif Test Product ${id}`, 'synthetic fixture', price, price / 3.6, 999, 'printify', 'printify', `pf-owner-notif-${id}`]
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

async function createAndCapture({ price = 77 } = {}) {
  const product = await seedPrintifyProduct({ price });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  const createRes = await apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
    currency: 'ILS',
  });
  return { createRes, axiosMock, printifyMock };
}

// ── H. Successful paid order => one owner notification ─────────────────

test('H: a successful paid order sends exactly one paid_purchase owner notification with real order data', async () => {
  const spy = installNotifySpy();
  const { createRes, axiosMock, printifyMock } = await createAndCapture({ price: 55 });
  try {
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 200);
    assert.equal(captureRes.json.success, true);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const paidCalls = spy.calls.filter((c) => c.eventType === 'paid_purchase' && c.sent);
    assert.equal(paidCalls.length, 1, 'exactly one paid_purchase notification');
    assert.equal(paidCalls[0].dedupKey, `paid_purchase:order:${createRes.json.orderId}`);
    assert.match(paidCalls[0].message, new RegExp(`#${createRes.json.orderId}\\b`), 'message must reference the real order id');

    // Compare against the REAL persisted total/customer/item rather than
    // assuming a value -- proves the message reflects actual DB/payment
    // data (never invented), independent of exactly how pricing/shipping
    // computed the final captured amount.
    const order = await dbGet(`SELECT customerName, totalAmount FROM orders WHERE id = ?`, [createRes.json.orderId]);
    const items = await new Promise((resolve, reject) => {
      db.all(`SELECT oi.*, p.title FROM order_items oi LEFT JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`, [createRes.json.orderId], (err, rows) => (err ? reject(err) : resolve(rows)));
    });
    assert.match(paidCalls[0].message, new RegExp(Number(order.totalAmount).toFixed(2).replace('.', '\\.')), 'message must reference the real persisted total');
    assert.match(paidCalls[0].message, new RegExp(order.customerName));
    assert.match(paidCalls[0].message, new RegExp(items[0].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    axiosMock.restore();
    printifyMock.restore();
    spy.restore();
  }
});

// ── I. Repeated capture/idempotent replay => no duplicate ──────────────

test('I: a second capture call for the same already-paid order sends no duplicate notification', async () => {
  const spy = installNotifySpy();
  const { createRes, axiosMock, printifyMock } = await createAndCapture({ price: 41 });
  try {
    const first = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(first.json.success, true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const second = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(second.json.success, true);
    assert.equal(second.json.duplicate, true, 'the route itself must recognize this as a duplicate');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const paidCalls = spy.calls.filter((c) => c.eventType === 'paid_purchase' && c.sent);
    assert.equal(paidCalls.length, 1, 'a duplicate capture call must never trigger a second owner notification');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
    spy.restore();
  }
});

// ── J. Failed payment => no paid-order notification ─────────────────────

test('J: a PayPal capture that does not complete sends no paid_purchase notification', async () => {
  const spy = installNotifySpy();
  const product = await seedPrintifyProduct({ price: 62 });
  const axiosMock = installAxiosPostMock();
  const created = new Map();
  axiosMock.on('/v1/oauth2/token', async () => ({ data: { access_token: 'fake-token' } }));
  axiosMock.on('/v2/checkout/orders', async (url, data) => {
    if (url.endsWith('/capture')) {
      return { data: { status: 'DECLINED', purchase_units: [] } }; // simulated failed payment
    }
    const unit = data.purchase_units[0];
    const paypalOrderId = `PPO-${Math.random().toString(36).slice(2)}`;
    created.set(paypalOrderId, { localOrderId: unit.custom_id });
    return { data: { id: paypalOrderId, status: 'CREATED' } };
  });
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 400);
    assert.equal(captureRes.json.success, false);

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.notEqual(order.status, 'paid', 'a declined payment must never mark the order paid');

    const paidCalls = spy.calls.filter((c) => c.eventType === 'paid_purchase');
    assert.equal(paidCalls.length, 0, 'a failed/declined payment must never send a paid_purchase notification');
  } finally {
    axiosMock.restore();
    spy.restore();
  }
});

// ── K. Telegram failure => paid order remains successful ────────────────

test('K: an owner-notification failure never affects the capture response or the order/fulfillment truth', async () => {
  const failingNotify = mock.method(ownerNotifications, 'notify', async () => { throw new Error('simulated Telegram outage'); });
  const { createRes, axiosMock, printifyMock } = await createAndCapture({ price: 83 });
  try {
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 200, 'the capture response itself must succeed even if the owner notification throws');
    assert.equal(captureRes.json.success, true);

    await new Promise((resolve) => setTimeout(resolve, 400));

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'paid', 'payment truth must be unaffected by a notification failure');

    const item = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [createRes.json.orderId]);
    assert.equal(item.fulfillment_status, 'submitted', 'fulfillment must be unaffected by a notification failure');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
    failingNotify.mock.restore();
  }
});
