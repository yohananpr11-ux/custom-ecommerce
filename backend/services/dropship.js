/**
 * dropship.js
 * ──────────────────────────────────────────────────────────────────────────
 * External Dropship API integration layer for Drip Street — Phase 3.
 *
 * Architecture:
 *   This module is the adapter between the fulfillment router and the
 *   external dropship supplier API (AliExpress / Glowroad / custom).
 *   It mirrors the interface of printify.js so the router treats all
 *   suppliers uniformly.
 *
 * Current status: STUB — logs intent, returns a placeholder ref.
 * Phase 3.2 will replace sendOrder() with live API calls once the
 *   supplier credentials and API docs are confirmed.
 *
 * Interface contract (must match for all supplier adapters):
 *   sendOrder(orderId, shippingDestination, items) → Promise<{ ref: string }>
 *     - ref: the supplier's order ID / tracking reference
 *     - throws on unrecoverable error (fulfillment router will catch + alert)
 */

'use strict';

const SUPPLIER_NAME = 'dropship';

/**
 * Send a group of order items to the external dropship supplier.
 *
 * @param {number}   orderId              Internal Drip Street order ID
 * @param {object}   shippingDestination  { firstName, lastName, address1, city, zip, country, phone }
 * @param {Array}    items                order_items rows (supplier_id='dropship')
 * @returns {Promise<{ref: string}>}      Supplier order reference
 */
async function sendOrder(orderId, shippingDestination, items) {
  // ── STUB: replace this block with live API call in Phase 3.2 ─────────────
  console.warn(`[${SUPPLIER_NAME}] STUB — sendOrder called for Drip Street order #${orderId}`);
  console.warn(`[${SUPPLIER_NAME}]   destination: ${shippingDestination.city}, ${shippingDestination.country}`);
  console.warn(`[${SUPPLIER_NAME}]   items: ${items.map(i => `productId=${i.productId} qty=${i.quantity}`).join(', ')}`);
  console.warn(`[${SUPPLIER_NAME}] ⚠  No real API call made. Manual fulfillment required until Phase 3.2.`);
  // ─────────────────────────────────────────────────────────────────────────

  // Return a deterministic stub ref so fulfillment_ref is always populated
  const ref = `DROPSHIP-STUB-${orderId}-${Date.now()}`;
  return { ref };
}

/**
 * (Future) Check shipment status for an item.
 * Phase 3.2 will implement live tracking polling.
 *
 * @param {string} ref  The supplier order reference (from sendOrder)
 * @returns {Promise<{status: string, trackingNumber: string|null}>}
 */
async function getShipmentStatus(ref) {
  console.warn(`[${SUPPLIER_NAME}] STUB — getShipmentStatus called for ref=${ref}`);
  return { status: 'unknown', trackingNumber: null };
}

module.exports = { sendOrder, getShipmentStatus };
