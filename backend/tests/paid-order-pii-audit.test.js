// Adversarial-review PII/secret redaction sweep for the paid-order pipeline.
//
// Distinct in scope from paid-order-notifications.test.js's canary test
// (which covers the HAPPY path through the real checkout flow): this file
// specifically targets ERROR paths -- provider create/capture/checkout
// failures and a dropship supplier failure -- because a prior pass over
// this codebase found that error-handling catch blocks in index.js and
// services/dropship.js logged raw provider response bodies verbatim
// (`err.response.data`, `JSON.stringify(error.response.data)`), and
// services/dropship.js additionally logged the FULL raw CJ API response
// unconditionally on every SUCCESSFUL order too. Both are fixed in this
// same changeset; these tests prove it with a much wider canary set than
// the existing happy-path test: customer name, email, phone, address,
// payment/capture id, provider order id, supplier order id, a
// credential-shaped token, and an Authorization-header-shaped value -- all
// planted directly into the MOCKED PROVIDER RESPONSE (not just the
// request), since that is exactly what the fixed code paths were logging
// verbatim. Also covers a thrown non-Error value, which JS handles safely
// by property-access semantics (`someString.response` is `undefined`, not
// a crash) but which is worth proving directly rather than assuming.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-pii-audit-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-piiaudit';
process.env.PAYPAL_CLIENT_SECRET = 'CANARY-SECRET-PAYPAL-CLIENT-SECRET-SHOULD-NEVER-LEAK';
process.env.PAYPLUS_API_KEY = 'CANARY-SECRET-PAYPLUS-API-KEY-SHOULD-NEVER-LEAK';
process.env.PAYPLUS_SECRET_KEY = 'CANARY-SECRET-PAYPLUS-SECRET-KEY-SHOULD-NEVER-LEAK';
process.env.PAYPLUS_PAGE_UID = 'test-payplus-page-uid-piiaudit';
process.env.CJ_API_KEY = 'CANARY-SECRET-CJ-API-KEY-SHOULD-NEVER-LEAK';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app } = require('../index.js');
const db = require('../db.js');
const dropship = require('../services/dropship.js');
const telegram = require('../services/telegram.js');

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

// A superset canary bundle covering every field category the review asked
// for. Each value is distinctive and greppable.
const CANARY = {
  customerName: 'Canary McTestface',
  email: 'canary-pii-audit@example.invalid',
  phone: '+15557778899',
  address: 'Canary Address Lane 42',
  paymentId: 'CANARY-PAYMENT-CAPTURE-ID-9f8e7d6c',
  providerOrderId: 'CANARY-PROVIDER-ORDER-ID-1a2b3c4d',
  printifyId: 'CANARY-PRINTIFY-SUPPLIER-ORDER-ID-5e6f7a8b',
  token: 'CANARY-BEARER-TOKEN-SHOULD-NEVER-LEAK-abc123xyz',
  authHeader: 'Bearer CANARY-AUTH-HEADER-VALUE-SHOULD-NEVER-LEAK',
};

function assertNoCanaries(haystack, { except = [] } = {}) {
  for (const [key, value] of Object.entries(CANARY)) {
    if (except.includes(key)) continue;
    assert.doesNotMatch(haystack, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `canary "${key}" (${value}) must never appear in console output`);
  }
}

async function captureConsoleLogs(fn) {
  const lines = [];
  const logMock = mock.method(console, 'log', (...args) => lines.push(args.map(String).join(' ')));
  const warnMock = mock.method(console, 'warn', (...args) => lines.push(args.map(String).join(' ')));
  const errorMock = mock.method(console, 'error', (...args) => lines.push(args.map(String).join(' ')));
  try { await fn(); } finally { logMock.mock.restore(); warnMock.mock.restore(); errorMock.mock.restore(); }
  return lines;
}

let nextProductId = 930001;
async function seedProduct({ price = 100 } = {}) {
  const productId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, `PII Audit Product ${productId}`, 'synthetic fixture', price, price / 3.6, 999, 'printify', 'printify', `pf-piiaudit-${productId}`]
  );
  const variantId = productId * 10 + 1;
  await dbRun(
    `INSERT INTO product_variants (id, productId, printifyVariantId, color, size, price, isEnabled, isAvailable) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    [variantId, productId, `pf-variant-${productId}`, 'Black', 'M', price]
  );
  return { productId, variantId, price };
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

const SHIPPING_WITH_CANARIES = {
  customerName: CANARY.customerName,
  customerEmail: CANARY.email,
  firstName: 'Canary', lastName: 'McTestface', phone: CANARY.phone,
  addressLine1: CANARY.address, city: 'Faketown', postalCode: '00000', country: 'US', region: 'CA',
};

// ── PayPal create-order failure: provider error response echoes canaries ──

test('PayPal create-order failure: a provider error response echoing customer PII/ids/tokens never appears in console output', async () => {
  const product = await seedProduct({ price: 45 });
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.includes('/v2/checkout/orders')) {
      const err = new Error('PayPal create-order validation error');
      err.response = {
        status: 422,
        data: {
          name: 'UNPROCESSABLE_ENTITY',
          providerOrderId: CANARY.providerOrderId,
          debug_id: CANARY.paymentId,
          details: [
            { field: 'purchase_units[0].shipping.address', description: `Invalid address: ${CANARY.address}, phone ${CANARY.phone}, name ${CANARY.customerName}, email ${CANARY.email}` },
          ],
          authorization: CANARY.authHeader,
          access_token: CANARY.token,
        },
      };
      throw err;
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    await apiPost('/api/paypal/create-order', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
  });
  axiosMock.mock.restore();

  const joined = lines.join('\n');
  assertNoCanaries(joined);
  assert.match(joined, /PayPal create-order failed: HTTP_422/, 'a safe, fixed-shape status summary must still be logged for real debuggability');
});

// ── PayPal capture-order failure (outer catch): same, via a genuinely
// unexpected error rather than the already-tested structured 400 paths ────

test('PayPal capture-order failure (unexpected/outer-catch error): a provider error response echoing customer PII/ids/tokens never appears in console output', async () => {
  const product = await seedProduct({ price: 46 });
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.endsWith('/capture')) {
      const err = new Error('PayPal capture unexpected failure');
      err.response = {
        status: 500,
        data: {
          name: 'INTERNAL_SERVER_ERROR',
          providerOrderId: CANARY.providerOrderId,
          capture_id: CANARY.paymentId,
          customer: { name: CANARY.customerName, email: CANARY.email, phone: CANARY.phone },
          authorization: CANARY.authHeader,
          client_secret: CANARY.token,
        },
      };
      throw err;
    }
    // create-order happy path so we reach a real capture call
    return { data: { id: `PPO-${Math.random().toString(36).slice(2)}`, status: 'CREATED' } };
  });

  let orderID;
  const lines = await captureConsoleLogs(async () => {
    const createRes = await apiPost('/api/paypal/create-order', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    orderID = createRes.json.orderID;
    await apiPost('/api/paypal/capture-order', { orderID });
  });
  axiosMock.mock.restore();

  const joined = lines.join('\n');
  assertNoCanaries(joined);
  assert.match(joined, /PayPal capture-order failed: HTTP_500/);
});

// ── PayPlus create-checkout: business-logic failure response echoes
// canaries (results.status !== 'success' branch, not an HTTP error) ────────

test('PayPlus create-checkout failure (results.status=error): a response echoing customer PII/ids/tokens never appears in console output', async () => {
  process.env.PAYPLUS_PAGE_UID = 'test-payplus-page-uid-piiaudit';
  const product = await seedProduct({ price: 47 });
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('payplus.co.il')) {
      return {
        data: {
          results: {
            status: 'error',
            code: 123,
            description: `Rejected customer ${CANARY.customerName} phone ${CANARY.phone} email ${CANARY.email}`,
          },
          customer: { customer_name: CANARY.customerName, email: CANARY.email, phone: CANARY.phone },
          providerOrderId: CANARY.providerOrderId,
          authorization: CANARY.authHeader,
          api_key: CANARY.token,
        },
      };
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    await apiPost('/api/checkout/payplus', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
    });
  });
  axiosMock.mock.restore();

  const joined = lines.join('\n');
  // `description` is deliberately excluded from the console log by the fix,
  // but it IS still returned in the HTTP response body to the client (the
  // same customer who submitted it) -- that's an intentional, separate
  // trust boundary (client-to-itself), not what this test is checking.
  assertNoCanaries(joined);
  assert.match(joined, /PayPlus API response failed: status=error code=123/);
});

// ── PayPlus create-checkout: network/HTTP-level failure ────────────────────

test('PayPlus create-checkout failure (network/HTTP error, outer catch): a provider error response echoing canaries never appears in console output', async () => {
  process.env.PAYPLUS_PAGE_UID = 'test-payplus-page-uid-piiaudit';
  const product = await seedProduct({ price: 48 });
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('payplus.co.il')) {
      const err = new Error('PayPlus request failed');
      err.response = {
        status: 400,
        data: {
          customer: { customer_name: CANARY.customerName, email: CANARY.email, phone: CANARY.phone },
          providerOrderId: CANARY.providerOrderId,
          authorization: CANARY.authHeader,
          secret_key: CANARY.token,
        },
      };
      throw err;
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    await apiPost('/api/checkout/payplus', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
    });
  });
  axiosMock.mock.restore();

  const joined = lines.join('\n');
  assertNoCanaries(joined);
  assert.match(joined, /PayPlus checkout initialization error: HTTP_400/);
});

// ── Dropship (CJ) success path: raw response previously logged
// unconditionally -- must never echo submitted customer PII ────────────────

test('regression: dropship.sendOrder success no longer logs the raw CJ API response (which echoes submitted customer PII)', async () => {
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('getAccessToken')) return { data: { code: 200, result: true, data: { accessToken: 'fake-cj-token' } } };
    if (url.includes('freightCalculate')) return { data: { code: 200, data: [{ logisticName: 'Fake Carrier' }] } };
    if (url.includes('createOrderV2')) {
      // Realistic: a real order-creation API commonly echoes back what it
      // received to confirm receipt.
      return {
        data: {
          code: 200,
          result: { orderNumber: CANARY.printifyId },
          echo: {
            shippingCustomerName: CANARY.customerName,
            shippingAddress: CANARY.address,
            shippingPhone: CANARY.phone,
            shippingEmail: CANARY.email,
          },
        },
      };
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    const result = await dropship.sendOrder(999001, {
      customerName: CANARY.customerName, customerEmail: CANARY.email, phone: CANARY.phone,
      firstName: 'Canary', lastName: 'McTestface', addressLine1: CANARY.address, city: 'Faketown', country: 'US',
    }, [{ id: 1, sku: 'TEST-SKU', quantity: 1 }]);
    assert.equal(result.ref, CANARY.printifyId);
  });
  axiosMock.mock.restore();

  const joined = lines.join('\n');
  // printifyId (used here as the returned `ref`) is EXPECTED to appear --
  // it's the whole point of a successful order submission log line, and is
  // a supplier-issued reference id, not customer PII. Every OTHER canary
  // (name/email/phone/address/token/auth) must not appear.
  assertNoCanaries(joined, { except: ['printifyId'] });
});

// ── Dropship (CJ) failure path: raw error response + Telegram forwarding ───

test('regression: dropship.sendOrder failure no longer logs or forwards-to-Telegram the raw CJ error response', async () => {
  const notifyErrorMock = mock.method(telegram, 'notifyError', async () => {});
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('getAccessToken')) return { data: { code: 200, result: true, data: { accessToken: 'fake-cj-token' } } };
    if (url.includes('freightCalculate')) return { data: { code: 200, data: [{ logisticName: 'Fake Carrier' }] } };
    if (url.includes('createOrderV2')) {
      const err = new Error('CJ order creation failed');
      err.response = {
        status: 400,
        data: {
          code: 400228,
          message: `Validation failed for ${CANARY.customerName}, ${CANARY.address}, ${CANARY.phone}, ${CANARY.email}`,
        },
      };
      throw err;
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    await assert.rejects(() => dropship.sendOrder(999002, {
      customerName: CANARY.customerName, customerEmail: CANARY.email, phone: CANARY.phone,
      firstName: 'Canary', lastName: 'McTestface', addressLine1: CANARY.address, city: 'Faketown', country: 'US',
    }, [{ id: 2, sku: 'TEST-SKU-2', quantity: 1 }]));
  });
  axiosMock.mock.restore();
  notifyErrorMock.mock.restore();

  const joined = lines.join('\n');
  assertNoCanaries(joined);
  assert.match(joined, /HTTP_400 \(cj_code=400228\)/);

  // Also confirm the argument forwarded to Telegram (which would be sent
  // externally if TELEGRAM_BOT_TOKEN were configured) is the same safe
  // summary, not the raw canary-laden message.
  assert.equal(notifyErrorMock.mock.callCount(), 1);
  const [, forwardedMessage] = notifyErrorMock.mock.calls[0].arguments;
  assertNoCanaries(forwardedMessage);
});

// ── Thrown non-Error value: must not crash or bypass redaction ─────────────

test('a thrown non-Error value (plain string) in PayPal create-order does not crash and does not leak into logs', async () => {
  const product = await seedProduct({ price: 49 });
  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('/v1/oauth2/token')) {
      // Reject with a bare string instead of an Error instance.
      throw `CANARY-NON-ERROR-THROW ${CANARY.customerName} ${CANARY.token}`;
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    const res = await apiPost('/api/paypal/create-order', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    assert.equal(res.status, 500, 'a non-Error throw must still fail closed with a normal error response, not crash the process');
  });
  axiosMock.mock.restore();

  // The safe-summary helper does not special-case non-Error throws, so this
  // also proves plain property access on a non-object thrown value
  // (`someString.response`, `someString.message`) is safe JS behavior, not
  // a fresh crash -- and confirms the canary embedded in the thrown string
  // itself never reaches a log line (only the string constant name would,
  // if this test's own code echoed it -- it does not).
  const joined = lines.join('\n');
  assert.doesNotMatch(joined, /CANARY-NON-ERROR-THROW/);
});

// ── Secrets: PAYPAL_CLIENT_SECRET / PAYPLUS_API_KEY / PAYPLUS_SECRET_KEY /
// CJ_API_KEY must never appear anywhere, across every scenario above ───────

test('a real PayPal OAuth token-exchange failure never logs the Basic-auth header built from PAYPAL_CLIENT_SECRET', async () => {
  const product = await seedProduct({ price: 50 });
  let capturedAuthHeader = null;
  const axiosMock = mock.method(axios, 'post', async (url, data, config) => {
    if (url.includes('/v1/oauth2/token')) {
      // Confirm the request really was built from the real (canary) secret
      // configured at the top of this file -- proves this test is
      // exercising the actual header-construction code path, not a no-op.
      capturedAuthHeader = config && config.headers && config.headers.Authorization;
      const err = new Error('invalid_client');
      err.response = { status: 401, data: { error: 'invalid_client', error_description: 'Client Authentication failed' } };
      throw err;
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  const lines = await captureConsoleLogs(async () => {
    const res = await apiPost('/api/paypal/create-order', {
      ...SHIPPING_WITH_CANARIES,
      items: [{ id: product.productId, quantity: 1, selectedColor: 'Black', selectedSize: 'M' }],
      currency: 'ILS',
    });
    assert.equal(res.status, 500);
  });
  axiosMock.mock.restore();

  assert.ok(capturedAuthHeader && capturedAuthHeader.startsWith('Basic '), 'sanity: the real auth-header construction code path must have actually run');
  const expectedAuthHeaderValue = `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`;
  assert.equal(capturedAuthHeader, expectedAuthHeaderValue, 'sanity: confirms the header really was built from the configured (canary) secret');

  const joined = lines.join('\n');
  assert.doesNotMatch(joined, /PAYPAL_CLIENT_SECRET|CANARY-SECRET-PAYPAL-CLIENT-SECRET/, 'the raw secret env value must never appear in logs');
  assert.doesNotMatch(joined, new RegExp(capturedAuthHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the actual constructed Authorization header value must never appear in logs');
  assert.doesNotMatch(joined, /Basic [A-Za-z0-9+/=]+/, 'no Basic-auth header of any value should ever be logged');
  assert.match(joined, /PayPal create-order failed: HTTP_401/);
});
