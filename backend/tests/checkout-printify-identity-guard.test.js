// Regression coverage for the printify-identity checkout guard added to
// resolveValidatedOrderItems() (backend/index.js): a type='printify' product
// with a missing/blank printifyId must never reach payment creation. Found
// in production: two local rows silently shared one printifyId; separating
// them left the orphaned row with printifyId=NULL, still type='printify',
// still purchasable -- payment could succeed with no Printify product id to
// ever submit at fulfillment time. This guard closes that class of bug for
// every checkout-creation route (PayPal/Stripe/PayPlus all share
// resolveValidatedOrderItems), not just the specific incident.
//
// Same harness pattern as tests/manual-product-checkout-security.test.js:
// boots the real exported Express app, makes real HTTP requests, mocks only
// axios.post (asserted to throw on any call outside the PayPal
// oauth/checkout endpoints this flow uses).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-printify-identity-guard-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-identity-guard';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-identity-guard';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app } = require('../index.js');
const db = require('../db.js');

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

async function apiPost(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

const SYNTHETIC_SHIPPING = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.invalid',
  firstName: 'Test', lastName: 'Customer', phone: '+15550000000',
  addressLine1: 'Synthetic Street 1', city: 'Faketown', postalCode: '00000', country: 'US', region: 'CA',
};

let nextProductId = 960001;

/** Seeds a type='printify' product + one enabled/available variant. */
async function seedPrintifyProduct({ printifyId = 'live-pf-id-12345', price = 149.9, stock = 999 } = {}) {
  const productId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId)
     VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [productId, '[TEST] Printify Identity Guard Fixture', 'synthetic fixture', price, stock, printifyId]
  );
  const variantId = productId * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, printifyVariantId, color, size, price, isEnabled, isAvailable, stockQty)
     VALUES (?, ?, 'pv-1', 'Default', 'OS', ?, 1, 1, ?)`,
    [variantId, productId, price, stock]
  );
  return { productId, variantId, price };
}

function printifyItemPayload(product, overrides = {}) {
  return {
    id: product.productId,
    quantity: 1,
    selectedColor: 'Default',
    selectedSize: 'OS',
    ...overrides,
  };
}

function installPaypalHappyPathMocks() {
  const created = new Map();
  const mockHandle = mock.method(axios, 'post', async (url, data) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.includes('/v2/checkout/orders')) {
      if (url.endsWith('/capture')) {
        const paypalOrderId = url.split('/checkout/orders/')[1].split('/capture')[0];
        const record = created.get(paypalOrderId);
        if (!record) throw new Error(`test harness: capture called for unknown PayPal order id ${paypalOrderId}`);
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
      const paypalOrderId = `PPO-${crypto.randomUUID()}`;
      created.set(paypalOrderId, { localOrderId: unit.custom_id, currency: unit.amount.currency_code, value: unit.amount.value });
      return { data: { id: paypalOrderId, status: 'CREATED' } };
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });
  return { restore() { mockHandle.mock.restore(); } };
}

async function createOrder(items) {
  return apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    items,
    currency: 'ILS',
  });
}

async function ordersCount() {
  return (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
}
async function orderItemsCount() {
  return (await dbGet(`SELECT COUNT(*) AS n FROM order_items`)).n;
}

// ═══════════════════════════════════════════════════════════════════════════
// A/B/C — missing/blank printifyId is rejected
// ═══════════════════════════════════════════════════════════════════════════

test('A: printifyId=NULL on a type=printify product is rejected, not silently accepted', async () => {
  const product = await seedPrintifyProduct({ printifyId: null });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const ordersBefore = await ordersCount();
    const itemsBefore = await orderItemsCount();
    const res = await createOrder([printifyItemPayload(product)]);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not currently available/i);
    // must not leak *why* -- no mention of printify/duplicate/sync internals
    assert.doesNotMatch(res.json.error, /printify|duplicate|sync/i);
    assert.equal(await ordersCount(), ordersBefore, 'no order row for a rejected checkout attempt');
    assert.equal(await orderItemsCount(), itemsBefore, 'no order_items row for a rejected checkout attempt');
  } finally {
    paypalMock.restore();
  }
});

test('B: printifyId=\'\' (empty string) on a type=printify product is rejected', async () => {
  const product = await seedPrintifyProduct({ printifyId: '' });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder([printifyItemPayload(product)]);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not currently available/i);
  } finally {
    paypalMock.restore();
  }
});

test('C: whitespace-only printifyId on a type=printify product is rejected', async () => {
  const product = await seedPrintifyProduct({ printifyId: '   ' });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder([printifyItemPayload(product)]);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not currently available/i);
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// D — a genuinely valid Printify product still checks out
// ═══════════════════════════════════════════════════════════════════════════

test('D: a type=printify product with a real printifyId still checks out successfully (no regression)', async () => {
  const product = await seedPrintifyProduct({ printifyId: 'live-pf-id-real-12345' });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder([printifyItemPayload(product)]);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json && res.json.success, true);
    assert.ok(res.json && res.json.orderID, 'expected a PayPal order id back');
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// E — mixed cart: one broken item rejects the whole checkout
// ═══════════════════════════════════════════════════════════════════════════

test('E: a mixed cart with one broken printify item (no printifyId) rejects the entire checkout, not just that item', async () => {
  const broken = await seedPrintifyProduct({ printifyId: null });
  const valid = await seedPrintifyProduct({ printifyId: 'live-pf-id-valid-99999' });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const ordersBefore = await ordersCount();
    const itemsBefore = await orderItemsCount();
    const res = await createOrder([printifyItemPayload(broken), printifyItemPayload(valid)]);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not currently available/i);
    assert.equal(await ordersCount(), ordersBefore, 'no order row for any item in a rejected mixed cart');
    assert.equal(await orderItemsCount(), itemsBefore, 'no order_items rows for any item in a rejected mixed cart, including the otherwise-valid one');
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// G — the manual/local product flow is unaffected by this guard
// ═══════════════════════════════════════════════════════════════════════════

test('G: a type=local/supplier_id=manual product is unaffected by the printify-identity guard', async () => {
  const productId = nextProductId++;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, access_token_hash, access_token_expires_at)
     VALUES (?, ?, ?, ?, ?, 'local', 'manual', ?, ?)`,
    [productId, '[TEST] Manual product unaffected by printify guard', 'synthetic fixture', 5, 1, tokenHash, expiresAt]
  );
  const variantId = productId * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, color, size, price, isEnabled, isAvailable, stockQty) VALUES (?, ?, 'Default', 'OS', ?, 1, 1, ?)`,
    [variantId, productId, 5, 1]
  );

  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder([{
      id: productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: rawToken,
    }]);
    assert.equal(res.status, 200, JSON.stringify(res.json));
  } finally {
    paypalMock.restore();
  }
});
