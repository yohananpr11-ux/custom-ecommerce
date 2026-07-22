// Paid-order end-to-end readiness suite.
//
// Exercises the REAL production entry points -- the real Express `app`
// (booted on an ephemeral loopback port, exactly like production's
// `node index.js`), the real /api/paypal/create-order and
// /api/paypal/capture-order routes, the real processPaidOrderFulfillment(),
// the real services/fulfillment.js routing, and the real
// services/printify.js reconciliation logic -- with only the network
// boundary mocked: axios.post (PayPal/PayPlus REST calls) and the
// printify singleton's own HTTP-calling methods are intercepted via
// node:test's mock.method(), the same technique already used throughout
// printify-fulfillment-reconciliation.test.js and observability.test.js.
// The repository network guard is additionally preloaded by the test
// runner (see .github/workflows/p0-verify.yml), so any call that somehow
// escaped mocking would be blocked at the socket layer, not just silently
// unmocked.
//
// Uses no real PayPal/PayPlus/Stripe/Printify/Resend/Telegram credentials
// or network calls anywhere. Every customer data value is synthetic
// (Test Customer / test@example.invalid / +15550000000 / Synthetic
// Street 1), never real.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-e2e-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
// Deliberately NOT containing YOUR_/CHANGE_ME/placeholder/example/mock --
// hasConfiguredValue()/hasPayPalCheckoutConfig() in index.js would treat
// any of those substrings as "not configured" and disable the route.
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-e2e';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-e2e';
process.env.PAYPLUS_API_KEY = 'test-payplus-api-key-e2e';
process.env.PAYPLUS_SECRET_KEY = 'test-payplus-secret-key-e2e';
process.env.PAYPLUS_PAGE_UID = 'test-payplus-page-uid-e2e';
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e_not_real';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_e2e_not_real';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app, processPaidOrderFulfillment } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const dropship = require('../services/dropship.js');
const emailService = require('../services/emailService.js');
const telegram = require('../services/telegram.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

let server;
let baseUrl;

test.before(async () => {
  // Give db.js's async schema-migration IIFE time to finish before any
  // test inserts against it (same margin used throughout this suite).
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

// ── HTTP helpers (real requests to the real booted app) ─────────────────────

async function apiPost(pathname, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  return { status: res.status, json, text };
}

async function apiPostRaw(pathname, rawBody, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: rawBody,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  return { status: res.status, json, text };
}

// ── Synthetic fixtures -- never real customer data ──────────────────────────

const SYNTHETIC_SHIPPING = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.invalid',
  firstName: 'Test',
  lastName: 'Customer',
  phone: '+15550000000',
  addressLine1: 'Synthetic Street 1',
  city: 'Faketown',
  postalCode: '00000',
  country: 'US',
  region: 'CA',
};

let nextProductId = 900001;
async function seedPrintifyProduct({ price = 100, stock = 999 } = {}) {
  const id = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `E2E Printify Product ${id}`, 'synthetic e2e fixture', price, price / 3.6, stock, 'printify', 'printify', `pf-e2e-${id}`]
  );
  const variantId = id * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, printifyVariantId, color, size, price, isEnabled, isAvailable) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    [variantId, id, `pf-variant-${id}`, 'Black', 'M', price]
  );
  return { productId: id, variantId, price };
}

async function seedDropshipProduct({ price = 50 } = {}) {
  const id = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `E2E Dropship Product ${id}`, 'synthetic e2e fixture', price, price / 3.6, 999, 'dropship', 'dropship', `cj-e2e-${id}`]
  );
  return { productId: id, price };
}

async function seedDisabledVariant({ price = 100 } = {}) {
  const id = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `E2E Disabled-Variant Product ${id}`, 'synthetic e2e fixture', price, price / 3.6, 999, 'printify', 'printify', `pf-e2e-${id}`]
  );
  const variantId = id * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, printifyVariantId, color, size, price, isEnabled, isAvailable) VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    [variantId, id, `pf-variant-${id}`, 'Red', 'L', price]
  );
  return { productId: id, variantId, price };
}

// ── axios.post mock: PayPal + PayPlus REST endpoints only ───────────────────
//
// A registry keyed by exact URL substring, checked in registration order.
// Any unmatched axios.post call throws instead of silently falling through
// to the real network -- there is no path by which an unmocked call could
// reach api-m.paypal.com/restapi.payplus.co.il for real.

function installAxiosPostMock() {
  const calls = [];
  const handlers = [];

  const mockHandle = mock.method(axios, 'post', async (url, data, config) => {
    calls.push({ url, data, config });
    for (const h of handlers) {
      if (typeof h.match === 'string' ? url.includes(h.match) : h.match(url)) {
        return h.respond(url, data, config);
      }
    }
    throw new Error(`UNEXPECTED axios.post to ${url} -- no test mock matched this call (would otherwise be a real network request)`);
  });

  return {
    calls,
    on(match, respond) { handlers.push({ match, respond }); },
    restore() { mockHandle.mock.restore(); },
  };
}

// PayPal order-id -> { localOrderId, currency, value } captured at
// create-order time, so a later capture call can echo back a coherent,
// self-consistent response (real PayPal behaves this way too).
function installPaypalHappyPathMocks(axiosMock, { captureStatus = 'COMPLETED', overrideCaptureAmount, overrideCaptureCurrency } = {}) {
  const created = new Map();

  axiosMock.on('/v1/oauth2/token', async () => ({
    data: { access_token: 'fake-paypal-access-token-e2e' },
  }));

  axiosMock.on('/v2/checkout/orders', async (url, data) => {
    // create-order (no /capture suffix) vs capture-order (has /capture suffix)
    if (url.endsWith('/capture')) {
      const paypalOrderId = url.split('/checkout/orders/')[1].split('/capture')[0];
      const record = created.get(paypalOrderId);
      if (!record) {
        throw Object.assign(new Error('capture of unknown PayPal order'), { response: { status: 404, data: {} } });
      }
      const amountValue = overrideCaptureAmount !== undefined ? overrideCaptureAmount : record.value;
      const amountCurrency = overrideCaptureCurrency !== undefined ? overrideCaptureCurrency : record.currency;
      return {
        data: {
          status: captureStatus,
          purchase_units: [
            {
              reference_id: record.localOrderId,
              custom_id: record.localOrderId,
              payments: {
                captures: [
                  { id: `CAPTURE-${paypalOrderId}`, amount: { currency_code: amountCurrency, value: String(amountValue) } },
                ],
              },
            },
          ],
        },
      };
    }
    // create-order
    const unit = data.purchase_units[0];
    const paypalOrderId = `PAYPALORDER-${crypto.randomUUID()}`;
    created.set(paypalOrderId, {
      localOrderId: unit.custom_id,
      currency: unit.amount.currency_code,
      value: unit.amount.value,
    });
    return { data: { id: paypalOrderId, status: 'CREATED' } };
  });

  return created;
}

function installPrintifySuccessMocks() {
  const drafts = [];
  const submits = [];
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async ({ externalId }) => {
    const orderId = `pf-order-${drafts.length + 1}-${crypto.randomUUID().slice(0, 8)}`;
    drafts.push({ externalId, orderId });
    return { ok: true, orderId, status: 'on-hold' };
  });
  const getMock = mock.method(printify, 'getPrintifyOrder', async (printifyOrderId) => ({
    ok: true,
    order: { id: printifyOrderId, status: 'on-hold' },
  }));
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => ({
    ok: true, matchCount: 0, order: null,
  }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async (printifyOrderId) => {
    submits.push(printifyOrderId);
    return { ok: true };
  });
  return {
    drafts, submits,
    restore() {
      createMock.mock.restore();
      getMock.mock.restore();
      findMock.mock.restore();
      submitMock.mock.restore();
    },
  };
}

function installDropshipSuccessMock() {
  const calls = [];
  const sendOrderMock = mock.method(dropship, 'sendOrder', async (orderId) => {
    const ref = `CJ-REF-E2E-${orderId}-${crypto.randomUUID().slice(0, 8)}`;
    calls.push({ orderId, ref });
    return { ref };
  });
  return { calls, restore() { sendOrderMock.mock.restore(); } };
}

async function captureConsoleLogs(fn) {
  const lines = [];
  const errLines = [];
  const logMock = mock.method(console, 'log', (...args) => { lines.push(args.join(' ')); });
  const warnMock = mock.method(console, 'warn', (...args) => { lines.push(args.join(' ')); });
  const errorMock = mock.method(console, 'error', (...args) => { errLines.push(args.join(' ')); });
  try {
    await fn();
  } finally {
    logMock.mock.restore();
    warnMock.mock.restore();
    errorMock.mock.restore();
  }
  return { lines, errLines, all: [...lines, ...errLines] };
}

// Waits for the fire-and-forget processPaidOrderFulfillment() call the
// capture route kicks off (never awaited by the route itself, matching
// real production behavior -- the customer gets an immediate response).
async function waitForFulfillmentSettled(orderId, { timeoutMs = 5000, pollMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await dbAll(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [orderId]);
    if (rows.length > 0 && rows.every((r) => r.fulfillment_status && r.fulfillment_status !== 'pending' && r.fulfillment_status !== 'processing')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

module.exports = {
  apiPost, apiPostRaw, dbRun, dbGet, dbAll,
  SYNTHETIC_SHIPPING, seedPrintifyProduct, seedDropshipProduct, seedDisabledVariant,
  installAxiosPostMock, installPaypalHappyPathMocks, installPrintifySuccessMocks,
  captureConsoleLogs, waitForFulfillmentSettled,
  getBaseUrl: () => baseUrl,
};

// ── 1. Happy-path paid order ─────────────────────────────────────────────────

test('happy path: real checkout payload -> create-order -> capture -> paid order -> fulfillment -> confirmation', async () => {
  const product = await seedPrintifyProduct({ price: 120 });
  const axiosMock = installAxiosPostMock();
  const created = installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();

  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    assert.equal(createRes.status, 200, `create-order must succeed; got ${createRes.status}: ${createRes.text}`);
    assert.equal(createRes.json.success, true);
    const { orderID: paypalOrderId, orderId: localOrderId } = createRes.json;
    assert.ok(paypalOrderId);
    assert.ok(localOrderId);

    const orderBeforeCapture = await dbGet(`SELECT status FROM orders WHERE id = ?`, [localOrderId]);
    assert.equal(orderBeforeCapture.status, 'pending_payment', 'order must not be paid before capture');

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: paypalOrderId });
    assert.equal(captureRes.status, 200, `capture must succeed; got ${captureRes.status}: ${captureRes.text}`);
    assert.equal(captureRes.json.success, true);
    assert.equal(captureRes.json.orderId, localOrderId);

    const orderAfterCapture = await dbGet(`SELECT status FROM orders WHERE id = ?`, [localOrderId]);
    assert.equal(orderAfterCapture.status, 'paid');

    const items = await dbAll(`SELECT * FROM order_items WHERE orderId = ?`, [localOrderId]);
    assert.equal(items.length, 1);

    await waitForFulfillmentSettled(localOrderId);

    const itemAfter = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [localOrderId]);
    assert.equal(itemAfter.fulfillment_status, 'submitted', 'item must be fulfilled through the real routing/printify path');

    const supplierFulfillment = await dbGet(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [localOrderId]);
    assert.ok(supplierFulfillment, 'exactly one supplier_fulfillments row must exist');
    assert.equal(supplierFulfillment.state, 'submitted');

    assert.equal(printifyMock.drafts.length, 1, 'exactly one Printify draft created');
    assert.equal(printifyMock.submits.length, 1, 'exactly one Printify send-to-production call');

    const orderRow = await dbGet(`SELECT emailSent FROM orders WHERE id = ?`, [localOrderId]);
    assert.equal(orderRow.emailSent, 1, 'confirmation email must be marked sent (mocked/no-network Resend path)');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
  }
});

// ── 9/10/11/12. Payment trust boundary: client manipulation is rejected ─────

test('trust boundary: client-supplied price is ignored -- server price is always used', async () => {
  const product = await seedPrintifyProduct({ price: 200 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M', price: 0.01 }],
      currency: 'ILS',
    });
    assert.equal(createRes.status, 200);
    const item = await dbGet(`SELECT price FROM order_items WHERE orderId = ?`, [createRes.json.orderId]);
    assert.equal(item.price, 200, 'stored price must be the trusted server price, never the client-supplied 0.01');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: client-supplied currency outside the supported set is coerced to a safe default, never trusted verbatim', async () => {
  const product = await seedPrintifyProduct({ price: 100 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'XYZ',
    });
    assert.equal(createRes.status, 200);
    // normalizePayPalCurrency() falls back to ILS for anything outside
    // {USD, ILS} -- never an attacker-chosen currency string reaching the
    // PayPal order payload or the stored expectation.
    assert.equal(createRes.json.currency, 'ILS');
    const order = await dbGet(`SELECT expected_payment_currency FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.expected_payment_currency, 'ILS');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: unknown product id is rejected before any order is created', async () => {
  const res = await apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    items: [{ id: 999999999, quantity: 1 }],
    currency: 'ILS',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /not found/i);
});

test('trust boundary: disabled/nonexistent variant is rejected before any order is created', async () => {
  const product = await seedDisabledVariant();
  const res = await apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    items: [{ id: product.productId, quantity: 1, selectedColor: 'Red', selectedSize: 'L' }],
    currency: 'ILS',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /variant mismatch/i);
});

test('trust boundary: zero or negative quantity is clamped to a safe minimum, never used to under-price the order', async () => {
  const product = await seedPrintifyProduct({ price: 100 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const zeroRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 0, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    assert.equal(zeroRes.status, 200);
    const zeroItem = await dbGet(`SELECT quantity FROM order_items WHERE orderId = ?`, [zeroRes.json.orderId]);
    assert.equal(zeroItem.quantity, 1, 'quantity=0 must never result in a free/zero-quantity line item');

    const negRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: -5, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    assert.equal(negRes.status, 200);
    const negItem = await dbGet(`SELECT quantity FROM order_items WHERE orderId = ?`, [negRes.json.orderId]);
    assert.equal(negItem.quantity, 1, 'negative quantity must never propagate into a negative-priced order');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: missing shipping details are rejected, no order created', async () => {
  const product = await seedPrintifyProduct();
  const res = await apiPost('/api/paypal/create-order', {
    customerName: '', customerEmail: '', address: '',
    items: [{ id: product.productId, quantity: 1 }],
    currency: 'ILS',
  });
  assert.equal(res.status, 400);
});

test('shipping boundary: an otherwise-valid but Printify-unsupported destination country is rejected before any order is created', async () => {
  const product = await seedPrintifyProduct();
  const ordersBefore = await dbGet(`SELECT COUNT(*) AS n FROM orders`);
  const res = await apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    country: 'CN', // a real ISO code, deliberately not in PRINTIFY_SUPPORTED_COUNTRIES
    items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
    currency: 'ILS',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /valid shipping country/i);
  const ordersAfter = await dbGet(`SELECT COUNT(*) AS n FROM orders`);
  assert.equal(ordersAfter.n, ordersBefore.n, 'no order row of any status should be created for a rejected destination');
});

test('trust boundary: payment amount lower than expected is rejected, order never marked paid', async () => {
  const product = await seedPrintifyProduct({ price: 300 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock, { overrideCaptureAmount: '1.00' });
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
    assert.equal(order.status, 'pending_payment', 'a low-amount capture must never transition the order to paid');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: payment amount higher than expected is rejected, order never marked paid', async () => {
  const product = await seedPrintifyProduct({ price: 300 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock, { overrideCaptureAmount: '99999.00' });
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 400);
    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'pending_payment');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: captured currency different from expected is rejected, order never marked paid', async () => {
  const product = await seedPrintifyProduct({ price: 150 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock, { overrideCaptureCurrency: 'USD' });
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 400);
    assert.match(captureRes.json.error, /currency/i);
    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'pending_payment');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: pending/non-final PayPal capture status is rejected, order never marked paid', async () => {
  const product = await seedPrintifyProduct({ price: 80 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock, { captureStatus: 'PENDING' });
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.status, 400);
    assert.match(captureRes.json.error, /not completed/i);
    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'pending_payment');
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: client-supplied shipping cost has no effect -- the server computes shipping from server-trusted item totals only', async () => {
  const product = await seedPrintifyProduct({ price: 100 });
  const axiosMock = installAxiosPostMock();
  const created = installPaypalHappyPathMocks(axiosMock);
  try {
    const honestRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const tamperedRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
      shippingCost: 0,
      shipping: 0,
    });
    assert.equal(honestRes.json.amount, tamperedRes.json.amount, 'an extra client-supplied shipping field must have zero effect on the server-computed total');
    void created;
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: capturing a PayPal order ID never created by our own server is rejected, no order affected', async () => {
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const res = await apiPost('/api/paypal/capture-order', { orderID: 'FOREIGN-PAYPAL-ORDER-NEVER-CREATED-BY-US' });
    assert.equal(res.status, 500, 'capturing an order our server never created must fail, never succeed');
    assert.notEqual(res.json && res.json.success, true);
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: client cannot redirect a payment to a different provider identifier than the server issued', async () => {
  // The only "provider identifier" a client supplies is the PayPal orderID
  // returned by OUR OWN create-order call -- there is no field anywhere in
  // capture-order's request body the client could use to select a
  // different merchant/account/credential. Confirms the capture route
  // ignores any such extra field rather than trusting it.
  const product = await seedPrintifyProduct({ price: 40 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const res = await apiPost('/api/paypal/capture-order', {
      orderID: createRes.json.orderID,
      // Attacker-supplied extra fields attempting to influence provider/merchant selection.
      merchantId: 'ATTACKER-CONTROLLED-MERCHANT-ID',
      clientId: 'ATTACKER-CONTROLLED-CLIENT-ID',
      provider: 'attacker-provider',
    });
    assert.equal(res.json.success, true, 'the legitimate capture must still succeed');
    // The mock only ever used server-held credentials (PAYPAL_CLIENT_ID/SECRET
    // from process.env) to obtain its access token -- there is no code path
    // by which any of the extra body fields above could have been read.
  } finally {
    axiosMock.restore();
  }
});

test('trust boundary: a webhook with no signature header at all is rejected the same as a forged one (Stripe)', async () => {
  const payload = JSON.stringify({ id: 'evt_no_sig', type: 'checkout.session.completed', data: { object: {} } });
  const res = await apiPostRaw('/api/webhooks/stripe', payload, {});
  assert.equal(res.status, 400);
});

test('trust boundary: a webhook with no signature header at all is rejected the same as a forged one (PayPlus)', async () => {
  const payload = JSON.stringify({ transaction_uid: 'no-sig-txn', status: 'success', custom_field: '1' });
  const res = await apiPostRaw('/api/webhooks/payplus', payload, {});
  assert.equal(res.status, 400);
});

test('trust boundary: forged Stripe webhook (bad signature) is rejected, no fulfillment triggered', async () => {
  const product = await seedPrintifyProduct({ price: 90 });
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, 'pending_payment')`,
    [SYNTHETIC_SHIPPING.customerName, SYNTHETIC_SHIPPING.customerEmail, 'addr', 90]
  );
  const order = await dbGet(`SELECT id FROM orders ORDER BY id DESC LIMIT 1`);
  const forgedPayload = JSON.stringify({
    id: 'evt_forged', type: 'checkout.session.completed',
    data: { object: { client_reference_id: String(order.id), amount_total: 9000, currency: 'ils' } },
  });
  const res = await apiPostRaw('/api/webhooks/stripe', forgedPayload, { 'stripe-signature': 'forged-signature-not-real' });
  assert.equal(res.status, 400, 'a forged/invalid Stripe signature must be rejected');
  const orderAfter = await dbGet(`SELECT status FROM orders WHERE id = ?`, [order.id]);
  assert.equal(orderAfter.status, 'pending_payment', 'a forged webhook must never mark the order paid');
  void product;
});

test('trust boundary: PayPlus webhook with an invalid HMAC signature is rejected, no fulfillment triggered', async () => {
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, 'pending_payment')`,
    [SYNTHETIC_SHIPPING.customerName, SYNTHETIC_SHIPPING.customerEmail, 'addr', 90]
  );
  const order = await dbGet(`SELECT id FROM orders ORDER BY id DESC LIMIT 1`);
  const forgedPayload = JSON.stringify({ transaction_uid: 'forged-txn', status: 'success', custom_field: String(order.id) });
  const res = await apiPostRaw('/api/webhooks/payplus', forgedPayload, { hash: Buffer.from('not-a-real-hmac').toString('base64') });
  assert.equal(res.status, 401);
  const orderAfter = await dbGet(`SELECT status FROM orders WHERE id = ?`, [order.id]);
  assert.equal(orderAfter.status, 'pending_payment');
});

test('trust boundary: a valid-looking client success redirect with no verified server payment never marks an order paid', async () => {
  // The frontend only navigates to /success client-side after capturePayPalOrder()
  // resolves -- there is no backend route a browser can hit to mark an order
  // paid purely by visiting a URL. Confirms no such route exists.
  const product = await seedPrintifyProduct();
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const res = await fetch(`${baseUrl}/api/orders/${createRes.json.orderId}/mark-paid`, { method: 'POST' });
    assert.equal(res.status, 404, 'no client-reachable "mark paid" endpoint must exist');
    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'pending_payment');
  } finally {
    axiosMock.restore();
  }
});

// ── 6. Idempotency ────────────────────────────────────────────────────────────

test('idempotency: the same PayPal capture delivered twice results in exactly one paid transition and one fulfillment', async () => {
  const product = await seedPrintifyProduct({ price: 60 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const first = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(first.json.success, true);
    assert.notEqual(first.json.duplicate, true);
    await waitForFulfillmentSettled(createRes.json.orderId);

    const second = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(second.json.success, true);
    assert.equal(second.json.duplicate, true, 'second identical capture must be recognized as a duplicate');

    await new Promise((resolve) => setTimeout(resolve, 300));

    const supplierRows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ?`, [createRes.json.orderId]);
    assert.equal(supplierRows.length, 1, 'exactly one supplier_fulfillments row per supplier');
    assert.equal(printifyMock.drafts.length, 1, 'at most one Printify draft creation');
    assert.equal(printifyMock.submits.length, 1, 'at most one Printify production submission');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
  }
});

test('idempotency: two concurrent captures of the same transaction still produce exactly one paid order and one fulfillment', async () => {
  const product = await seedPrintifyProduct({ price: 70 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });

    const [r1, r2] = await Promise.all([
      apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID }),
      apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID }),
    ]);

    const successes = [r1, r2].filter((r) => r.json && r.json.success === true && !r.json.duplicate);
    const duplicates = [r1, r2].filter((r) => r.json && r.json.duplicate === true);
    assert.equal(successes.length, 1, 'exactly one of the two concurrent captures must be the real transition');
    assert.equal(duplicates.length, 1, 'the other must be recognized as a duplicate');

    await waitForFulfillmentSettled(createRes.json.orderId);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const supplierRows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ?`, [createRes.json.orderId]);
    assert.equal(supplierRows.length, 1);
    assert.equal(printifyMock.drafts.length, 1);
  } finally {
    axiosMock.restore();
    printifyMock.restore();
  }
});

test('idempotency: two distinct legitimate payments for identical carts each produce their own separate paid order', async () => {
  const product = await seedPrintifyProduct({ price: 55 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  try {
    const itemPayload = { items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }], currency: 'ILS' };
    const createA = await apiPost('/api/paypal/create-order', { ...SYNTHETIC_SHIPPING, ...itemPayload });
    const createB = await apiPost('/api/paypal/create-order', { ...SYNTHETIC_SHIPPING, ...itemPayload });
    assert.notEqual(createA.json.orderId, createB.json.orderId, 'identical carts must still create two distinct local orders');

    const captureA = await apiPost('/api/paypal/capture-order', { orderID: createA.json.orderID });
    const captureB = await apiPost('/api/paypal/capture-order', { orderID: createB.json.orderID });
    assert.equal(captureA.json.success, true);
    assert.equal(captureB.json.success, true);
    assert.notEqual(captureA.json.duplicate, true, 'two genuinely distinct payments must not be treated as duplicates of each other');
    assert.notEqual(captureB.json.duplicate, true);

    await waitForFulfillmentSettled(createA.json.orderId);
    await waitForFulfillmentSettled(createB.json.orderId);

    const supplierA = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ?`, [createA.json.orderId]);
    const supplierB = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ?`, [createB.json.orderId]);
    assert.equal(supplierA.length, 1);
    assert.equal(supplierB.length, 1);
    assert.equal(printifyMock.drafts.length, 2, 'two distinct successful payments must each get their own Printify order');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
  }
});

// ── Mixed supplier + lease states (through the real entry point) ────────────

test('mixed-supplier order: printify and dropship items in one paid order are each routed correctly, exactly once', async () => {
  const printifyProduct = await seedPrintifyProduct({ price: 40 });
  const dropshipProduct = await seedDropshipProduct({ price: 30 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const printifyMock = installPrintifySuccessMocks();
  const dropshipMock = installDropshipSuccessMock();
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [
        { id: printifyProduct.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' },
        { id: dropshipProduct.productId, quantity: 1 },
      ],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true);

    await waitForFulfillmentSettled(createRes.json.orderId);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const items = await dbAll(`SELECT supplier_id, fulfillment_status FROM order_items WHERE orderId = ? ORDER BY id`, [createRes.json.orderId]);
    assert.equal(items.length, 2);
    assert.equal(items.find((i) => i.supplier_id === 'printify').fulfillment_status, 'submitted');
    assert.equal(items.find((i) => i.supplier_id === 'dropship').fulfillment_status, 'submitted');
    assert.equal(printifyMock.drafts.length, 1, 'only the printify item reaches Printify, not the dropship item');
    assert.equal(dropshipMock.calls.length, 1, 'the dropship item reaches the dropship service exactly once');
  } finally {
    axiosMock.restore();
    printifyMock.restore();
    dropshipMock.restore();
  }
});

test('active fulfillment lease: a concurrent retry does not double-dispatch while another invocation is genuinely still working', async () => {
  const product = await seedPrintifyProduct({ price: 65 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);

  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => {
    await gate;
    return { ok: true, orderId: 'pf-lease-order-1', status: 'on-hold' };
  });
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => ({ ok: true, order: { id, status: 'on-hold' } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true);

    // The capture route's own fulfillment call is now blocked on `gate`
    // (still holding the lease). A second, concurrent retry through the
    // exact same real entry point must observe the active lease and not
    // dispatch a second create.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await processPaidOrderFulfillment(createRes.json.orderId, 'Retry');

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(createMock.mock.callCount(), 1, 'an active lease must block a concurrent retry from creating a second Printify order');
  } finally {
    axiosMock.restore();
    createMock.mock.restore();
    getMock.mock.restore();
    submitMock.mock.restore();
  }
});

test('stale fulfillment lease: a genuinely stale (crashed) lease is safely reclaimed and completes exactly once', async () => {
  const product = await seedPrintifyProduct({ price: 45 });
  await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, 'paid')`,
    [SYNTHETIC_SHIPPING.customerName, SYNTHETIC_SHIPPING.customerEmail, 'addr', 45]
  );
  const order = await dbGet(`SELECT id FROM orders ORDER BY id DESC LIMIT 1`);
  await dbRun(
    `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, 1, 45, 'printify', 'processing')`,
    [order.id, product.productId]
  );
  // A stale (>5min old), never-completed 'reconciling' lease -- simulates a
  // crash mid-reconciliation in a previous process.
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, state, updatedAt) VALUES (?, 'printify', ?, 'reconciling', datetime('now', '-10 minutes'))`,
    [order.id, `joakim-order-${order.id}-printify-v1`]
  );

  const printifyMock = installPrintifySuccessMocks();
  try {
    await processPaidOrderFulfillment(order.id, 'Recovery');
    const item = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [order.id]);
    assert.equal(item.fulfillment_status, 'submitted', 'a stale lease must be reclaimed and completed, not left stuck forever');
    assert.equal(printifyMock.drafts.length, 1);
  } finally {
    printifyMock.restore();
  }
});

test('unknown Printify status: a never-before-seen status blocks submission and fails closed to reconcile_required', async () => {
  const product = await seedPrintifyProduct({ price: 55 });
  const axiosMock = installAxiosPostMock();
  installPaypalHappyPathMocks(axiosMock);
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-unknown-status', status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => ({ ok: true, order: { id, status: 'some-totally-new-status-never-seen-before' } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => { throw new Error('must not be called'); });

  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    await waitForFulfillmentSettled(createRes.json.orderId, { timeoutMs: 3000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    const supplierRow = await dbGet(`SELECT state FROM supplier_fulfillments WHERE orderId = ?`, [createRes.json.orderId]);
    assert.equal(supplierRow.state, 'reconcile_required', 'an unrecognized status must fail closed, never be guessed at');
    assert.equal(submitMock.mock.callCount(), 0);
  } finally {
    axiosMock.restore();
    createMock.mock.restore();
    getMock.mock.restore();
    submitMock.mock.restore();
  }
});
