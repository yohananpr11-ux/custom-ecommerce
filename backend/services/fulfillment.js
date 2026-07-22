/**
 * fulfillment.js
 * ──────────────────────────────────────────────────────────────────────────
 * Central fulfillment router for Drip Street — Phase 3 Multi-Vendor.
 *
 * Replaces the hardcoded Printify-only logic that lived inside
 * processPaidOrderFulfillment() in index.js.
 *
 * How it works:
 *   1. Receives all order_items for a paid order (already joined with products).
 *   2. Groups items by supplier_id.
 *   3. Dispatches each group to the correct supplier adapter in parallel.
 *   4. Writes fulfillment_status + fulfillment_ref back to order_items.
 *   5. Reports per-supplier outcome to Telegram.
 *   6. Throws an aggregate error if ANY supplier submission failed,
 *      so the caller (index.js) can alert appropriately.
 *
 * Supplier adapters (must all expose `sendOrder(orderId, destination, items)`):
 *   'printify' → services/printify.js
 *   'dropship' → services/dropship.js   (stub until Phase 3.2)
 *   'manual'   → inline markAsManual()  (Telegram alert only)
 *
 * Printify specifically is durable/idempotent across retries and crashes —
 * see handlePrintify() below and backend/db.js's `supplier_fulfillments`
 * table, which is the source of truth for whether a real Printify order
 * already exists for a given local order, independent of what order_items
 * currently shows in the UI.
 */

'use strict';

const db       = require('../db');
const printify = require('./printify');
const dropship = require('./dropship');
const telegram = require('./telegram');

// ── DB helpers ────────────────────────────────────────────────────────────────

const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGetAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

const dbAllAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

// ── Per-item status writer ────────────────────────────────────────────────────

/**
 * Atomically update fulfillment_status and fulfillment_ref for a batch of items.
 * @param {number[]} itemIds
 * @param {'submitted'|'processing'|'failed'} status
 * @param {string} ref  Supplier order reference (or error note)
 */
async function writeItemStatus(itemIds, status, ref) {
  if (!itemIds.length) return;
  const placeholders = itemIds.map(() => '?').join(', ');
  await dbRunAsync(
    `UPDATE order_items
       SET fulfillment_status = ?, fulfillment_ref = ?
     WHERE id IN (${placeholders})`,
    [status, ref, ...itemIds]
  );
}

// ── supplier_fulfillments helpers ───────────────────────────────────────────
// The durable, per-(order,supplier) source of truth for create/submit
// idempotency. order_items.fulfillment_status stays a simple UI-facing
// summary (pending/processing/submitted/failed); this table is what a
// retry actually reconciles against.

const deterministicExternalId = (orderId) => `joakim-order-${orderId}-printify-v1`;
const deterministicLineExternalId = (orderItemId) => `joakim-item-${orderItemId}`;

async function ensureSupplierFulfillmentRecord(orderId, supplierId, externalId) {
  await dbRunAsync(
    `INSERT OR IGNORE INTO supplier_fulfillments (orderId, supplierId, externalId, state, attemptCount)
     VALUES (?, ?, ?, 'pending', 0)`,
    [orderId, supplierId, externalId]
  );
}

function getSupplierFulfillment(orderId, supplierId) {
  return dbGetAsync(
    `SELECT * FROM supplier_fulfillments WHERE orderId = ? AND supplierId = ?`,
    [orderId, supplierId]
  );
}

// A single supplier HTTP call is bounded by FULFILLMENT_HTTP_TIMEOUT_MS
// (see services/printify.js, 20s) and a full reconciliation pass can issue
// at most a handful of them (findPrintifyOrderByExternalId's page cap is 5).
// This lease window is set comfortably above that worst case, so a record
// still inside it is presumed genuinely in-flight, and a record past it is
// presumed abandoned by a crashed process.
const SUPPLIER_CLAIM_LEASE_SQLITE_MODIFIER = '-5 minutes';

// Atomic claim: transitions into 'reconciling'. Two cases are claimable:
//   1. An explicit idle/restartable state (pending, create_failed,
//      submit_failed) — always claimable immediately.
//   2. An active-looking state (reconciling, created, submitting) whose
//      updatedAt is older than the lease window — presumed abandoned by a
//      crashed process, so it is claimable too, but ONLY once stale.
// This is a true single-winner lock even under genuine concurrency: two
// simultaneous UPDATEs with this WHERE clause are serialized by SQLite: the
// first commits and moves the row's updatedAt to "now", so the second's own
// WHERE clause (evaluated against the now-current row) no longer matches
// case 1 (state is no longer idle) or case 2 (updatedAt is no longer stale).
// Terminal states ('submitted', 'reconcile_required') are never claimable.
async function claimSupplierFulfillment(orderId, supplierId) {
  const rows = await dbAllAsync(
    `UPDATE supplier_fulfillments
        SET state = 'reconciling', attemptCount = attemptCount + 1, updatedAt = CURRENT_TIMESTAMP
      WHERE orderId = ? AND supplierId = ?
        AND (
          state IN ('pending', 'create_failed', 'submit_failed')
          OR (state IN ('reconciling', 'created', 'submitting') AND updatedAt <= datetime('now', ?))
        )
      RETURNING *`,
    [orderId, supplierId, SUPPLIER_CLAIM_LEASE_SQLITE_MODIFIER]
  );
  return rows[0] || null;
}

// True while a record's own state/updatedAt indicates another invocation is
// still legitimately within the lease window — i.e. claimSupplierFulfillment
// correctly refused to touch it because it is not (yet) stale.
function isWithinActiveLease(record) {
  if (!record) return false;
  if (!['reconciling', 'created', 'submitting'].includes(record.state)) return false;
  const updatedAtMs = Date.parse(`${record.updatedAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(updatedAtMs)) return false;
  return Date.now() - updatedAtMs < 5 * 60 * 1000;
}

async function persistSupplierState(orderId, supplierId, state, errorCode) {
  await dbRunAsync(
    `UPDATE supplier_fulfillments
        SET state = ?, lastErrorCode = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE orderId = ? AND supplierId = ?`,
    [state, errorCode || null, orderId, supplierId]
  );
}

async function persistSupplierOrderId(orderId, supplierId, supplierOrderId, state) {
  await dbRunAsync(
    `UPDATE supplier_fulfillments
        SET supplierOrderId = ?, state = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE orderId = ? AND supplierId = ?`,
    [supplierOrderId, state, orderId, supplierId]
  );
}

// Printify order-status classification. Anything not in one of the first two
// sets is treated conservatively (never auto-submitted, never blindly
// failed) — see handlePrintify()'s use of this.
const SUBMITTED_LIKE_STATUSES = new Set(['sending-to-production', 'in-production', 'fulfilled', 'partially-fulfilled']);
const SAFE_TO_SUBMIT_STATUSES = new Set(['on-hold', 'payment-not-received']);
const NOT_YET_DECIDED_STATUSES = new Set(['pending', 'cost-calculation']);

// ── Supplier handlers ─────────────────────────────────────────────────────────

/**
 * Route a group of Printify items for one local order — durable and
 * idempotent across retries/crashes. See backend/db.js's
 * `supplier_fulfillments` table and the module doc comment above.
 *
 * Never calls the removed sendOrderToProduction() combined helper — create
 * and submit are separate Printify service calls, separated by a durable
 * SQLite write, per the required design.
 */
async function handlePrintify(orderId, destination, items) {
  const supplierId = 'printify';
  const externalId = deterministicExternalId(orderId);

  await ensureSupplierFulfillmentRecord(orderId, supplierId, externalId);
  const claimed = await claimSupplierFulfillment(orderId, supplierId);

  if (!claimed) {
    const current = await getSupplierFulfillment(orderId, supplierId);
    if (current && current.state === 'submitted') {
      const ref = current.supplierOrderId || externalId;
      await writeItemStatus(items.map((i) => i.id), 'submitted', ref);
      return { supplier: supplierId, ref, count: items.length };
    }
    if (isWithinActiveLease(current)) {
      // Another invocation is genuinely still working on this right now —
      // this is not a failure, just "someone else has it." No write, no
      // error, no alert; leave item status exactly as the outer caller set
      // it (still 'processing').
      return { supplier: supplierId, ref: current.supplierOrderId || externalId, count: 0, skipped: true };
    }
    throw new Error(
      `Printify fulfillment for order #${orderId} requires manual review `
      + `(state=${current ? current.state : 'unknown'}) — no write attempted`
    );
  }

  let printifyOrderId = claimed.supplierOrderId || null;
  let orderSnapshot = null;

  // Reconcile before any create request — this is what makes a retry after
  // an ambiguous create/persist result safe (see db.js/module doc).
  if (printifyOrderId) {
    const getResult = await printify.getPrintifyOrder(printifyOrderId);
    if (!getResult.ok) {
      await persistSupplierState(orderId, supplierId, 'reconcile_required', getResult.errorCode);
      throw new Error(`Printify order ${printifyOrderId} (order #${orderId}) could not be reconciled: ${getResult.errorCode}`);
    }
    orderSnapshot = getResult.order;
  } else {
    const findResult = await printify.findPrintifyOrderByExternalId(externalId);
    if (!findResult.ok) {
      await persistSupplierState(orderId, supplierId, 'reconcile_required', findResult.errorCode);
      throw new Error(`Printify reconciliation lookup failed for order #${orderId}: ${findResult.errorCode}`);
    }
    if (findResult.matchCount > 1) {
      await persistSupplierState(orderId, supplierId, 'reconcile_required', 'AMBIGUOUS_EXTERNAL_ID_MATCH');
      throw new Error(`Multiple existing Printify orders match external_id ${externalId} (order #${orderId}) — manual review required, no write attempted`);
    }
    if (findResult.matchCount === 1) {
      printifyOrderId = String(findResult.order.id);
      orderSnapshot = findResult.order;
      await persistSupplierOrderId(orderId, supplierId, printifyOrderId, 'created');
    }
  }

  // No existing order anywhere — safe to create exactly one.
  if (!printifyOrderId) {
    const lineItems = items.map((item) => ({
      printifyProductId: item.printifyProductId,
      printifyVariantId: item.printifyVariantId,
      quantity: item.quantity,
      lineExternalId: deterministicLineExternalId(item.id),
    }));

    const createResult = await printify.createPrintifyOrderDraft({ externalId, shipping: destination, items: lineItems });
    if (!createResult.ok) {
      await persistSupplierState(orderId, supplierId, 'create_failed', createResult.errorCode);
      throw new Error(`Printify order creation failed for order #${orderId}: ${createResult.errorCode}`);
    }

    printifyOrderId = createResult.orderId;
    // Persist the real id immediately — this single write is what makes the
    // "create succeeded, process crashed before persistence" window safe:
    // a later retry finds this order by external_id instead of creating a
    // second one. It completes before send-to-production is ever attempted.
    await persistSupplierOrderId(orderId, supplierId, printifyOrderId, 'created');

    if (createResult.mocked) {
      orderSnapshot = { status: 'simulated' };
    } else {
      const freshGet = await printify.getPrintifyOrder(printifyOrderId);
      orderSnapshot = freshGet.ok ? freshGet.order : null;
    }
  }

  const status = orderSnapshot && orderSnapshot.status;

  if (SUBMITTED_LIKE_STATUSES.has(status)) {
    await persistSupplierState(orderId, supplierId, 'submitted', null);
    await writeItemStatus(items.map((i) => i.id), 'submitted', printifyOrderId);
    return { supplier: supplierId, ref: printifyOrderId, count: items.length };
  }

  if (!SAFE_TO_SUBMIT_STATUSES.has(status)) {
    if (status === 'simulated' || NOT_YET_DECIDED_STATUSES.has(status) || status == null) {
      // Order confirmed to exist, not yet safe to submit — leave it for a
      // later invocation to resolve rather than guessing.
      await persistSupplierState(orderId, supplierId, 'created', null);
      await writeItemStatus(items.map((i) => i.id), 'processing', printifyOrderId);
      return { supplier: supplierId, ref: printifyOrderId, count: items.length };
    }
    // canceled / has-issues / any other unrecognized status.
    await persistSupplierState(orderId, supplierId, 'reconcile_required', `UNSAFE_STATUS_${status}`);
    throw new Error(`Printify order ${printifyOrderId} (order #${orderId}) is in status "${status}" — requires manual review before submission, no write attempted`);
  }

  await persistSupplierState(orderId, supplierId, 'submitting', null);
  const submitResult = await printify.sendPrintifyOrderToProduction(printifyOrderId);
  if (!submitResult.ok) {
    await persistSupplierState(orderId, supplierId, 'submit_failed', submitResult.errorCode);
    throw new Error(`Printify send-to-production failed for order ${printifyOrderId} (order #${orderId}): ${submitResult.errorCode}`);
  }

  await persistSupplierState(orderId, supplierId, 'submitted', null);
  await writeItemStatus(items.map((i) => i.id), 'submitted', printifyOrderId);
  return { supplier: supplierId, ref: printifyOrderId, count: items.length };
}

/**
 * Route a group of Dropship items (external API).
 */
async function handleDropship(orderId, destination, items) {
  const { ref } = await dropship.sendOrder(orderId, destination, items);
  await writeItemStatus(items.map(i => i.id), 'submitted', ref);
  return { supplier: 'dropship', ref, count: items.length };
}

/**
 * Route items flagged as manual fulfillment — alert admin, no external call.
 */
async function handleManual(orderId, items) {
  const ref = `MANUAL-${orderId}`;
  await writeItemStatus(items.map(i => i.id), 'submitted', ref);

  // Manual-supplier products are the one product type checkout actually
  // enforces stock for (see resolveValidatedOrderItems in index.js) --
  // decrement here, at the point fulfillment is genuinely committed, so a
  // stock=1 test product correctly becomes unpurchasable after its single
  // real payment. Scoped to supplier_id='manual' in the WHERE clause so
  // this can never affect a printify/dropship product's stock, which stays
  // sync-managed elsewhere.
  for (const item of items) {
    await dbRunAsync(
      `UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND supplier_id = 'manual'`,
      [Number(item.quantity) || 1, item.productId]
    );
  }

  await telegram.sendMessage(
    `📦 <b>Manual fulfillment required</b>\n` +
    `Order #${orderId} has ${items.length} item(s) with <code>supplier_id='manual'</code>.\n` +
    `Please fulfill these items manually and update the status.`
  ).catch(() => null);
  return { supplier: 'manual', ref, count: items.length };
}

// ── Dispatcher map ─────────────────────────────────────────────────────────────

const HANDLERS = {
  printify: handlePrintify,
  dropship: handleDropship,
  manual:   handleManual,
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Route all items in a paid order to the correct supplier(s).
 *
 * @param {number}   orderId              Drip Street internal order ID
 * @param {object}   shippingDestination  Address object for the carrier
 * @param {Array}    items                order_items rows (must include supplier_id)
 *
 * Each item must have: { id, productId, supplier_id, printifyProductId,
 *                        printifyVariantId, quantity, price, ... }
 *
 * @returns {Promise<void>}   Resolves when all groups settled.
 *                            Throws if any group failed.
 */
async function routeOrderToSupplier(orderId, shippingDestination, items) {
  // 1. Group items by supplier_id (fallback to 'printify' for legacy rows)
  const groups = {};
  for (const item of items) {
    const sid = item.supplier_id || 'printify';
    if (!groups[sid]) groups[sid] = [];
    groups[sid].push(item);
  }

  const supplierIds = Object.keys(groups);
  console.log(`[fulfillment] Order #${orderId}: routing to ${supplierIds.join(', ')}`);

  // 2. Dispatch all groups concurrently (each supplier is independent)
  const results = await Promise.allSettled(
    supplierIds.map((sid) => {
      const handler = HANDLERS[sid];
      if (!handler) {
        console.error(`[fulfillment] Unknown supplier_id='${sid}' — treating as manual`);
        return handleManual(orderId, groups[sid]);
      }
      // handleManual doesn't need destination
      if (sid === 'manual') return handler(orderId, groups[sid]);
      return handler(orderId, shippingDestination, groups[sid]);
    })
  );

  // 3. Collect failures and mark failed items
  const failures = [];
  for (let i = 0; i < supplierIds.length; i++) {
    const sid    = supplierIds[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      const { supplier, ref, count } = result.value;
      console.log(`[fulfillment] ✓ ${supplier}: ${count} item(s) → ${ref}`);
      await telegram.sendMessage(
        `✅ <b>Fulfillment submitted</b>\n` +
        `Order #${orderId} · supplier=<code>${supplier}</code>\n` +
        `Items: ${count} · Ref: <code>${ref}</code>`
      ).catch(() => null);
    } else {
      const err = result.reason;
      console.error(`[fulfillment] ✗ ${sid}:`, err.message);
      // Mark these items as failed in DB
      await writeItemStatus(groups[sid].map(i => i.id), 'failed', `ERR: ${err.message.slice(0, 120)}`).catch(() => null);
      failures.push({ supplier: sid, error: err.message });
    }
  }

  // 4. Surface failures to caller
  if (failures.length > 0) {
    const summary = failures.map(f => `${f.supplier}: ${f.error}`).join(' | ');
    throw new Error(`Fulfillment partial failure for order #${orderId}: ${summary}`);
  }
}

module.exports = {
  routeOrderToSupplier,
  handlePrintify,
  deterministicExternalId,
  deterministicLineExternalId,
};
