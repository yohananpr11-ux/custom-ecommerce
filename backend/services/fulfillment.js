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

// ── Per-item status writer ────────────────────────────────────────────────────

/**
 * Atomically update fulfillment_status and fulfillment_ref for a batch of items.
 * @param {number[]} itemIds
 * @param {'submitted'|'failed'} status
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

// ── Supplier handlers ─────────────────────────────────────────────────────────

/**
 * Route a group of Printify items.
 */
async function handlePrintify(orderId, destination, items) {
  // printify.sendOrderToProduction already accepts (orderId, destination, items)
  // and writes its own internal state. We just need the ref for our tracking.
  await printify.sendOrderToProduction(orderId, destination, items);
  // Printify doesn't return an external ref — use our orderId as the ref key
  const ref = `PRINTIFY-ORD-${orderId}`;
  await writeItemStatus(items.map(i => i.id), 'submitted', ref);
  return { supplier: 'printify', ref, count: items.length };
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

module.exports = { routeOrderToSupplier };
