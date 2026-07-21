/**
 * fulfillment-recovery.js
 * ──────────────────────────────────────────────────────────────────────────
 * Automatic recovery for stale paid Printify fulfillments.
 *
 * Why this exists: neither a duplicate/replayed payment webhook nor an
 * application restart previously re-invoked processPaidOrderFulfillment()
 * for an order stuck mid-flight. Every payment route (PayPal/Stripe/
 * PayPlus) returns early with `duplicate: true` once `orders.status` is
 * already 'paid', and nothing at startup or on a schedule ever scanned for
 * unfinished work — confirmed by direct code audit, not assumed. This
 * module is the missing trigger.
 *
 * It does not implement any new safety logic itself. It only finds orders
 * whose durable state (order_items.fulfillment_status +
 * supplier_fulfillments, per backend/db.js) proves recovery is safe, and
 * calls the exact same production entry point
 * (processPaidOrderFulfillment) that a real payment event calls — which in
 * turn goes through the exact same outer item-level claim and
 * supplier-level lease/reconciliation logic already proven in
 * backend/index.js and backend/services/fulfillment.js. This module makes
 * zero direct writes to order_items or supplier_fulfillments, and it never
 * calls the Printify service directly.
 */

'use strict';

const db = require('../db');

const dbAllAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

const DEFAULT_BATCH_LIMIT = 25;

// Mirrors the exact eligibility condition backend/index.js's outer
// order_items claim query uses, but as a read-only order-level scan: finds
// orders that have at least one printify item the real claim query would
// actually match, so this never invokes fulfillment for an order that has
// nothing left to do.
const ELIGIBLE_ORDERS_SQL = `
  SELECT DISTINCT o.id AS orderId
  FROM orders o
  JOIN order_items oi ON oi.orderId = o.id
  WHERE o.status = 'paid'
    AND COALESCE(oi.supplier_id, 'printify') = 'printify'
    AND (
      oi.fulfillment_status IS NULL
      OR oi.fulfillment_status = 'pending'
      OR (
        oi.fulfillment_status IN ('processing', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM supplier_fulfillments sf
          WHERE sf.orderId = o.id
            AND sf.supplierId = 'printify'
            AND (
              sf.state IN ('submitted', 'reconcile_required')
              OR (sf.state IN ('reconciling', 'created', 'submitting') AND sf.updatedAt > datetime('now', '-5 minutes'))
            )
        )
      )
    )
  ORDER BY o.id ASC
  LIMIT ?
`;

let scanInFlight = false;

/**
 * One-shot recovery pass. Safe to call repeatedly (e.g. on a schedule) --
 * an in-process single-flight guard skips a call that overlaps a scan
 * already running in this same process; the SQLite-level claim/lease
 * mechanism (unchanged, reused as-is) is what provides cross-process /
 * cross-invocation safety.
 *
 * @param {object} deps
 * @param {(orderId: number, providerTag: string) => Promise<void>} deps.processPaidOrderFulfillment
 *   The real production entry point -- injected rather than required
 *   directly, to avoid a circular require with backend/index.js and to
 *   keep this module trivially testable with a mock.
 * @param {number} [deps.batchLimit]
 * @param {string} [deps.source] 'startup' | 'scheduled' | any caller-supplied
 *   tag -- carried into the OPS_FULFILLMENT_RECOVERY summary line only, no
 *   behavioral effect.
 * @returns {Promise<{scanned: number, recovered: number, skipped: number, failed: number}>}
 */
async function recoverStalePaidFulfillments({ processPaidOrderFulfillment, batchLimit = DEFAULT_BATCH_LIMIT, source = 'unknown' }) {
  if (typeof processPaidOrderFulfillment !== 'function') {
    throw new Error('recoverStalePaidFulfillments requires a processPaidOrderFulfillment function');
  }

  const startedAt = Date.now();

  if (scanInFlight) {
    console.log('[fulfillment-recovery] scan already in progress in this process, skipping overlap');
    console.log(`OPS_FULFILLMENT_RECOVERY source=${source} result=skipped_overlap candidates=0 recovered=0 failed=0 skipped=1 duration_ms=${Date.now() - startedAt}`);
    return { scanned: 0, recovered: 0, skipped: 0, failed: 0, overlapped: true };
  }
  scanInFlight = true;

  try {
    const eligible = await dbAllAsync(ELIGIBLE_ORDERS_SQL, [batchLimit]);
    console.log(`[fulfillment-recovery] scan found ${eligible.length} eligible order(s) (batch limit ${batchLimit})`);

    let recovered = 0;
    let failed = 0;

    for (const row of eligible) {
      // One failed order must not stop the rest of the batch.
      try {
        await processPaidOrderFulfillment(row.orderId, 'Recovery');
        recovered += 1;
        console.log(`[fulfillment-recovery] order #${row.orderId}: recovery pass completed`);
      } catch (err) {
        failed += 1;
        // Only a coarse, safe message -- never recipient data, which never
        // appears in anything processPaidOrderFulfillment throws (see
        // services/printify.js#_safeErrorCode and services/fulfillment.js).
        // NOTE: err.message here is NOT necessarily safe for the structured
        // OPS event below -- some thrown messages embed the real supplier
        // order id (see services/fulfillment.js) -- so it is deliberately
        // never included in the OPS_FULFILLMENT_RECOVERY line, only in this
        // pre-existing free-text debug log.
        console.error(`[fulfillment-recovery] order #${row.orderId}: recovery attempt failed:`, err.message);
      }
    }

    const result = failed === 0 ? 'success' : (recovered === 0 ? 'failed' : 'partial');
    console.log(`OPS_FULFILLMENT_RECOVERY source=${source} result=${result} candidates=${eligible.length} recovered=${recovered} failed=${failed} skipped=0 duration_ms=${Date.now() - startedAt}`);

    return { scanned: eligible.length, recovered, skipped: 0, failed };
  } finally {
    scanInFlight = false;
  }
}

module.exports = { recoverStalePaidFulfillments, ELIGIBLE_ORDERS_SQL, DEFAULT_BATCH_LIMIT };
