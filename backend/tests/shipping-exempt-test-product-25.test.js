// Regression suite for a temporary, strictly scoped shipping exemption
// covering exactly ONE hidden manual-fulfillment test product (id=25),
// used for a single controlled real PayPal payment test.
//
// The exemption applies ONLY when ALL of the following hold simultaneously
// (see isSoloShippingExemptTestProductCart's own comment in index.js):
//   - the cart has exactly one line item;
//   - that item's product id is exactly 25;
//   - its quantity is exactly 1;
//   - its supplier_id is exactly 'manual' (server-verified);
//   - its type is exactly 'local' (server-verified).
//
// Deliberately NOT "any manual-supplier product" -- a future real
// manual-supplier product other than id 25 must still be charged shipping
// exactly like any other product. This suite proves both halves: the
// narrow case is exempted, and every other case (normal products, mixed
// carts, a different manual product, quantity > 1) is completely
// unaffected.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-exempt-product-25-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-shipping-exempt';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-shipping-exempt';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app, calculateOrderPricing } = require('../index.js');
const db = require('../db.js');
const emailService = require('../services/emailService.js');

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

let nextSyntheticId = 990001;

async function seedManualProduct({ id, price = 5, stock = 1, tokenTtlHours = 48 } = {}) {
  const productId = id ?? nextSyntheticId++;
  // Several tests deliberately reuse the SAME id=25 (that's the entire
  // point of this feature being hardcoded to that one id) -- clean up any
  // prior row for this exact id first so each test gets an independent,
  // freshly-seeded product despite sharing this file's one database.
  await dbRun(`DELETE FROM product_variants WHERE productId = ?`, [productId]);
  await dbRun(`DELETE FROM products WHERE id = ?`, [productId]);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + tokenTtlHours * 60 * 60 * 1000).toISOString();
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, access_token_hash, access_token_expires_at)
     VALUES (?, ?, ?, ?, ?, 'local', 'manual', ?, ?)`,
    [productId, `[TEST] Manual Product ${productId}`, 'synthetic fixture', price, stock, tokenHash, expiresAt]
  );
  await dbRun(
    `INSERT INTO product_variants (id, productId, color, size, price, isEnabled, isAvailable, stockQty) VALUES (?, ?, 'Default', 'OS', ?, 1, 1, ?)`,
    [productId * 10 + 1, productId, price, stock]
  );
  return { productId, rawToken };
}

async function seedNormalProduct({ price = 100 } = {}) {
  const productId = nextSyntheticId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [productId, `Normal Product ${productId}`, 'synthetic fixture', price, 999, `pf-${productId}`]
  );
  return { productId, price };
}

// ═══════════════════════════════════════════════════════════════════════════
// Direct unit tests against calculateOrderPricing itself
// ═══════════════════════════════════════════════════════════════════════════

test('UNIT: product 25 alone at quantity 1, supplier=manual, type=local -> shipping=0, total=5.00', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 1, supplier_id: 'manual', type: 'local' },
  ]);
  assert.equal(pricing.shippingCost, 0);
  assert.equal(pricing.totalAmount, 5);
});

test('UNIT: a normal product below the free-shipping threshold is completely unaffected -- shipping remains 29.90', () => {
  const pricing = calculateOrderPricing([
    { id: 1, price: 100, quantity: 1, supplier_id: 'printify', type: 'printify' },
  ]);
  assert.equal(pricing.shippingCost, 29.9);
  assert.equal(pricing.totalAmount, 129.9);
});

test('UNIT: product 25 plus a normal product (mixed cart) -- normal shipping logic remains fully active', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 1, supplier_id: 'manual', type: 'local' },
    { id: 1, price: 100, quantity: 1, supplier_id: 'printify', type: 'printify' },
  ]);
  assert.equal(pricing.shippingCost, 29.9, 'a real item is being shipped, so shipping must still apply');
  assert.equal(pricing.totalAmount, 134.9); // 5 + 100 + 29.9 shipping
});

test('UNIT: a different manual-supplier product (id != 25) is completely unaffected -- normal shipping logic remains active', () => {
  const pricing = calculateOrderPricing([
    { id: 99, price: 5, quantity: 1, supplier_id: 'manual', type: 'local' },
  ]);
  assert.equal(pricing.shippingCost, 29.9, 'only id=25 is exempt -- a future real manual product must still be charged shipping');
  assert.equal(pricing.totalAmount, 34.9);
});

test('UNIT: product 25 at quantity greater than 1 -- exemption must not apply', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 2, supplier_id: 'manual', type: 'local' },
  ]);
  assert.equal(pricing.shippingCost, 29.9);
  assert.equal(pricing.totalAmount, 39.9);
});

test('UNIT: product 25 with the wrong supplier_id (defense-in-depth) -- exemption must not apply', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 1, supplier_id: 'printify', type: 'local' },
  ]);
  assert.equal(pricing.shippingCost, 29.9);
});

test('UNIT: product 25 with the wrong type (defense-in-depth) -- exemption must not apply', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 1, supplier_id: 'manual', type: 'printify' },
  ]);
  assert.equal(pricing.shippingCost, 29.9);
});

test('UNIT: two separate line items both referencing id=25 (cart.length !== 1) -- exemption must not apply', () => {
  const pricing = calculateOrderPricing([
    { id: 25, price: 5, quantity: 1, supplier_id: 'manual', type: 'local' },
    { id: 25, price: 5, quantity: 1, supplier_id: 'manual', type: 'local' },
  ]);
  assert.equal(pricing.shippingCost, 29.9);
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests via the real HTTP create-order route
// ═══════════════════════════════════════════════════════════════════════════

test('INTEGRATION: create-order for product id=25 alone returns amount 5.00', async () => {
  const product = await seedManualProduct({ id: 25 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.amount, '5.00');

    const order = await dbGet(`SELECT totalAmount, expected_payment_amount FROM orders WHERE id = ?`, [res.json.orderId]);
    assert.equal(order.totalAmount, 5);
    assert.equal(order.expected_payment_amount, 5);
  } finally {
    paypalMock.restore();
  }
});

test('INTEGRATION: create-order for id=25 at quantity 2 is rejected -- existing stock/quantity controls are unaffected', async () => {
  const product = await seedManualProduct({ id: 25, stock: 1 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 2, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /no longer available/i);
  } finally {
    paypalMock.restore();
  }
});

test('INTEGRATION: create-order for a different manual product (not id 25) charges shipping normally', async () => {
  const product = await seedManualProduct({ id: 995555 }); // deliberately outside the auto-incrementing 990001+ range to avoid any collision
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.amount, '34.90', 'only id=25 is exempt');
  } finally {
    paypalMock.restore();
  }
});

test('INTEGRATION: create-order for product 25 plus a normal product charges shipping normally', async () => {
  const manual = await seedManualProduct({ id: 25 });
  const normal = await seedNormalProduct({ price: 100 });
  const paypalMock = installPaypalHappyPathMocks();
  try {
    const res = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [
        { id: manual.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: manual.rawToken },
        { id: normal.productId, quantity: 1 },
      ],
      currency: 'ILS',
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.amount, '134.90');
  } finally {
    paypalMock.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Email total consistency
// ═══════════════════════════════════════════════════════════════════════════

test('EMAIL: order-confirmation email totals for a product-25-only order show shipping=0 and total=5.00, matching the server charge', async () => {
  const product = await seedManualProduct({ id: 25 });
  const paypalMock = installPaypalHappyPathMocks();
  let capturedTotals = null;
  const emailMock = mock.method(emailService, 'sendOrderConfirmationEmail', async (email, orderId, customerName, items, totals) => {
    capturedTotals = totals;
    return { ok: true };
  });
  try {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SYNTHETIC_SHIPPING,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: product.rawToken }],
      currency: 'ILS',
    });
    assert.equal(createRes.status, 200, JSON.stringify(createRes.json));

    const captureRes = await apiPost('/api/paypal/capture-order', { orderID: createRes.json.orderID });
    assert.equal(captureRes.json.success, true);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && capturedTotals === null) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(capturedTotals, 'the confirmation email must have been sent');
    assert.equal(capturedTotals.shipping, 0, 'the email must show shipping=0, not a phantom 29.90 fee');
    assert.equal(capturedTotals.total, 5, 'the email total must match what was actually charged');
    assert.equal(capturedTotals.subtotal, 5);
  } finally {
    paypalMock.restore();
    emailMock.mock.restore();
  }
});
