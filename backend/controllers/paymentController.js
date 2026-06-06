/**
 * Meshulam (Grow) payment controller.
 *
 * Two responsibilities:
 *
 *   1. POST /api/payment/create
 *      - Validates input.
 *      - Persists a pending order (status='pending_payment') + order_items.
 *      - Calls Meshulam's hosted-page endpoint with the internal order id in
 *        cField1 so the webhook can reconcile back.
 *      - Returns { ok, redirectUrl, orderId }.
 *
 *   2. POST /api/payment/webhook
 *      - Acknowledges fast with 200 OK so Meshulam stops retrying.
 *      - Dedupes via processed_webhooks(provider, eventId).
 *      - Looks up the pending order, validates Meshulam status.
 *      - Updates order to 'paid' and fires processPaidOrderFulfillment(orderId, 'Meshulam')
 *        which routes items to CJ Dropshipping (or other suppliers) and emails
 *        the confirmation.
 *
 * Sandbox endpoint:   https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess
 * Production endpoint: https://meshulam.co.il/api/light/server/1.0/createPaymentProcess
 *
 * Env (see backend/.env.example):
 *   MESHULAM_PAGE_CODE
 *   MESHULAM_USER_ID
 *   MESHULAM_API_KEY
 *   MESHULAM_ENV         - "sandbox" (default) or "production"
 */

const axios = require('axios');
const db = require('../db');
const telegram = require('../services/telegram');

const SANDBOX_URL = 'https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess';
const PRODUCTION_URL = 'https://meshulam.co.il/api/light/server/1.0/createPaymentProcess';

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function cb(err) { return err ? reject(err) : resolve(this); });
});

function getMeshulamEndpoint() {
  const env = String(process.env.MESHULAM_ENV || 'sandbox').toLowerCase();
  return env === 'production' ? PRODUCTION_URL : SANDBOX_URL;
}

function sanitizeAmount(rawAmount) {
  const numeric = Number(rawAmount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100) / 100;
}

function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((it) => it && (it.productId || it.id))
    .slice(0, 50)
    .map((it) => ({
      productId: Number(it.productId || it.id) || null,
      variantId: it.variantId != null ? Number(it.variantId) : null,
      quantity: Math.max(1, Number(it.quantity) || 1),
      price: Number(it.price) || 0,
      selectedColor: it.selectedColor || null,
      selectedSize: it.selectedSize || null,
    }))
    .filter((it) => it.productId);
}

/**
 * Fetch supplier_id for each productId so order_items get routed to the right
 * fulfillment service (CJ for jewelry, Printify for tees). Without this the
 * multi-vendor router falls back to 'printify' and CJ items never get shipped.
 */
function fetchSupplierMap(productIds) {
  return new Promise((resolve) => {
    if (!productIds.length) return resolve({});
    const placeholders = productIds.map(() => '?').join(',');
    db.all(
      `SELECT id, supplier_id, printifyId FROM products WHERE id IN (${placeholders})`,
      productIds,
      (err, rows) => {
        if (err) {
          console.warn('[meshulam] supplier lookup failed; defaulting to printify:', err.message);
          return resolve({});
        }
        const map = {};
        for (const row of rows || []) {
          map[row.id] = {
            supplier_id: row.supplier_id || 'printify',
            printifyId: row.printifyId || null,
          };
        }
        resolve(map);
      }
    );
  });
}

function persistPendingOrder({ amount, customer, shipping, items, currency, locale, supplierMap }) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(
        `INSERT INTO orders (
           customerName, customerEmail, address,
           firstName, lastName, phone,
           addressLine1, addressLine2, city, region, postalCode, country,
           totalAmount, shippingCost, status, locale, currency
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer.fullName || '',
          customer.email || '',
          [shipping.addressLine1, shipping.city, shipping.postalCode, shipping.country].filter(Boolean).join(', '),
          shipping.firstName || '',
          shipping.lastName || '',
          customer.phone || '',
          shipping.addressLine1 || '',
          shipping.addressLine2 || '',
          shipping.city || '',
          shipping.region || '',
          shipping.postalCode || '',
          (shipping.country || 'IL').toUpperCase(),
          amount,
          0,
          'pending_payment',
          locale || 'he',
          currency || 'ILS',
        ],
        function insertCb(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          const orderId = this.lastID;
          if (!items.length) {
            db.run('COMMIT');
            return resolve(orderId);
          }

          let pending = items.length;
          let failed = false;
          for (const it of items) {
            const supplierInfo = supplierMap[it.productId] || { supplier_id: 'printify' };
            db.run(
              `INSERT INTO order_items (
                 orderId, productId, variantId, quantity, price,
                 selectedColor, selectedSize, supplier_id, fulfillment_status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
              [
                orderId,
                it.productId,
                it.variantId,
                it.quantity,
                it.price,
                it.selectedColor,
                it.selectedSize,
                supplierInfo.supplier_id,
              ],
              (itemErr) => {
                if (failed) return;
                if (itemErr) {
                  failed = true;
                  db.run('ROLLBACK');
                  return reject(itemErr);
                }
                if (--pending === 0) {
                  db.run('COMMIT');
                  resolve(orderId);
                }
              }
            );
          }
        }
      );
    });
  });
}

module.exports = function paymentControllerFactory(processPaidOrderFulfillment) {
  /**
   * POST /api/payment/create
   * Body: { amount, customer:{fullName,email,phone}, shipping:{...}, items:[...], currency?, locale?, paymentMethod? }
   */
  async function createMeshulamPayment(req, res) {
    const {
      amount,
      customer = {},
      shipping = {},
      items: rawItems = [],
      currency = 'ILS',
      locale = 'he',
      paymentMethod = 'meshulam_card',
    } = req.body || {};

    const cleanAmount = sanitizeAmount(amount);
    if (!cleanAmount) {
      return res.status(400).json({ ok: false, error: 'validation_failed', details: 'amount must be a positive number' });
    }
    const fullName = String(customer.fullName || '').trim().slice(0, 80);
    const email = String(customer.email || '').trim().slice(0, 120);
    const phone = String(customer.phone || '').trim().slice(0, 40);
    if (!fullName || !email || !phone) {
      return res.status(400).json({ ok: false, error: 'validation_failed', details: 'customer.fullName, email, and phone are required' });
    }
    const cleanItems = sanitizeItems(rawItems);
    // Items are optional at this layer — checkout may legitimately pass an empty
    // cart for jewelry-only flows that bundle on the server side — but we warn.
    if (!cleanItems.length) {
      console.warn('[meshulam] /create called with no items');
    }

    const pageCode = process.env.MESHULAM_PAGE_CODE;
    const userId = process.env.MESHULAM_USER_ID;
    const apiKey = process.env.MESHULAM_API_KEY;
    if (!pageCode || !userId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: 'meshulam_not_configured',
        details: 'MESHULAM_PAGE_CODE, MESHULAM_USER_ID, and MESHULAM_API_KEY must all be set.',
      });
    }

    // Resolve supplier_id per product so the fulfillment router dispatches
    // CJ jewelry to dropship and Printify tees to Printify on webhook success.
    const supplierMap = await fetchSupplierMap(cleanItems.map((it) => it.productId));

    let internalOrderId;
    try {
      internalOrderId = await persistPendingOrder({
        amount: cleanAmount,
        customer: { fullName, email, phone },
        shipping: {
          firstName: shipping.firstName || '',
          lastName: shipping.lastName || '',
          addressLine1: shipping.addressLine1 || '',
          addressLine2: shipping.addressLine2 || '',
          city: shipping.city || '',
          region: shipping.region || '',
          postalCode: shipping.postalCode || '',
          country: shipping.country || 'IL',
        },
        items: cleanItems,
        currency,
        locale,
        supplierMap,
      });
    } catch (err) {
      console.error('[meshulam] failed to persist pending order:', err.message);
      return res.status(500).json({ ok: false, error: 'order_persist_failed', details: err.message });
    }

    // Meshulam Light API uses form-encoded payload.
    const params = new URLSearchParams();
    params.set('pageCode', pageCode);
    params.set('userId', userId);
    params.set('apiKey', apiKey);
    params.set('sum', String(cleanAmount));
    params.set('description', `Drip Street order #${internalOrderId}`);
    if (fullName) params.set('pageField[fullName]', fullName);
    if (email) params.set('pageField[email]', email);
    if (phone) params.set('pageField[phone]', phone);
    // cField1 carries our internal order id back through the webhook for reconciliation.
    params.set('cField1', String(internalOrderId));
    params.set('cField2', String(paymentMethod || 'meshulam_card'));

    try {
      const response = await axios.post(getMeshulamEndpoint(), params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });

      const payload = response.data || {};
      if (Number(payload.status) !== 1) {
        await dbRun(`UPDATE orders SET status = 'meshulam_rejected' WHERE id = ?`, [internalOrderId]).catch(() => null);
        const errMsg = payload.err || payload.message || 'Meshulam refused the payment request.';
        await telegram.notifyCheckoutFailed({
          provider: 'Meshulam',
          customerName: fullName,
          customerEmail: email,
          amount: cleanAmount,
          orderId: internalOrderId,
          error: errMsg
        }).catch(() => null);
        return res.status(502).json({
          ok: false,
          error: 'meshulam_rejected',
          details: errMsg,
          raw: payload,
        });
      }

      const data = payload.data || {};
      return res.json({
        ok: true,
        orderId: internalOrderId,
        redirectUrl: data.url || null,
        transactionId: data.processId || data.transactionId || null,
        raw: payload,
      });
    } catch (err) {
      const details = err.response ? err.response.data : err.message;
      console.error('[meshulam] createPaymentProcess failed:', details);
      await dbRun(`UPDATE orders SET status = 'meshulam_failed' WHERE id = ?`, [internalOrderId]).catch(() => null);
      const errString = typeof details === 'string' ? details : JSON.stringify(details);
      await telegram.notifyCheckoutFailed({
        provider: 'Meshulam',
        customerName: fullName,
        customerEmail: email,
        amount: cleanAmount,
        orderId: internalOrderId,
        error: errString
      }).catch(() => null);
      return res.status(502).json({ ok: false, error: 'meshulam_failed', details });
    }
  }

  /**
   * POST /api/payment/webhook
   *
   * Meshulam posts back form-encoded fields after the customer pays.
   * Common fields observed in their docs:
   *   status (1 = success), err, transactionId, processId,
   *   cField1 (our orderId), cField2 (our paymentMethod), sum, paymentDate
   *
   * We acknowledge 200 first, then run fulfillment async so Meshulam doesn't retry.
   */
  async function meshulamWebhook(req, res) {
    // Acknowledge immediately — Meshulam treats slow responses as failures and retries.
    res.status(200).json({ ok: true });

    try {
      const body = req.body || {};
      const status = Number(body.status);
      const orderId = Number(body.cField1);
      const transactionId = String(body.transactionId || body.processId || body.asmachta || '').slice(0, 80);
      const eventId = transactionId || `${orderId}-${Date.now()}`;

      if (!orderId || !Number.isInteger(orderId)) {
        console.warn('[meshulam-webhook] missing or invalid orderId (cField1):', body);
        return;
      }

      // Idempotency: bail if we already processed this webhook event.
      try {
        await dbRun(
          `INSERT INTO processed_webhooks (provider, eventId) VALUES (?, ?)`,
          ['meshulam', eventId]
        );
      } catch (err) {
        if (/UNIQUE/i.test(err.message)) {
          console.log(`[meshulam-webhook] duplicate event ${eventId} — skipping.`);
          return;
        }
        console.warn('[meshulam-webhook] dedup insert failed:', err.message);
      }

      const order = await dbGet(`SELECT id, status FROM orders WHERE id = ?`, [orderId]);
      if (!order) {
        console.warn(`[meshulam-webhook] order #${orderId} not found.`);
        return;
      }

      if (status !== 1) {
        await dbRun(
          `UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending_payment'`,
          [orderId]
        );
        console.warn(`[meshulam-webhook] order #${orderId} marked failed (status=${status}, err=${body.err || ''})`);
        return;
      }

      // Successful payment. Move to paid and trigger CJ fulfillment.
      await dbRun(
        `UPDATE orders SET status = 'paid' WHERE id = ? AND status IN ('pending_payment','pending')`,
        [orderId]
      );

      console.log(`[meshulam-webhook] order #${orderId} paid (txn=${transactionId}). Triggering fulfillment...`);
      if (typeof processPaidOrderFulfillment === 'function') {
        processPaidOrderFulfillment(orderId, 'Meshulam').catch((err) =>
          console.error(`[meshulam-webhook] fulfillment for order #${orderId} threw:`, err.message)
        );
      } else {
        console.error('[meshulam-webhook] processPaidOrderFulfillment is not wired — cannot dispatch to CJ.');
      }
    } catch (err) {
      // Log only — we already ACKed Meshulam.
      console.error('[meshulam-webhook] handler failure:', err.message);
    }
  }

  return { createMeshulamPayment, meshulamWebhook };
};
