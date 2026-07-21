// Offline, no-live-network coverage for the durable Printify fulfillment
// state machine (backend/services/fulfillment.js's handlePrintify() +
// backend/services/printify.js's create/get/find/submit split).
//
// Every Printify API call is mocked via node:test's mock.method() on the
// printify service singleton — no real HTTP request to api.printify.com is
// ever possible from this file. The CI workflow additionally preloads
// backend/scripts/network-guard.cjs (see .github/workflows/p0-verify.yml),
// which hard-blocks any outbound http/https/fetch call to a non-localhost
// host at the socket layer as defense in depth on top of these mocks.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printify-fulfillment-test-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

// require.main !== module (required by the test runner), so index.js's own
// require.main guard skips app.listen()/pricingEngine.start() — no port is
// ever bound.
const { processPaidOrderFulfillment } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const fulfillmentModule = require('../services/fulfillment.js');
const { handlePrintify, routeOrderToSupplier, deterministicExternalId, deterministicLineExternalId } = fulfillmentModule;

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

// Give db.js's async schema-migration IIFE time to finish creating
// supplier_fulfillments (and every addColumnIfMissing column) before any
// test inserts against it.
test.before(async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
});

const FAKE_DESTINATION = {
  customerName: 'Test Customer',
  customerEmail: 'test-fixture@example.com',
  firstName: 'Test',
  lastName: 'Customer',
  phone: '0500000000',
  addressLine1: '1 Fixture St',
  city: 'Tel Aviv',
  country: 'IL',
  postalCode: '6100000',
};

// Seeds one product + one order + N printify order_items, returns
// { productId, orderId, itemIds }.
async function seedPrintifyOrder(itemCount = 1) {
  const productInsert = await dbRun(
    `INSERT INTO products (title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Reconciliation Test Product', 'seeded for printify fulfillment reconciliation tests', 150, 40, 10, 'printify', 'printify', 'pf-product-abc']
  );
  const productId = productInsert.lastID;

  const orderInsert = await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Test Customer', 'test-fixture@example.com', '1 Fixture St, Tel Aviv, IL', 150 * itemCount, 'paid', 'Test', 'Customer', '0500000000', '1 Fixture St', 'Tel Aviv', 'IL']
  );
  const orderId = orderInsert.lastID;

  const itemIds = [];
  for (let i = 0; i < itemCount; i += 1) {
    const itemInsert = await dbRun(
      `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, productId, 1, 150, 'printify', 'pending']
    );
    itemIds.push(itemInsert.lastID);
  }

  const items = await dbAll(
    `SELECT oi.id, oi.orderId, oi.quantity, oi.price, oi.supplier_id,
            'pf-product-abc' AS printifyProductId, 'pf-variant-123' AS printifyVariantId
     FROM order_items oi WHERE oi.orderId = ?`,
    [orderId]
  );

  return { productId, orderId, itemIds, items };
}

function restoreAll(mocks) {
  for (const m of mocks) { try { m.mock.restore(); } catch { /* already restored */ } }
}

// ── 1. Unpaid/unclaimed order never triggers any Printify call ─────────────
test('an order with no claimable pending items never calls any Printify method', async () => {
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => { throw new Error('must not be called'); });
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => { throw new Error('must not be called'); });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => { throw new Error('must not be called'); });

  try {
    // Order id that doesn't exist at all — processPaidOrderFulfillment must
    // be a no-op, proving it never starts supplier work on unverified input.
    await processPaidOrderFulfillment(999999999, 'Test');
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(getMock.mock.callCount(), 0);
    assert.equal(findMock.mock.callCount(), 0);
    assert.equal(submitMock.mock.callCount(), 0);

    // A real order whose items are already claimed (not pending/null) must
    // also be a no-op — this is the same trusted-claim gate the PayPal
    // capture route relies on before ever calling this function.
    const { orderId, itemIds } = await seedPrintifyOrder(1);
    await dbRun(`UPDATE order_items SET fulfillment_status = 'submitted' WHERE id = ?`, [itemIds[0]]);
    await processPaidOrderFulfillment(orderId, 'Test');
    assert.equal(createMock.mock.callCount(), 0);
  } finally {
    restoreAll([createMock, getMock, findMock, submitMock]);
  }
});

// ── 2/3. Valid paid order → exactly one supplier_fulfillments row, one create ──
test('a valid paid order creates exactly one supplier-fulfillment record and exactly one Printify create request', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-order-1', status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-1', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 1);

    const rows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(rows.length, 1, 'exactly one supplier_fulfillments row must exist for this order/supplier');
    assert.equal(rows[0].externalId, deterministicExternalId(orderId));
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 4/5/6. Normal path: submit once, id persisted before submit, ends submitted ──
test('normal path: real Printify order id is persisted before send-to-production, exactly one submit call, ends submitted', async () => {
  const { orderId, items, itemIds } = await seedPrintifyOrder(1);
  let idWasPersistedBeforeSubmit = false;

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-order-2', status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-2', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async (printifyOrderId) => {
    const row = await dbGet(`SELECT supplierOrderId FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    idWasPersistedBeforeSubmit = row && row.supplierOrderId === printifyOrderId;
    return { ok: true };
  });

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 1, 'exactly one create request');
    assert.equal(submitMock.mock.callCount(), 1, 'exactly one submit request');
    assert.equal(idWasPersistedBeforeSubmit, true, 'the real Printify order id must be durably stored before send-to-production is called');

    const row = await dbGet(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.state, 'submitted');
    assert.equal(row.supplierOrderId, 'pf-order-2');
    assert.equal(result.ref, 'pf-order-2');

    const itemRows = await dbAll(`SELECT fulfillment_status, fulfillment_ref FROM order_items WHERE id IN (${itemIds.map(() => '?').join(',')})`, itemIds);
    for (const item of itemRows) {
      assert.equal(item.fulfillment_status, 'submitted');
      assert.equal(item.fulfillment_ref, 'pf-order-2', 'the REAL Printify order id must be stored as the item ref, not a synthetic PRINTIFY-ORD-<localId> string');
    }
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 7. Retrying an already-submitted order is a full no-op on the supplier side ──
test('retrying an already-submitted order creates zero new orders and sends zero duplicate submit requests', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, supplierOrderId, state, attemptCount) VALUES (?, 'printify', ?, 'pf-order-3', 'submitted', 1)`,
    [orderId, deterministicExternalId(orderId)]
  );

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => { throw new Error('must not be called'); });
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => { throw new Error('must not be called'); });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => { throw new Error('must not be called'); });

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(result.ref, 'pf-order-3');
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(getMock.mock.callCount(), 0);
    assert.equal(findMock.mock.callCount(), 0);
    assert.equal(submitMock.mock.callCount(), 0);
  } finally {
    restoreAll([createMock, getMock, findMock, submitMock]);
  }
});

// ── 8. Crash after remote create but before local persistence ──────────────
test('crash after remote create but before local persistence: reconciliation finds the existing remote order, no second create', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  // supplierOrderId is null — simulating the exact crash window where
  // creation succeeded remotely but the local persist write never happened.
  const extId = deterministicExternalId(orderId);

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called — an order already exists remotely'); });
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async (id) => {
    assert.equal(id, extId);
    return { ok: true, matchCount: 1, order: { id: 'pf-order-existing', status: 'on-hold', external_id: extId } };
  });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 0, 'no second create request');
    assert.equal(findMock.mock.callCount(), 1);
    assert.equal(result.ref, 'pf-order-existing');
    const row = await dbGet(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.supplierOrderId, 'pf-order-existing');
    assert.equal(row.state, 'submitted');
  } finally {
    restoreAll([createMock, findMock, submitMock]);
  }
});

// ── 9. Crash after local persistence but before submit ─────────────────────
test('crash after local persistence but before submit: retry uses the stored Printify order id, no second create request', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, supplierOrderId, state, attemptCount) VALUES (?, 'printify', ?, 'pf-order-4', 'created', 1)`,
    [orderId, deterministicExternalId(orderId)]
  );

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => {
    assert.equal(id, 'pf-order-4');
    return { ok: true, order: { id: 'pf-order-4', status: 'on-hold', external_id: deterministicExternalId(orderId) } };
  });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(submitMock.mock.callCount(), 1);
    assert.equal(result.ref, 'pf-order-4');
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 10. Lost send response but remote already in-production ────────────────
test('lost send response but remote state is already in-production: retry performs no second send request', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, supplierOrderId, state, attemptCount) VALUES (?, 'printify', ?, 'pf-order-5', 'submitting', 1)`,
    [orderId, deterministicExternalId(orderId)]
  );

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-5', status: 'in-production', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => { throw new Error('must not be called — already in production'); });

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(submitMock.mock.callCount(), 0);
    assert.equal(result.ref, 'pf-order-5');
    const row = await dbGet(`SELECT state FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.state, 'submitted');
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 11. Create timeout/ambiguous response: reconcile before any create attempt ──
test('a prior create_failed record with no known order id reconciles by external id before any new create attempt', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const extId = deterministicExternalId(orderId);
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, supplierOrderId, state, lastErrorCode, attemptCount) VALUES (?, 'printify', ?, NULL, 'create_failed', 'HTTP_504', 1)`,
    [orderId, extId]
  );

  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async (id) => {
    assert.equal(id, extId);
    return { ok: true, matchCount: 0, order: null };
  });
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-order-6', status: 'on-hold' }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(findMock.mock.callCount(), 1, 'must reconcile before creating');
    assert.equal(createMock.mock.callCount(), 1, 'zero matches found — exactly one create is allowed');
  } finally {
    restoreAll([findMock, createMock, submitMock]);
  }
});

// ── 12. Multiple external-id matches ────────────────────────────────────────
test('multiple external-id matches: reconcile_required is set, no create, no submit', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => ({ ok: true, matchCount: 2, order: null }));
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => { throw new Error('must not be called'); });

  try {
    await assert.rejects(() => handlePrintify(orderId, FAKE_DESTINATION, items));
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(submitMock.mock.callCount(), 0);
    const row = await dbGet(`SELECT state, lastErrorCode FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.state, 'reconcile_required');
    assert.equal(row.lastErrorCode, 'AMBIGUOUS_EXTERNAL_ID_MATCH');
  } finally {
    restoreAll([findMock, createMock, submitMock]);
  }
});

// ── 13. Send failure keeps the real supplier order id, safely retryable ────
test('send failure: real supplier order id remains stored and the record is safely retryable afterward', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-order-7', status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-7', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: false, errorCode: 'HTTP_502' }));

  try {
    await assert.rejects(() => handlePrintify(orderId, FAKE_DESTINATION, items));
    const row = await dbGet(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.state, 'submit_failed');
    assert.equal(row.supplierOrderId, 'pf-order-7', 'the real order id must not be discarded on submit failure');
    assert.equal(row.lastErrorCode, 'HTTP_502');
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 14. Stale claimed/reconciling record is not blindly reset and recreated ──
test('a stale reconciling record with a known order id is not blindly reset and recreated — it resumes from the known id', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  // Simulates a process that crashed exactly while sitting in 'reconciling'
  // after already discovering/persisting a real order id.
  await dbRun(
    `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, supplierOrderId, state, attemptCount) VALUES (?, 'printify', ?, 'pf-order-8', 'reconciling', 3)`,
    [orderId, deterministicExternalId(orderId)]
  );

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called — record already has a known order id'); });
  const getMock = mock.method(printify, 'getPrintifyOrder', async (id) => ({ ok: true, order: { id, status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    const result = await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(result.ref, 'pf-order-8');
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 15. Telegram failure does not lose fulfillment state ───────────────────
test('a Telegram notification failure does not affect durable fulfillment state', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const telegram = require('../services/telegram.js');
  const telegramMock = mock.method(telegram, 'sendMessage', async () => { throw new Error('simulated Telegram outage'); });
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => ({ ok: true, orderId: 'pf-order-9', status: 'on-hold' }));
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-9', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    // routeOrderToSupplier is what actually calls telegram.sendMessage; the
    // outer index.js catch also swallows telegram errors, but this exercises
    // the real integration point.
    await routeOrderToSupplier(orderId, FAKE_DESTINATION, items);
    const row = await dbGet(`SELECT state, supplierOrderId FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(row.state, 'submitted');
    assert.equal(row.supplierOrderId, 'pf-order-9');
  } finally {
    restoreAll([telegramMock, createMock, getMock, submitMock]);
  }
});

// ── 16. A missing local persistence looks identical to, and recovers like, a crash ──
test('next retry reconciles without duplication when local persistence never happened for a remotely-created order', async () => {
  // Same observable precondition as the "crash after remote create" test —
  // no local row references a supplier order id, but one exists remotely.
  // This is what a failed SQLite write after supplier success looks like
  // from the next invocation's point of view, since nothing about that
  // failure is distinguishable from a process crash at the same point.
  const { orderId, items } = await seedPrintifyOrder(1);
  const extId = deterministicExternalId(orderId);
  const findMock = mock.method(printify, 'findPrintifyOrderByExternalId', async () => ({ ok: true, matchCount: 1, order: { id: 'pf-order-10', status: 'payment-not-received', external_id: extId } }));
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => { throw new Error('must not be called'); });
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(submitMock.mock.callCount(), 1, 'payment-not-received is still safe to submit, same as on-hold');
  } finally {
    restoreAll([findMock, createMock, submitMock]);
  }
});

// ── 17. Client-supplied IDs cannot override the trusted DB mapping ─────────
test('the Printify create payload uses exactly the product/variant ids carried on the trusted item objects, nothing else', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  let capturedItems = null;
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async ({ items: draftItems }) => {
    capturedItems = draftItems;
    return { ok: true, orderId: 'pf-order-11', status: 'on-hold' };
  });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-11', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(capturedItems.length, 1);
    // These values came only from the DB-joined `items` argument (see
    // seedPrintifyOrder's SELECT) — handlePrintify has no other source for
    // product/variant identity, so nothing client-supplied could reach here.
    assert.equal(capturedItems[0].printifyProductId, 'pf-product-abc');
    assert.equal(capturedItems[0].printifyVariantId, 'pf-variant-123');
    assert.equal(capturedItems[0].lineExternalId, deterministicLineExternalId(items[0].id));
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});

// ── 18. CJ/dropship items never enter the Printify path ────────────────────
test('mixed printify + dropship items in one order: only the printify-supplier items reach createPrintifyOrderDraft', async () => {
  const productInsert = await dbRun(
    `INSERT INTO products (title, description, price, stock, type, supplier_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ['CJ Mixed Test Product', 'seeded for supplier-separation test', 100, 10, 'cj', 'dropship']
  );
  const cjProductId = productInsert.lastID;
  const { orderId, productId: printifyProductId } = await seedPrintifyOrder(1);
  const cjItemInsert = await dbRun(
    `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, cjProductId, 1, 100, 'dropship', 'pending']
  );

  const items = await dbAll(
    `SELECT oi.id, oi.orderId, oi.quantity, oi.price, oi.supplier_id,
            CASE WHEN oi.supplier_id = 'printify' THEN 'pf-product-abc' END AS printifyProductId,
            CASE WHEN oi.supplier_id = 'printify' THEN 'pf-variant-123' END AS printifyVariantId
     FROM order_items oi WHERE oi.orderId = ?`,
    [orderId]
  );
  assert.equal(items.length, 2);

  const dropship = require('../services/dropship.js');
  const dropshipMock = mock.method(dropship, 'sendOrder', async () => ({ ref: 'CJ-REF-123' }));
  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async ({ items: draftItems }) => {
    assert.equal(draftItems.length, 1, 'only the printify-supplier item may be included');
    return { ok: true, orderId: 'pf-order-12', status: 'on-hold' };
  });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-12', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await routeOrderToSupplier(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 1);
    assert.equal(dropshipMock.mock.callCount(), 1);
    void cjItemInsert;
    void printifyProductId;
  } finally {
    restoreAll([dropshipMock, createMock, getMock, submitMock]);
  }
});

// ── 19. Recipient data and credentials never appear in logs or thrown errors ──
test('a Printify error containing recipient-shaped response data never leaks into the thrown error or persisted error code', async () => {
  const { orderId, items } = await seedPrintifyOrder(1);
  const secretMarker = 'LEAK-MARKER-yohanan-pereira-halotem-nesher';

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async () => {
    // Simulate what the REAL printify.js does: it must reduce a raw axios
    // error (whose response body could echo submitted address fields) down
    // to a coarse code before ever returning from the service layer.
    const fakeAxiosError = {
      response: { status: 400, data: { errors: { address1: [`Invalid address: ${secretMarker}`] } } },
    };
    return { ok: false, errorCode: printify._safeErrorCode(fakeAxiosError) };
  });

  try {
    await assert.rejects(
      () => handlePrintify(orderId, FAKE_DESTINATION, items),
      (err) => {
        assert.ok(!err.message.includes(secretMarker), 'thrown error must not contain response-body content');
        return true;
      }
    );
    const row = await dbGet(`SELECT lastErrorCode FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.ok(!String(row.lastErrorCode).includes(secretMarker));
    assert.equal(row.lastErrorCode, 'HTTP_400');
  } finally {
    restoreAll([createMock]);
  }
});

// ── 22. Schema initialization is idempotent ─────────────────────────────────
test('ensuring a supplier_fulfillments record twice for the same order/supplier never creates a duplicate row', async () => {
  const { orderId } = await seedPrintifyOrder(1);
  const extId = deterministicExternalId(orderId);
  // Calling the same INSERT OR IGNORE path twice must be a safe no-op the
  // second time — this is the same idempotency property db.js's own
  // CREATE TABLE IF NOT EXISTS / addColumnIfMissing pattern relies on.
  await dbRun(
    `INSERT OR IGNORE INTO supplier_fulfillments (orderId, supplierId, externalId, state, attemptCount) VALUES (?, 'printify', ?, 'pending', 0)`,
    [orderId, extId]
  );
  await dbRun(
    `INSERT OR IGNORE INTO supplier_fulfillments (orderId, supplierId, externalId, state, attemptCount) VALUES (?, 'printify', ?, 'pending', 0)`,
    [orderId, extId]
  );
  const rows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
  assert.equal(rows.length, 1);
});

// ── 23. Multiple Printify items in one order → one supplier order, correctly linked ──
test('multiple Printify items belonging to one local order result in exactly one supplier order and every item correctly linked', async () => {
  const { orderId, items, itemIds } = await seedPrintifyOrder(3);
  assert.equal(items.length, 3);

  const createMock = mock.method(printify, 'createPrintifyOrderDraft', async ({ items: draftItems }) => {
    assert.equal(draftItems.length, 3, 'all three local items must be bundled into one Printify order');
    return { ok: true, orderId: 'pf-order-13', status: 'on-hold' };
  });
  const getMock = mock.method(printify, 'getPrintifyOrder', async () => ({ ok: true, order: { id: 'pf-order-13', status: 'on-hold', external_id: deterministicExternalId(orderId) } }));
  const submitMock = mock.method(printify, 'sendPrintifyOrderToProduction', async () => ({ ok: true }));

  try {
    await handlePrintify(orderId, FAKE_DESTINATION, items);
    assert.equal(createMock.mock.callCount(), 1, 'exactly one supplier order, not one per item');

    const rows = await dbAll(`SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = 'printify'`, [orderId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].supplierOrderId, 'pf-order-13');

    const itemRows = await dbAll(`SELECT fulfillment_status, fulfillment_ref FROM order_items WHERE id IN (${itemIds.map(() => '?').join(',')})`, itemIds);
    assert.equal(itemRows.length, 3);
    for (const item of itemRows) {
      assert.equal(item.fulfillment_status, 'submitted');
      assert.equal(item.fulfillment_ref, 'pf-order-13', 'every local item must be linked to the same real supplier order id');
    }
  } finally {
    restoreAll([createMock, getMock, submitMock]);
  }
});
