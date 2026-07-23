/**
 * manual-product-reservation-crash-harness.cjs
 * ──────────────────────────────────────────────────────────────────────────
 * Test-only harness used by backend/tests/manual-product-checkout-security.test.js
 * to prove, in a genuinely fresh Node process against a persisted temporary
 * SQLite file, that a stock reservation left behind by a crashed
 * create-order attempt (order row + order_item exist, no paypal_order_id
 * was ever persisted -- the PayPal create-order call itself never
 * returned) is recoverable by a real HTTP create-order request handled by
 * a process that never held any in-memory state from before that crash.
 *
 * The parent test seeds the crashed state directly (products/
 * product_variants/orders/order_items rows, plus a stock reservation lease
 * already past its window) and closes its own DB handle before spawning
 * this harness, per the same pattern established in
 * scripts/paid-order-crash-harness.cjs.
 *
 * No live network call is possible: axios.post is replaced with a fixed,
 * local mock covering exactly the two PayPal endpoints this flow calls
 * (oauth2/token, create-order), and PRINTIFY_API_TOKEN is deliberately left
 * unset so services/printify.js's own real missing-token guard makes any
 * fulfillment call structurally network-free too.
 */

'use strict';

(async () => {
  const axios = require('axios');

  const productId = Number(process.env.CRASH_HARNESS_PRODUCT_ID);
  const rawToken = process.env.CRASH_HARNESS_RAW_TOKEN;

  axios.post = async (url, data) => {
    if (url.includes('/v1/oauth2/token')) {
      return { data: { access_token: 'fake-token-reservation-crash-harness' } };
    }
    if (url.includes('/v2/checkout/orders') && !url.endsWith('/capture')) {
      const unit = data.purchase_units[0];
      return { data: { id: `PPO-HARNESS-${unit.custom_id}`, status: 'CREATED' } };
    }
    throw new Error(`UNEXPECTED axios.post to ${url} in manual-product-reservation-crash-harness`);
  };

  const { app } = require('../index.js');
  const db = require('../db.js');

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });

  const server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Harness Customer', customerEmail: 'harness@example.invalid',
      firstName: 'Harness', lastName: 'Customer', phone: '+15550000000',
      addressLine1: 'Harness Street 1', city: 'Faketown', postalCode: '00000', country: 'US', region: 'CA',
      items: [{ id: productId, quantity: 1, selectedColor: 'Default', selectedSize: 'OS', accessToken: rawToken }],
      currency: 'ILS',
    }),
  });
  const body = await res.json();

  const productRow = await dbGet(`SELECT stock, stock_reservation_qty, stock_reservation_expires_at FROM products WHERE id = ?`, [productId]);
  const newOrderCount = await dbGet(`SELECT COUNT(*) AS n FROM orders`);

  console.log('RESERVATION_CRASH_HARNESS_RESULT=' + JSON.stringify({
    httpStatus: res.status,
    body,
    productStockAfter: productRow ? productRow.stock : null,
    productReservationQtyAfter: productRow ? productRow.stock_reservation_qty : null,
    totalOrderCount: newOrderCount.n,
  }));

  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
})().catch((err) => {
  console.log('RESERVATION_CRASH_HARNESS_ERROR=' + JSON.stringify({ message: err.message, stack: err.stack }));
  process.exit(1);
});
