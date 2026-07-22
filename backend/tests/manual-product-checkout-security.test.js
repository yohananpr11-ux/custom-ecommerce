// Adversarial-review regression suite for two P0 defects found in the
// original manual-payment-test-product implementation by independently
// re-deriving behavior from the actual route code rather than trusting the
// prior implementation report:
//
//   FINDING #1 (token bypass at create-order): GET /api/products/:id was the
//   only route that ever checked a manual-supplier product's access token.
//   All three checkout-creation routes (PayPal/Stripe/PayPlus) share
//   resolveValidatedOrderItems, which resolved products by bare numeric id
//   with no token check at all -- an attacker who merely knew/guessed the
//   hidden product's id could create a real order and a real PayPal order
//   for it without ever knowing the token.
//
//   FINDING #2 (stock-one race): stock was only decremented at fulfillment
//   time (after a real successful capture), while checkout-time only READ
//   stock without reserving it -- two concurrent create-order requests could
//   both pass the check, both create separate real PayPal orders, and both
//   later successfully capture, double-selling a single-stock item.
//
// This file proves the fix for both, plus the crash/concurrency edge cases
// the fix itself introduces: an atomic reservation at create-order time
// (backend/index.js's reserveManualProductStock), a lease that lives on the
// product row itself (not on any orders/order_items row, so it survives a
// crash before the order row even exists), lazy reclaim of an abandoned
// lease, and a pre-capture check (orders.paypal_order_id) that refuses a
// real PayPal charge for an order whose reservation was already reclaimed.
//
// Same harness pattern as tests/manual-payment-test-product.js: boots the
// real exported Express app, makes real HTTP requests, mocks only
// axios.post (asserted to throw on any call outside the fixed PayPal
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-product-checkout-security-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-checkout-security';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-checkout-security';
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

async function apiGet(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
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

let nextProductId = 950001;

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

/** Mirrors exactly what scripts/manual-payment-test-product.js's `disable` writes (stock=0 + expired token, row/history untouched). */
async function disableManualTestProduct(productId) {
  await dbRun(
    `UPDATE products SET stock = 0, access_token_expires_at = datetime('now', '-1 minute') WHERE id = ? AND supplier_id = 'manual'`,
    [productId]
  );
}

function itemPayload(product, overrides = {}) {
  return {
    id: product.productId,
    quantity: 1,
    selectedColor: 'Default',
    selectedSize: 'OS',
    accessToken: product.rawToken,
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

async function createOrder(product, itemOverrides = {}) {
  return apiPost('/api/paypal/create-order', {
    ...SYNTHETIC_SHIPPING,
    items: [itemPayload(product, itemOverrides)],
    currency: 'ILS',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FINDING #1 — token bypass at create-order
// ═══════════════════════════════════════════════════════════════════════════

test('create-order for a manual product with NO accessToken field is rejected with a non-revealing error and creates no order', async () => {
  const product = await seedManualTestProduct();
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    const { accessToken, ...itemWithoutToken } = itemPayload(product);
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [itemWithoutToken],
      currency: 'ILS',
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found/i);
    assert.doesNotMatch(res.json.error, /no longer available/i, 'must look identical to a missing product, not an exhausted one');

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter, ordersBefore, 'no order of any status may be created for a rejected checkout attempt');
  } finally {
    paypalMock.restore();
  }
});

test('create-order for a manual product with a malformed/garbage accessToken is rejected with the same non-revealing error', async () => {
  const product = await seedManualTestProduct();
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder(product, { accessToken: 'not-the-real-token-at-all' });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found/i);
  } finally {
    paypalMock.restore();
  }
});

test('create-order for a manual product with an expired accessToken is rejected', async () => {
  const product = await seedManualTestProduct({ tokenTtlHours: -1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder(product);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found/i);
  } finally {
    paypalMock.restore();
  }
});

test('create-order using a DIFFERENT manual product\'s valid token is rejected -- a token is bound to its own product', async () => {
  const productA = await seedManualTestProduct();
  const productB = await seedManualTestProduct();
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder(productA, { accessToken: productB.rawToken });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found/i);
  } finally {
    paypalMock.restore();
  }
});

test('create-order for a manual product after operator disablement is rejected even with the originally-valid token', async () => {
  const product = await seedManualTestProduct();
  await disableManualTestProduct(product.productId);
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await createOrder(product);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found|no longer available/i);
  } finally {
    paypalMock.restore();
  }
});

test('the create-order rejection message for a bad token uses the exact same template as a genuinely nonexistent product id -- proves the gate cannot be probed by response shape', async () => {
  const product = await seedManualTestProduct();
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const badTokenRes = await createOrder(product, { accessToken: 'wrong-token' });
    const nonexistentRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: 999999999, quantity: 1, selectedColor: 'Default', selectedSize: 'OS' }],
      currency: 'ILS',
    });
    assert.equal(badTokenRes.status, 400);
    assert.equal(nonexistentRes.status, 400);
    // The message legitimately embeds each request's own product id, so the
    // literal strings differ across two different ids -- what must be
    // identical is the surrounding template/wording itself.
    const template = (msg, id) => msg.replace(String(id), '<id>');
    assert.equal(template(badTokenRes.json.error, product.productId), template(nonexistentRes.json.error, 999999999));
  } finally {
    paypalMock.restore();
  }
});

test('a capture for an order created with a valid token BEFORE disablement still succeeds even if the product is disabled before capture -- the token gate governs checkout creation, not an already-created order\'s capture', async () => {
  const product = await seedManualTestProduct();
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const createRes = await createOrder(product);
    assert.equal(createRes.status, 200, JSON.stringify(createRes.json));

    // Operator disables the hidden product moments after the customer
    // already started checkout -- their in-flight PayPal approval must
    // still be honorable; this is not the scenario the token gate exists
    // to stop (see resolveValidatedOrderItems's own comment).
    await disableManualTestProduct(product.productId);

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true, JSON.stringify(captureRes.json));

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createRes.json.orderId]);
    assert.equal(order.status, 'paid');
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FINDING #2 — stock-one race
// ═══════════════════════════════════════════════════════════════════════════

test('STOCK_ONE_GUARANTEE: two parallel create-order requests with the same valid token result in exactly one success and one rejection, and exactly one order row', async () => {
  const product = await seedManualTestProduct({ stock: 1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;

    const [resA, resB] = await Promise.all([createOrder(product), createOrder(product)]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 400], 'exactly one of the two parallel requests must succeed');

    const rejected = resA.status === 400 ? resA : resB;
    assert.match(rejected.json.error, /no longer available/i);

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter - ordersBefore, 1, 'AT_MOST_ONE local order may be created for a single-stock item under concurrent requests');

    const productAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0);
  } finally {
    paypalMock.restore();
  }
});

test('TWO_PARALLEL_CREATE_ORDER_REQUESTS + AT_MOST_ONE_SUCCESSFUL_PAYMENT: even if both browser tabs independently attempt capture, only one payment ever reaches paid', async () => {
  const product = await seedManualTestProduct({ stock: 1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const [resA, resB] = await Promise.all([createOrder(product), createOrder(product)]);
    const winner = resA.status === 200 ? resA : resB;
    assert.equal(winner.status, 200);

    // Only the winner has a real PayPal orderID to capture -- the loser
    // never got far enough to create one. Capturing the winner must
    // succeed exactly once.
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: winner.json.orderID });
    assert.equal(captureRes.json.success, true);

    // Scoped to orders referencing THIS test's own product -- the shared
    // test-file database accumulates paid orders from other tests too, so
    // an unscoped global COUNT would be a false signal either way.
    const paidCount = (await dbGet(
      `SELECT COUNT(*) AS n FROM orders o JOIN order_items oi ON oi.orderId = o.id WHERE oi.productId = ? AND o.status = 'paid'`,
      [product.productId]
    )).n;
    assert.equal(paidCount, 1, 'AT_MOST_ONE_SUCCESSFUL_PAYMENT for a stock=1 item');
  } finally {
    paypalMock.restore();
  }
});

test('two genuinely available units (stock=2): two distinct orders, two distinct PayPal orders, two concurrent captures both succeed with no cross-contamination', async () => {
  const product = await seedManualTestProduct({ stock: 2 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const createA = await createOrder(product);
    const createB = await createOrder(product);
    assert.equal(createA.status, 200, JSON.stringify(createA.json));
    assert.equal(createB.status, 200, JSON.stringify(createB.json));
    assert.notEqual(createA.json.orderID, createB.json.orderID, 'two distinct PayPal provider orders');
    assert.notEqual(createA.json.orderId, createB.json.orderId, 'two distinct local orders');

    const [captureA, captureB] = await Promise.all([
      apiPost('/api/paypal/capture-order', { orderID: createA.json.orderID }),
      apiPost('/api/paypal/capture-order', { orderID: createB.json.orderID }),
    ]);
    assert.equal(captureA.json.success, true, JSON.stringify(captureA.json));
    assert.equal(captureB.json.success, true, JSON.stringify(captureB.json));

    const orderA = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createA.json.orderId]);
    const orderB = await dbGet(`SELECT status FROM orders WHERE id = ?`, [createB.json.orderId]);
    assert.equal(orderA.status, 'paid');
    assert.equal(orderB.status, 'paid');

    const productAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0, 'both units consumed, none double-counted');
  } finally {
    paypalMock.restore();
  }
});

test('an abandoned checkout (create-order, never captured) is lazily reclaimed by a later legitimate retry once the reservation window elapses, and the original stale PayPal order is then refused at capture -- no real charge for it', async () => {
  const product = await seedManualTestProduct({ stock: 1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const abandoned = await createOrder(product);
    assert.equal(abandoned.status, 200, JSON.stringify(abandoned.json));

    const productMidway = await dbGet(`SELECT stock FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productMidway.stock, 0, 'the abandoned checkout still holds the reservation immediately after creation');

    // Simulate the reservation window having elapsed (no real 15-minute
    // wait in a test) by backdating the lease directly, exactly as if this
    // much real time had passed.
    await dbRun(
      `UPDATE products SET stock_reservation_expires_at = datetime('now', '-1 minute') WHERE id = ?`,
      [product.productId]
    );

    const retry = await createOrder(product);
    assert.equal(retry.status, 200, JSON.stringify(retry.json));
    assert.notEqual(retry.json.orderId, abandoned.json.orderId, 'a genuinely new order for the legitimate retry');

    const abandonedOrder = await dbGet(`SELECT status FROM orders WHERE id = ?`, [abandoned.json.orderId]);
    assert.equal(abandonedOrder.status, 'reservation_expired', 'the abandoned order is marked, never deleted, never paid');

    // The original customer's stale PayPal approval must not be able to
    // trigger a real charge after reclaim.
    const lateCaptureOfAbandoned = await apiPost('/api/paypal/capture-order', { orderID: abandoned.json.orderID });
    assert.equal(lateCaptureOfAbandoned.status, 409, JSON.stringify(lateCaptureOfAbandoned.json));
    assert.equal(lateCaptureOfAbandoned.json.success, false);

    const abandonedOrderAfter = await dbGet(`SELECT status FROM orders WHERE id = ?`, [abandoned.json.orderId]);
    assert.equal(abandonedOrderAfter.status, 'reservation_expired', 'the late capture attempt must not flip the reclaimed order to paid');

    // The retry's own capture must still succeed normally.
    const retryCapture = await apiPost('/api/paypal/capture-order', { orderID: retry.json.orderID });
    assert.equal(retryCapture.json.success, true, JSON.stringify(retryCapture.json));
  } finally {
    paypalMock.restore();
  }
});

test('CRASH_AFTER_RESERVATION_BEFORE_ORDER_ROW: a reservation with no corresponding order row at all (the process crashed between reserving stock and inserting the order) is still reclaimed once stale, not permanently stranded', async () => {
  const product = await seedManualTestProduct({ stock: 1 });

  // Replicates exactly the side effect of reserveManualProductStock's own
  // atomic UPDATE, with NO subsequent orders/order_items insert -- this is
  // the state a real crash between resolveValidatedOrderItems (which
  // reserves) and createPendingOrder's own orders INSERT would leave
  // behind. No order row exists anywhere referencing this reservation.
  await dbRun(
    `UPDATE products
        SET stock = stock - 1,
            stock_reservation_qty = 1,
            stock_reservation_expires_at = datetime('now', '+15 minutes')
      WHERE id = ? AND supplier_id = 'manual' AND stock >= 1`,
    [product.productId]
  );
  const midCrash = await dbGet(`SELECT stock, stock_reservation_qty, stock_reservation_expires_at FROM products WHERE id = ?`, [product.productId]);
  assert.equal(midCrash.stock, 0, 'the crashed reservation still holds the unit');
  assert.equal(midCrash.stock_reservation_qty, 1);
  assert.ok(midCrash.stock_reservation_expires_at, 'a lease exists even though no order row does');

  const ordersReferencingProduct = await dbAll(
    `SELECT o.id FROM orders o JOIN order_items oi ON oi.orderId = o.id WHERE oi.productId = ?`,
    [product.productId]
  );
  assert.equal(ordersReferencingProduct.length, 0, 'confirms this is genuinely the no-order-row crash window, not the abandoned-order scenario covered by the other test');

  // Before the window elapses, a fresh request must still be rejected --
  // the crashed reservation is not yet reclaimable.
  const tooSoon = await createOrder(product);
  assert.equal(tooSoon.status, 400);
  assert.match(tooSoon.json.error, /no longer available/i);

  // Once the window elapses, the lease -- anchored on the product row
  // alone -- is reclaimable with no order row needed to find it.
  await dbRun(
    `UPDATE products SET stock_reservation_expires_at = datetime('now', '-1 minute') WHERE id = ?`,
    [product.productId]
  );

  const paypalMock = installPaypalHappyPathMocks();
  try {
    const recovered = await createOrder(product);
    assert.equal(recovered.status, 200, JSON.stringify(recovered.json));

    const productAfter = await dbGet(`SELECT stock, stock_reservation_qty, stock_reservation_expires_at FROM products WHERE id = ?`, [product.productId]);
    assert.equal(productAfter.stock, 0, 'the single unit is now legitimately reserved by the new order');
    assert.equal(productAfter.stock_reservation_qty, 1);

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: recovered.json.orderID });
    assert.equal(captureRes.json.success, true, JSON.stringify(captureRes.json));
  } finally {
    paypalMock.restore();
  }
});

test('TOKEN_REUSE_AFTER_PAID: after a successful paid transition, a fresh create-order attempt with the SAME originally-valid token is rejected as sold out, not treated as a new purchase', async () => {
  const product = await seedManualTestProduct({ stock: 1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const first = await createOrder(product);
    assert.equal(first.status, 200);
    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: first.json.orderID });
    assert.equal(captureRes.json.success, true);

    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    const reuse = await createOrder(product);
    assert.equal(reuse.status, 400);
    assert.match(reuse.json.error, /no longer available/i);

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter, ordersBefore, 'no new order for a token-reuse attempt after the item is already sold');
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 8 — mixed cart (hidden manual item + a normal supplier item)
// ═══════════════════════════════════════════════════════════════════════════
// Not rejected -- an already-reviewed safe behavior exists: services/
// fulfillment.js's routeOrderToSupplier groups order_items by supplier_id
// and dispatches each supplier's items through its own independent handler
// (Phase 3 Multi-Vendor design, unchanged by this review). This proves that
// design genuinely extends to a manual item sharing an order with a normal
// supplier item: the token/reservation gate applies only to the manual
// item, the printify item is unaffected, and fulfillment routes each to the
// correct handler with no cross-contamination. PRINTIFY_API_TOKEN is left
// unset (this file's module-level env setup), so services/printify.js's own
// real missing-token guard returns a structurally network-free
// { ok: true, mocked: true, status: 'simulated' } response for the printify
// item -- no mock needed, and no real Printify call is structurally
// possible either way.

async function waitForBothItemsSettled(orderId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await dbAll(`SELECT supplier_id, fulfillment_status FROM order_items WHERE orderId = ?`, [orderId]);
    if (rows.length === 2 && rows.every((r) => r.fulfillment_status && r.fulfillment_status !== 'pending')) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`order items did not settle for order ${orderId} within ${timeoutMs}ms`);
}

test('a mixed cart (hidden manual item + a normal printify item) creates one order, gates only the manual item, and fulfillment routes each item to its own supplier with no cross-contamination', async () => {
  const manual = await seedManualTestProduct({ stock: 1 });

  const printifyProductId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [printifyProductId, `Real Product ${printifyProductId}`, 'synthetic fixture', 149, 999, `pf-${printifyProductId}`]
  );

  const paypalMock = installPaypalHappyPathMocks();
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [
        itemPayload(manual),
        { id: printifyProductId, quantity: 1 },
      ],
      currency: 'ILS',
    });
    assert.equal(createRes.status, 200, JSON.stringify(createRes.json));
    const orderId = createRes.json.orderId;

    const items = await dbAll(`SELECT productId, supplier_id FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(items.length, 2, 'both items land in the same order');

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true, JSON.stringify(captureRes.json));

    const settled = await waitForBothItemsSettled(orderId);
    const manualItem = settled.find((r) => r.supplier_id === 'manual');
    const printifyItem = settled.find((r) => r.supplier_id === 'printify');
    assert.equal(manualItem.fulfillment_status, 'submitted', 'the manual item still reaches submitted with zero external calls');
    assert.notEqual(printifyItem.fulfillment_status, 'pending', 'the printify item was independently dispatched, not skipped or blocked by the manual item\'s gate');

    const supplierFulfillmentRows = await dbAll(`SELECT supplierId, state FROM supplier_fulfillments WHERE orderId = ?`, [orderId]);
    assert.equal(supplierFulfillmentRows.length, 1, 'exactly one supplier_fulfillments row, for printify only -- manual creates none');
    assert.equal(supplierFulfillmentRows[0].supplierId, 'printify');

    const manualProductAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [manual.productId]);
    assert.equal(manualProductAfter.stock, 0, 'the manual item\'s stock is consumed');

    const printifyProductAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [printifyProductId]);
    assert.equal(printifyProductAfter.stock, 999, 'a printify product\'s stock is purely informational and untouched by checkout, mixed cart or not');
  } finally {
    paypalMock.restore();
  }
});

test('a mixed cart where the manual item\'s token is missing is rejected in full -- the printify item does not get partially checked out', async () => {
  const manual = await seedManualTestProduct({ stock: 1 });
  const printifyProductId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [printifyProductId, `Real Product ${printifyProductId}`, 'synthetic fixture', 149, 999, `pf-${printifyProductId}`]
  );

  const paypalMock = installPaypalHappyPathMocks();
  try {
    const ordersBefore = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    const { accessToken, ...manualItemWithoutToken } = itemPayload(manual);
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [manualItemWithoutToken, { id: printifyProductId, quantity: 1 }],
      currency: 'ILS',
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /was not found/i);

    const ordersAfter = (await dbGet(`SELECT COUNT(*) AS n FROM orders`)).n;
    assert.equal(ordersAfter, ordersBefore, 'no partial order -- the whole checkout is atomic, the printify item is not silently checked out alone');

    const printifyProductAfter = await dbGet(`SELECT stock FROM products WHERE id = ?`, [printifyProductId]);
    assert.equal(printifyProductAfter.stock, 999, 'untouched');
  } finally {
    paypalMock.restore();
  }
});
