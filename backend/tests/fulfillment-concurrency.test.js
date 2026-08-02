const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

// Isolated throwaway DB — never the real backend/ecommerce.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fulfillment-concurrency-test-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.ENABLE_PRINTIFY_SYNC = 'false';
// Deliberately blank so even an unstubbed downstream call couldn't reach a
// real service — defense in depth on top of the explicit stub below.
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

// require.main !== module (required by the test runner, not run directly),
// so index.js's own require.main guard skips app.listen()/pricingEngine.start().
const { processPaidOrderFulfillment } = require('../index.js');
const db = require('../db.js');
const fulfillmentService = require('../services/fulfillment.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

test.after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort cleanup only (Windows may still hold the file open) */ }
});

test('two concurrent processPaidOrderFulfillment calls for the same order dispatch every item exactly once', async () => {
  // Give the schema-migration block (async IIFE in db.js) a moment to finish
  // creating tables/columns before we insert against them.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const dispatchCalls = [];
  const routeOrderToSupplierMock = mock.method(
    fulfillmentService,
    'routeOrderToSupplier',
    async (orderId, shippingDestination, items) => {
      // Record exactly what this specific invocation was asked to dispatch —
      // this is what proves (or disproves) double-dispatch, not a real call.
      dispatchCalls.push(items.map((i) => i.id));
    }
  );

  try {
    const productInsert = await dbRun(
      `INSERT INTO products (title, description, price, priceUSD, stock, type, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Concurrency Test Product', 'seeded for fulfillment concurrency test', 100, 27, 10, 'cj', 'cj']
    );
    const productId = productInsert.lastID;

    const orderInsert = await dbRun(
      `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Concurrency Test', 'concurrency-test@example.com', '1 Test St, Tel Aviv, IL', 400, 'paid', 'Concurrency', 'Test', '0500000000', '1 Test St', 'Tel Aviv', 'IL']
    );
    const orderId = orderInsert.lastID;

    const ITEM_COUNT = 5;
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      await dbRun(
        `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, productId, 1, 100, 'cj', 'pending']
      );
    }

    // The actual concurrency test: fire both invocations together, not
    // sequentially — this is what a race between two near-simultaneous
    // payment confirmations for the same order would look like.
    await Promise.all([
      processPaidOrderFulfillment(orderId, 'ConcurrencyTest-A'),
      processPaidOrderFulfillment(orderId, 'ConcurrencyTest-B'),
    ]);

    const allDispatchedIds = dispatchCalls.flat();
    const uniqueDispatchedIds = new Set(allDispatchedIds);

    assert.equal(
      allDispatchedIds.length,
      ITEM_COUNT,
      `expected exactly ${ITEM_COUNT} total dispatched items across both invocations, got ${allDispatchedIds.length}`
    );
    assert.equal(
      uniqueDispatchedIds.size,
      ITEM_COUNT,
      'every dispatched item id must be unique — a repeated id means the same item was dispatched twice'
    );

    // At most one of the two invocations should have found any work at all
    // in the common case (the loser sees zero eligible rows and returns
    // early) — assert neither call saw the other's already-claimed rows.
    const nonEmptyCalls = dispatchCalls.filter((c) => c.length > 0);
    assert.ok(nonEmptyCalls.length >= 1, 'at least one invocation must have dispatched the items');
    const seen = new Set();
    for (const call of dispatchCalls) {
      for (const id of call) {
        assert.ok(!seen.has(id), `item id ${id} was claimed/dispatched by more than one invocation`);
        seen.add(id);
      }
    }

    const finalItems = await dbAll(`SELECT id, fulfillment_status FROM order_items WHERE orderId = ?`, [orderId]);
    assert.equal(finalItems.length, ITEM_COUNT);
    for (const item of finalItems) {
      assert.notEqual(item.fulfillment_status, 'pending', `item ${item.id} was never claimed by either invocation`);
    }
  } finally {
    routeOrderToSupplierMock.mock.restore();
  }
});
