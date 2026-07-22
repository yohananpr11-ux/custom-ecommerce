// Transaction / crash-recovery coverage for the paid-order pipeline.
//
// Scope of THIS file: the payment-verification -> paid-transition boundary
// specifically (PayPal capture, Stripe webhook, PayPlus webhook), including
// a regression test for a real P0 defect found and fixed during this audit
// (see below). It intentionally does NOT re-cover ground already proven
// elsewhere:
//   - Printify draft/supplierOrderId/submission crash boundaries and a real
//     child-process restart against a persisted SQLite file for the
//     fulfillment layer: backend/tests/fulfillment-recovery.test.js
//     (RESTART test) and backend/tests/printify-fulfillment-reconciliation.test.js.
//   - Email failure not rolling back payment/fulfillment, and retry
//     recovery succeeding later: backend/tests/paid-order-notifications.test.js.
//
// REGRESSION BEING TESTED: /api/paypal/capture-order, /api/webhooks/stripe,
// and /api/webhooks/payplus previously called reserveWebhookEvent(provider,
// eventId) (an INSERT OR IGNORE into processed_webhooks) BEFORE the separate
// `UPDATE orders SET status = 'paid'` statement. A process crash/restart
// between those two statements (Render redeploy, OOM, etc.) -- after the
// event was already recorded as "processed" but before the order was
// actually marked paid -- would permanently strand an already-charged
// payment: every future retry/redelivery would be silently treated as
// `duplicate: true` without the order ever transitioning to 'paid' or
// reaching fulfillment, and recoverStalePaidFulfillments() would never see
// it either (it only scans orders that are ALREADY 'paid'). Fixed by making
// `UPDATE orders SET status = 'paid' WHERE id = ? AND status != 'paid'` --
// a single, inherently atomic SQLite statement -- the sole authoritative
// claim on the paid transition, run BEFORE reserveWebhookEvent (which is now
// pure best-effort bookkeeping, never load-bearing for correctness).
//
// The tests below simulate exactly the state a crashed prior attempt would
// have left behind (an order still 'pending_payment', but with a
// processed_webhooks row for that exact event already present) and prove a
// legitimate payment for that order still reaches 'paid' + fulfillment.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { mock } = require('node:test');
const axios = require('axios');
const stripe = require('stripe')('sk_test_e2e_not_real');
const crypto = require('node:crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-crash-recovery-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-crash';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-crash';
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e_not_real';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_e2e_not_real';
process.env.PAYPLUS_API_KEY = 'test-payplus-api-key-crash';
process.env.PAYPLUS_SECRET_KEY = 'test-payplus-secret-key-crash';
process.env.PAYPLUS_PAGE_UID = 'test-payplus-page-uid-crash';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');

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

let nextProductId = 920001;
async function seedPendingOrder({ price = 55, currency = 'ILS' } = {}) {
  const productId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, `Crash Test Product ${productId}`, 'synthetic fixture', price, price / 3.6, 999, 'printify', 'printify', `pf-crash-${productId}`]
  );
  const orderInsert = await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country, expected_payment_currency, expected_payment_amount)
     VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Test Customer', 'test@example.invalid', 'Synthetic Street 1, Faketown, US', price, 'Test', 'Customer', '+15550000000', 'Synthetic Street 1', 'Faketown', 'US', currency, price]
  );
  const orderId = orderInsert.lastID;
  await dbRun(
    `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, 1, ?, 'printify', 'pending')`,
    [orderId, productId, price]
  );
  return { orderId, productId, price, currency };
}

function installPrintifySuccessMocks() {
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: `pf-order-${Math.random().toString(36).slice(2)}`, status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => ({ ok: true, order: { id, status: 'on-hold' } }));
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => ({ ok: true, matchCount: 0, order: null }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));
  return { restore() { createMock.mock.restore(); getMock.mock.restore(); findMock.mock.restore(); submitMock.mock.restore(); } };
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

// ── PayPal: pre-reserved event id must not block the paid transition ───────

test('regression: a PayPal capture still reaches paid + fulfillment even if processed_webhooks already has a row for this exact capture id (simulates a crash between the old reserve-then-update statements)', async () => {
  const { orderId, price, currency } = await seedPendingOrder({ price: 44 });
  const printifyMock = installPrintifySuccessMocks();

  const fakePaypalOrderId = `PPO-CRASH-${orderId}`;
  const captureId = `CAPTURE-${fakePaypalOrderId}`;

  // Simulate the exact stranded state a crash between the OLD reserve and
  // UPDATE statements would have left behind.
  await dbRun(`INSERT INTO processed_webhooks (provider, eventId) VALUES ('paypal', ?)`, [captureId]);

  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.endsWith('/capture')) {
      return {
        data: {
          status: 'COMPLETED',
          purchase_units: [{
            reference_id: String(orderId), custom_id: String(orderId),
            payments: { captures: [{ id: captureId, amount: { currency_code: currency, value: String(price) } }] },
          }],
        },
      };
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  try {
    const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID: fakePaypalOrderId }),
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true, 'a legitimate capture must not be swallowed as a false duplicate just because the event id was already reserved');
    assert.notEqual(json.duplicate, true, 'this is the FIRST time this order is actually being marked paid -- must not report duplicate:true');

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    assert.equal(order.status, 'paid', 'the order must actually reach paid status despite the pre-existing processed_webhooks row');

    const settled = await waitForFulfillmentSettled(orderId);
    assert.notEqual(settled, 'failed');
  } finally {
    axiosMock.mock.restore();
    printifyMock.restore();
  }
});

// ── Stripe: same regression, via the real webhook route ────────────────────

test('regression: a Stripe webhook still reaches paid + fulfillment even if processed_webhooks already has a row for this exact event id', async () => {
  const { orderId, price } = await seedPendingOrder({ price: 66 });
  const printifyMock = installPrintifySuccessMocks();

  const stripeEventId = `evt_crash_${orderId}`;
  await dbRun(`INSERT INTO processed_webhooks (provider, eventId) VALUES ('stripe', ?)`, [stripeEventId]);

  const session = {
    id: `cs_crash_${orderId}`,
    object: 'checkout.session',
    client_reference_id: String(orderId),
    amount_total: Math.round(price * 100 / 3.6 * 100) / 100 * 100, // arbitrary but consistent cents figure
    currency: 'usd',
  };
  const event = {
    id: stripeEventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  };
  const payload = JSON.stringify(event);
  const sigHeader = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

  try {
    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sigHeader },
      body: payload,
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.received, true);
    assert.notEqual(json.duplicate, true, 'must not be swallowed as a false duplicate just because the event id was already reserved');

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    assert.equal(order.status, 'paid');

    const settled = await waitForFulfillmentSettled(orderId);
    assert.notEqual(settled, 'failed');
  } finally {
    printifyMock.restore();
  }
});

// ── PayPlus: same regression, via the real webhook route ───────────────────

test('regression: a PayPlus webhook still reaches paid + fulfillment even if processed_webhooks already has a row for this exact transaction id', async () => {
  const { orderId } = await seedPendingOrder({ price: 77 });
  const printifyMock = installPrintifySuccessMocks();

  const transactionUid = `txn-crash-${orderId}`;
  await dbRun(`INSERT INTO processed_webhooks (provider, eventId) VALUES ('payplus', ?)`, [transactionUid]);

  const payload = JSON.stringify({ transaction_uid: transactionUid, status: 'success', custom_field: String(orderId) });
  const hash = crypto.createHmac('sha256', process.env.PAYPLUS_SECRET_KEY).update(payload).digest('base64');

  try {
    const res = await fetch(`${baseUrl}/api/webhooks/payplus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', hash },
      body: payload,
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.received, true);
    assert.notEqual(json.duplicate, true, 'must not be swallowed as a false duplicate just because the event id was already reserved');

    const order = await dbGet(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    assert.equal(order.status, 'paid');

    const settled = await waitForFulfillmentSettled(orderId);
    assert.notEqual(settled, 'failed');
  } finally {
    printifyMock.restore();
  }
});

// ── A genuinely already-paid order must still be reported as a duplicate ───
// (proves the fix didn't accidentally remove real duplicate protection)

test('a truly already-paid order is still correctly reported as a duplicate, with no second fulfillment trigger', async () => {
  const { orderId, price, currency } = await seedPendingOrder({ price: 88 });
  const printifyMock = installPrintifySuccessMocks();
  const fakePaypalOrderId = `PPO-DUP-${orderId}`;
  const captureId = `CAPTURE-${fakePaypalOrderId}`;

  const axiosMock = mock.method(axios, 'post', async (url) => {
    if (url.includes('/v1/oauth2/token')) return { data: { access_token: 'fake-token' } };
    if (url.endsWith('/capture')) {
      return {
        data: {
          status: 'COMPLETED',
          purchase_units: [{
            reference_id: String(orderId), custom_id: String(orderId),
            payments: { captures: [{ id: captureId, amount: { currency_code: currency, value: String(price) } }] },
          }],
        },
      };
    }
    throw new Error(`UNEXPECTED axios.post to ${url}`);
  });

  try {
    const first = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID: fakePaypalOrderId }),
    }).then((r) => r.json());
    assert.equal(first.success, true);
    await waitForFulfillmentSettled(orderId);

    const createCallsBefore = printifyMock; // no direct counter needed -- assert via DB row count instead

    const second = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID: fakePaypalOrderId }),
    }).then((r) => r.json());
    assert.equal(second.duplicate, true, 'a genuinely already-paid order must still short-circuit as a duplicate');

    const fulfillmentRows = await new Promise((resolve, reject) => {
      db.all(`SELECT COUNT(*) AS n FROM supplier_fulfillments WHERE orderId = ?`, [orderId], (err, rows) => { if (err) reject(err); else resolve(rows); });
    });
    assert.equal(fulfillmentRows[0].n, 1, 'exactly one supplier_fulfillments row -- the duplicate capture must not trigger a second fulfillment attempt');
    void createCallsBefore;
  } finally {
    axiosMock.mock.restore();
    printifyMock.restore();
  }
});

// ── Real child process against a persisted temporary SQLite file ──────────
// Section 7 explicitly requires at least one crash-recovery test that uses a
// real child process / fresh module process against a persisted temp SQLite
// file, rather than only in-process re-calls within the same Node instance
// (which cannot rule out state accidentally surviving in module-level JS
// variables). This proves the exact same regression above holds even when
// the process that performs the capture has never held any in-memory state
// from before the crash-simulating DB row was written -- the strongest
// available proof that the fix is durable across a real restart, not an
// artifact of this test file's own process still being warm.

test('RESTART: a fresh child process capturing against a persisted SQLite file still reaches paid + fulfillment despite a pre-existing processed_webhooks row for the same capture id', async () => {
  const restartTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-crash-restart-'));
  const restartDbPath = path.join(restartTmpDir, 'restart.db');

  const sqlite3 = require('sqlite3').verbose();
  const seedConn = new sqlite3.Database(restartDbPath);

  const localOrderId = 1;
  const price = 33;
  const currency = 'ILS';
  const fakePaypalOrderId = `PPO-RESTART-${Date.now()}`;
  const captureId = `CAPTURE-${fakePaypalOrderId}`;

  await new Promise((resolve, reject) => {
    seedConn.serialize(() => {
      seedConn.run(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, price REAL NOT NULL,
          priceUSD REAL, imageUrl TEXT, backImageUrl TEXT, images TEXT, stock INTEGER DEFAULT 0,
          type TEXT DEFAULT 'local', printifyId TEXT, fabric TEXT, careInstructions TEXT, deliveryInfo TEXT,
          supplier_id TEXT NOT NULL DEFAULT 'printify'
        )`);
      seedConn.run(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, customerName TEXT NOT NULL, customerEmail TEXT NOT NULL,
          address TEXT NOT NULL, firstName TEXT, lastName TEXT, phone TEXT, addressLine1 TEXT, addressLine2 TEXT,
          city TEXT, region TEXT, postalCode TEXT, country TEXT, totalAmount REAL NOT NULL,
          shippingCost REAL DEFAULT 0, promoCode TEXT, promoDiscount REAL DEFAULT 0, status TEXT DEFAULT 'pending',
          locale TEXT DEFAULT 'he', currency TEXT DEFAULT 'ILS', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          expected_payment_currency TEXT, expected_payment_amount REAL,
          emailSent INTEGER DEFAULT 0, emailAttempts INTEGER DEFAULT 0, lastEmailAttemptAt DATETIME
        )`);
      seedConn.run(`
        CREATE TABLE order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER, productId INTEGER, variantId INTEGER,
          quantity INTEGER, price REAL, selectedColor TEXT, selectedSize TEXT, supplier_id TEXT,
          fulfillment_status TEXT DEFAULT 'pending', fulfillment_ref TEXT
        )`);
      seedConn.run(`
        CREATE TABLE processed_webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, eventId TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider, eventId)
        )`);
      seedConn.run(`INSERT INTO products (title, description, price, stock, type, supplier_id, printifyId) VALUES ('Restart Crash Test Product', 'x', ${price}, 10, 'printify', 'printify', 'pf-product-crash-restart')`);
      seedConn.run(
        `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country, expected_payment_currency, expected_payment_amount)
         VALUES ('Test Customer', 'test@example.invalid', 'Synthetic Street 1, Faketown, US', ${price}, 'pending_payment', 'Test', 'Customer', '+15550000000', 'Synthetic Street 1', 'Faketown', 'US', '${currency}', ${price})`
      );
      seedConn.run(`INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (${localOrderId}, 1, 1, ${price}, 'printify', 'pending')`);
      // Simulate the exact stranded state a crash between the OLD
      // reserve-then-update statements would have left behind, written by a
      // process that (in this test) never existed at all -- this file is
      // seeded directly, proving the fix works from cold, persisted state.
      seedConn.run(`INSERT INTO processed_webhooks (provider, eventId) VALUES ('paypal', ?)`, [captureId], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  });
  await new Promise((resolve) => seedConn.close(resolve));

  const harnessPath = path.join(__dirname, '..', 'scripts', 'paid-order-crash-harness.cjs');
  // NODE_OPTIONS (not a bare -r CLI flag, which would apply only to THIS
  // process and not propagate to the spawned child) is what actually makes
  // the guard active inside the harness process. Belt-and-suspenders on top
  // of the harness's own hardcoded axios.post override and the real
  // PRINTIFY_API_TOKEN-unset missing-token guard -- matches this task's
  // explicit "preload the network guard for all tests and scripts"
  // requirement literally, not only via other structural safety.
  const guardPath = path.join(__dirname, '..', 'scripts', 'network-guard.cjs');
  const harnessGuardLogPath = path.join(restartTmpDir, 'harness-guard.jsonl');
  const spawnResult = spawnSync(process.execPath, [harnessPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: restartDbPath,
      PRINTIFY_API_TOKEN: '',
      PRINTIFY_SHOP_ID: '',
      ENABLE_PRINTIFY_SYNC: 'false',
      TELEGRAM_BOT_TOKEN: '',
      RESEND_API_KEY: '',
      NODE_ENV: 'test',
      HERMETIC_TEST_MODE: 'true',
      DISABLE_BACKGROUND_JOBS: 'true',
      PAYPAL_CLIENT_ID: 'test-paypal-client-id-restart',
      PAYPAL_CLIENT_SECRET: 'test-paypal-client-secret-restart',
      CRASH_HARNESS_FAKE_PAYPAL_ORDER_ID: fakePaypalOrderId,
      CRASH_HARNESS_LOCAL_ORDER_ID: String(localOrderId),
      CRASH_HARNESS_EXPECTED_CURRENCY: currency,
      CRASH_HARNESS_EXPECTED_AMOUNT: String(price),
      NODE_OPTIONS: `-r ${guardPath}`,
      NETWORK_GUARD_LOG_PATH: harnessGuardLogPath,
    },
    encoding: 'utf8',
    timeout: 20000,
  });

  assert.equal(spawnResult.status, 0, `harness child process must exit 0; stderr: ${spawnResult.stderr}\nstdout: ${spawnResult.stdout}`);
  assert.match(spawnResult.stdout, /CRASH_HARNESS_RESULT=/, 'harness must print its result marker');

  const resultLine = spawnResult.stdout.split('\n').find((l) => l.startsWith('CRASH_HARNESS_RESULT='));
  const result = JSON.parse(resultLine.replace('CRASH_HARNESS_RESULT=', ''));

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.success, true, `capture must succeed in the fresh process: ${JSON.stringify(result.body)}`);
  assert.notEqual(result.body.duplicate, true, 'the fresh process must not treat this as a false duplicate despite the pre-seeded processed_webhooks row');
  assert.equal(result.orderStatusAfter, 'paid', 'the persisted order must actually reach paid status');
  assert.notEqual(result.itemFulfillmentStatusAfter, 'pending', 'fulfillment must have been dispatched (missing-token guard path), not left untouched');
  assert.equal(result.processedWebhookRowCount, 1, 'still exactly one processed_webhooks row for this capture id -- no duplicate bookkeeping row either');

  // Confirm the guard was genuinely active INSIDE the harness process (not
  // only structurally safe via its own axios override / the real
  // missing-token guard) and that it recorded zero blocked/external calls.
  assert.ok(fs.existsSync(harnessGuardLogPath), 'the harness process must have written its own network-guard log -- proof the guard actually loaded inside the spawned child, not just the parent test process');
  const harnessGuardLines = fs.readFileSync(harnessGuardLogPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(harnessGuardLines.some((l) => l.activated === true), 'harness guard log must contain an activation marker');
  const harnessBlocked = harnessGuardLines.filter((l) => l.allowed === false);
  assert.equal(harnessBlocked.length, 0, `harness process must make zero blocked/external network attempts: ${JSON.stringify(harnessBlocked)}`);

  // Re-open the same file from THIS process, after the child has fully
  // exited and released its handle, as independent confirmation.
  const verifyConn = new sqlite3.Database(restartDbPath, sqlite3.OPEN_READONLY);
  const finalRow = await new Promise((resolve, reject) => {
    verifyConn.get(`SELECT status FROM orders WHERE id = ?`, [localOrderId], (err, row) => { if (err) reject(err); else resolve(row); });
  });
  await new Promise((resolve) => verifyConn.close(resolve));
  assert.equal(finalRow.status, 'paid');

  try { fs.rmSync(restartTmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});
