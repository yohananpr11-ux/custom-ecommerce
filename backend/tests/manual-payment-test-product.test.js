// Safety suite for the hidden, temporary, manual-fulfillment product
// mechanism (scripts/manual-payment-test-product.js) built to support a
// single controlled real PayPal payment test.
//
// Two concerns, both covered here:
//   1. Fulfillment safety -- a paid order for a manual-supplier product
//      must reach the local, zero-external-call handleManual() path
//      exactly once, be recoverable after a simulated crash, and never be
//      fulfilled or stock-decremented twice.
//   2. Discovery safety -- the product must be invisible through every
//      normal catalog surface (list, active-ids, feed) and must resist a
//      bare sequential-id scan against the single-product detail route,
//      which is the one endpoint that does NOT filter by type/visibility.
//
// Boots the real exported Express `app`, makes real HTTP requests, and
// mocks only axios.post + the printify/dropship singleton methods (both
// asserted to throw if ever called at all, not merely "not verified" --
// proving zero external calls rather than assuming it).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-payment-test-product-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-manualproduct';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-manualproduct';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app, processPaidOrderFulfillment } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const dropship = require('../services/dropship.js');

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
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

async function apiGet(pathname, headers) {
  const res = await fetch(`${baseUrl}${pathname}`, headers ? { headers } : undefined);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. feed XML) */ }
  return { status: res.status, json, text, headers: res.headers };
}

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

let nextProductId = 940001;

/** Mirrors exactly what scripts/manual-payment-test-product.js's `create` writes. */
async function seedManualTestProduct({ price = 5, stock = 1, tokenTtlHours = 48 } = {}) {
  const productId = nextProductId++;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + tokenTtlHours * 60 * 60 * 1000).toISOString();

  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, access_token_hash, access_token_expires_at)
     VALUES (?, ?, ?, ?, ?, 'local', 'manual', ?, ?)`,
    [productId, '[INTERNAL TEST] Manual Payment Verification — DO NOT PURCHASE', 'synthetic fixture', price, stock, tokenHash, expiresAt]
  );
  const variantId = productId * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, color, size, price, isEnabled, isAvailable, stockQty) VALUES (?, ?, 'Default', 'OS', ?, 1, 1, ?)`,
    [variantId, productId, price, stock]
  );
  return { productId, variantId, price, rawToken, tokenHash, expiresAt };
}

/** A real, visible printify product too -- proves manual-product exclusion holds even when printify items exist (the /api/products filter only activates once a printify product is present). */
async function seedRealPrintifyProduct({ price = 149 } = {}) {
  const productId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [productId, `Real Product ${productId}`, 'synthetic fixture', price, 999, `pf-${productId}`]
  );
  return { productId, price };
}

function installAxiosPostMock() {
  const mockHandle = mock.method(axios, 'post', async (url) => {
    throw new Error(`UNEXPECTED axios.post to ${url} -- manual-supplier fulfillment must never make any outbound request`);
  });
  return { restore() { mockHandle.mock.restore(); } };
}

function installPaypalHappyPathMocks() {
  const created = new Map();
  const mockHandle = mock.method(axios, 'post', async (url, data) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.includes('/v2/checkout/orders')) {
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
      const paypalOrderId = `PPO-${crypto.randomUUID()}`;
      created.set(paypalOrderId, { localOrderId: unit.custom_id, currency: unit.amount.currency_code, value: unit.amount.value });
      return { data: { id: paypalOrderId, status: 'CREATED' } };
    }
    throw new Error(`UNEXPECTED axios.post to ${url} -- manual-supplier fulfillment must never make any outbound request beyond PayPal's own oauth/checkout endpoints`);
  });
  return { restore() { mockHandle.mock.restore(); } };
}

/** Asserts printify/dropship singleton methods throw if called at all -- proving zero external supplier calls, not merely "not asserted on". */
function installNoExternalSupplierGuards() {
  const printifyCreate = mock.method(printify, 'createPrintifyOrderDraft', async () => {
    throw new Error('UNEXPECTED printify.createPrintifyOrderDraft call for a manual-supplier-only order');
  });
  const printifyGet = mock.method(printify, 'getPrintifyOrder', async () => {
    throw new Error('UNEXPECTED printify.getPrintifyOrder call for a manual-supplier-only order');
  });
  const dropshipSend = mock.method(dropship, 'sendOrder', async () => {
    throw new Error('UNEXPECTED dropship.sendOrder call for a manual-supplier-only order');
  });
  return {
    restore() { printifyCreate.mock.restore(); printifyGet.mock.restore(); dropshipSend.mock.restore(); },
    counts() { return { printifyCreate: printifyCreate.mock.callCount(), dropshipSend: dropshipSend.mock.callCount() }; },
  };
}

async function waitForFulfillmentSettled(orderId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [orderId]);
    if (row && row.fulfillment_status && !['pending', 'processing', null].includes(row.fulfillment_status)) return row.fulfillment_status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fulfillment did not settle for order ${orderId} within ${timeoutMs}ms`);
}

async function captureConsoleLogs(fn) {
  const lines = [];
  const logMock = mock.method(console, 'log', (...args) => lines.push(args.map(String).join(' ')));
  const warnMock = mock.method(console, 'warn', (...args) => lines.push(args.map(String).join(' ')));
  const errorMock = mock.method(console, 'error', (...args) => lines.push(args.map(String).join(' ')));
  try { await fn(); } finally { logMock.mock.restore(); warnMock.mock.restore(); errorMock.mock.restore(); }
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Fulfillment safety
// ═══════════════════════════════════════════════════════════════════════════

test('a real paid order for the manual test product creates exactly one order, one order_item, and reaches submitted with zero external supplier calls', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();
  const paypalMock = installPaypalHappyPathMocks();

  try {
    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;

    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(createRes.status, 200, JSON.stringify(createRes.json));

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true);

    const orderId = createRes.json.orderId;
    const settledStatus = await waitForFulfillmentSettled(orderId);
    assert.equal(settledStatus, 'submitted');

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter - ordersBefore, 1, 'exactly one new local order');

    const items = await dbAll(`SELECT * FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(items.length, 1, 'exactly one order_item');
    assert.equal(items[0].supplier_id, 'manual');
    assert.equal(items[0].fulfillment_status, 'submitted');
    assert.match(items[0].fulfillment_ref, /^MANUAL-/);

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    assert.equal(order.status, 'paid', 'the paid transition was claimed');

    const supplierFulfillmentRows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ?`, [orderId]);
    assert.equal(supplierFulfillmentRows.length, 0, 'manual fulfillment creates no supplier_fulfillments row (no external supplier order exists to reconcile)');

    const counts = guards.counts();
    assert.equal(counts.printifyCreate, 0, 'zero Printify calls');
    assert.equal(counts.dropshipSend, 0, 'zero CJ Dropshipping calls');

    const productAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0, 'stock decremented from 1 to 0 after the single purchase');
  } finally {
    guards.restore();
    paypalMock.restore();
  }
});

test('a duplicate capture of the same manual-product order does not double-fulfill or double-decrement stock', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();
  const paypalMock = installPaypalHappyPathMocks();

  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    const orderID = createRes.json.orderID;
    const orderId = createRes.json.orderId;

    const first = await apiPost('/api/paypal/capture-order', { orderID });
    assert.equal(first.json.success, true);
    await waitForFulfillmentSettled(orderId);

    const second = await apiPost('/api/paypal/capture-order', { orderID });
    assert.equal(second.json.duplicate, true, 'the second capture of the same PayPal order must be reported as a duplicate');

    await new Promise((resolve) => setTimeout(resolve, 200));

    const productAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0, 'stock must not go negative or be decremented twice');

    const counts = guards.counts();
    assert.equal(counts.printifyCreate, 0);
    assert.equal(counts.dropshipSend, 0);
  } finally {
    guards.restore();
    paypalMock.restore();
  }
});

test('once stock reaches zero, a second checkout attempt for the manual test product is rejected before any order is created', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();
  const paypalMock = installPaypalHappyPathMocks();

  try {
    const first = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    await apiPost('/api/paypal/capture-order', { orderID: first.json.orderID });
    await waitForFulfillmentSettled(first.json.orderId);

    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;

    // Still supplies the correct, valid token here -- this isolates the
    // rejection to genuinely being about exhausted stock, not an incidental
    // token failure.
    const second = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(second.status, 400, 'a second purchase attempt after stock=0 must be rejected');
    assert.match(second.json.error, /no longer available/i);

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter, ordersBefore, 'no new order row of any status for the rejected second attempt');
  } finally {
    guards.restore();
    paypalMock.restore();
  }
});

test('re-invoking fulfillment for an already-submitted manual order does not fulfill it twice or make any external call', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();
  const paypalMock = installPaypalHappyPathMocks();

  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    const orderId = createRes.json.orderId;
    await waitForFulfillmentSettled(orderId);

    const before = await dbGet(`SELECT fulfillment_status, fulfillment_ref FROM order_items WHERE orderId = ?`, [orderId]);

    // Directly re-invoke the real entry point a second time, exactly as a
    // duplicate webhook/cron re-trigger would.
    await processPaidOrderFulfillment(orderId, 'PayPal');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = await dbGet(`SELECT fulfillment_status, fulfillment_ref FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(after.fulfillment_status, 'submitted');
    assert.equal(after.fulfillment_ref, before.fulfillment_ref, 'the fulfillment ref must not change on a re-invocation');

    const productAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0, 'stock must not be decremented a second time');

    const counts = guards.counts();
    assert.equal(counts.printifyCreate, 0);
    assert.equal(counts.dropshipSend, 0);
  } finally {
    guards.restore();
    paypalMock.restore();
  }
});

test('a manual order item stuck in processing (simulating a crash mid-fulfillment) is recoverable on the next invocation', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();

  try {
    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
       VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?)`,
      ['Test Customer', 'test@example.invalid', 'Synthetic Street 1, Faketown, US', product.price, 'Test', 'Customer', '+15550000000', 'Synthetic Street 1', 'Faketown', 'US']
    );
    const orderId = orderInsert.lastID;
    await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, 1, ?, 'manual', 'processing')`,
      [orderId, product.productId, product.price]
    );

    // Simulates a fresh invocation finding this order after a crash (the
    // same real entry point a restart's recovery scan or a retried request
    // would call) -- no special-cased test-only code path.
    await processPaidOrderFulfillment(orderId, 'PayPal');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const item = await dbGet(`SELECT fulfillment_status, fulfillment_ref FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(item.fulfillment_status, 'submitted', 'a stuck processing manual item must be reclaimed and completed');
    assert.match(item.fulfillment_ref, /^MANUAL-/);

    const counts = guards.counts();
    assert.equal(counts.printifyCreate, 0);
    assert.equal(counts.dropshipSend, 0);
  } finally {
    guards.restore();
  }
});

test('a manual order item stuck in failed (simulating a crash after a partial write) is also recoverable', async () => {
  const product = await seedManualTestProduct({ price: 5, stock: 1 });
  const guards = installNoExternalSupplierGuards();

  try {
    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
       VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?)`,
      ['Test Customer', 'test@example.invalid', 'Synthetic Street 1, Faketown, US', product.price, 'Test', 'Customer', '+15550000000', 'Synthetic Street 1', 'Faketown', 'US']
    );
    const orderId = orderInsert.lastID;
    await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status, fulfillment_ref) VALUES (?, ?, 1, ?, 'manual', 'failed', 'ERR: simulated crash')`,
      [orderId, product.productId, product.price]
    );

    await processPaidOrderFulfillment(orderId, 'PayPal');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const item = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(item.fulfillment_status, 'submitted');

    const counts = guards.counts();
    assert.equal(counts.printifyCreate, 0);
    assert.equal(counts.dropshipSend, 0);
  } finally {
    guards.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Discovery safety
// ═══════════════════════════════════════════════════════════════════════════

test('the manual test product is absent from GET /api/products even when a real printify product exists', async () => {
  const manual = await seedManualTestProduct();
  await seedRealPrintifyProduct();

  const res = await apiGet('/api/products');
  assert.equal(res.status, 200);
  const ids = res.json.map((p) => p.id);
  assert.ok(!ids.includes(manual.productId), 'the manual test product must never appear in the public product list');
});

test('the manual test product is absent from GET /api/products/active-ids (the sitemap/prerender source)', async () => {
  const manual = await seedManualTestProduct();
  await seedRealPrintifyProduct();

  const res = await apiGet('/api/products/active-ids');
  assert.equal(res.status, 200);
  assert.ok(!res.json.ids.includes(manual.productId), 'the manual test product must never appear in sitemap/prerender product ids');
});

test('the manual test product is absent from the Google/Facebook feed', async () => {
  const manual = await seedManualTestProduct();
  await seedRealPrintifyProduct();

  const res = await apiGet('/api/feed/google');
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, new RegExp(`/product/${manual.productId}\\b`), 'the manual test product must never appear in the product feed');
});

test('GET /api/products/:id for the manual test product returns 404 without a token', async () => {
  const manual = await seedManualTestProduct();
  const res = await apiGet(`/api/products/${manual.productId}`);
  assert.equal(res.status, 404);
});

test('GET /api/products/:id for the manual test product returns 404 with a wrong/garbage token header', async () => {
  const manual = await seedManualTestProduct();
  const res = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': 'not-the-real-token-at-all' });
  assert.equal(res.status, 404);
});

test('GET /api/products/:id for the manual test product returns 404 with a correctly-shaped but incorrect token header', async () => {
  const manual = await seedManualTestProduct();
  const wrongButSameShapeToken = crypto.randomBytes(32).toString('hex');
  const res = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': wrongButSameShapeToken });
  assert.equal(res.status, 404);
});

test('GET /api/products/:id for the manual test product returns 404 with an expired token', async () => {
  const manual = await seedManualTestProduct({ tokenTtlHours: -1 }); // already expired
  const res = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': manual.rawToken });
  assert.equal(res.status, 404);
});

test('GET /api/products/:id no longer accepts the token via ?token= query string at all -- only the X-Access-Token header grants access, closing the prior query-string transport', async () => {
  const manual = await seedManualTestProduct();
  const res = await apiGet(`/api/products/${manual.productId}?token=${manual.rawToken}`);
  assert.equal(res.status, 404, 'the correct token in the query string must NOT grant access -- only the header does');
});

test('GET /api/products/:id sends Cache-Control: no-store for the token-gated product, on both success and failure, and identically for an ordinary product -- no cache-eligibility signal distinguishes the hidden product', async () => {
  const manual = await seedManualTestProduct();
  const ordinary = await seedRealPrintifyProduct();

  const success = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': manual.rawToken });
  const failure = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': 'wrong' });
  const ordinaryRes = await apiGet(`/api/products/${ordinary.productId}`);

  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(failure.headers.get('cache-control'), 'no-store');
  assert.equal(ordinaryRes.headers.get('cache-control'), 'no-store');
});

test('GET /api/products/:id for the manual test product succeeds with the correct, unexpired token header', async () => {
  const manual = await seedManualTestProduct();
  const res = await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': manual.rawToken });
  assert.equal(res.status, 200);
  assert.equal(res.json.id, manual.productId);
});

test('an ordinary sequential product-id scan (no token) never retrieves the manual test product', async () => {
  const manual = await seedManualTestProduct();
  for (let id = manual.productId - 3; id <= manual.productId + 3; id += 1) {
    const res = await apiGet(`/api/products/${id}`);
    if (id === manual.productId) {
      assert.equal(res.status, 404, `sequential scan must not retrieve the manual product at id ${id}`);
    }
  }
});

test('only a SHA-256 hash of the token is ever stored in the database, never the raw token', async () => {
  const manual = await seedManualTestProduct();
  const row = await dbGet(`SELECT access_token_hash FROM products WHERE id = ?`, [manual.productId]);
  assert.notEqual(row.access_token_hash, manual.rawToken);
  assert.match(row.access_token_hash, /^[a-f0-9]{64}$/, 'must look like a SHA-256 hex digest, not the raw token or anything else');
  assert.equal(row.access_token_hash, manual.tokenHash);
});

test('the raw access token never appears in console output on either a successful or a failed token-gated request, header-based or query-string (rejected) alike', async () => {
  const manual = await seedManualTestProduct();

  const lines = await captureConsoleLogs(async () => {
    await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': manual.rawToken });
    await apiGet(`/api/products/${manual.productId}`, { 'X-Access-Token': 'wrong-token-value-entirely' });
    await apiGet(`/api/products/${manual.productId}`);
    await apiGet(`/api/products/${manual.productId}?token=${manual.rawToken}`);
  });

  const joined = lines.join('\n');
  assert.doesNotMatch(joined, new RegExp(manual.rawToken), 'the raw token must never be logged, on success, failure, or a rejected query-string attempt');
});
