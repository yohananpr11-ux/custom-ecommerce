/**
 * paid-order-crash-harness.cjs
 * ──────────────────────────────────────────────────────────────────────────
 * Test-only harness used by backend/tests/paid-order-crash-recovery.test.js
 * to prove, in a genuinely fresh Node process against a persisted temporary
 * SQLite file, that a PayPal capture still reaches 'paid' + fulfillment even
 * when the local DB already carries a `processed_webhooks` row for this
 * exact capture id -- the state a process would be left in if it had
 * crashed immediately after the (now-removed) old reserve-then-update
 * ordering in /api/paypal/capture-order, but before the paid-status UPDATE
 * ever ran. Before the fix, this exact stored state would have caused every
 * future capture attempt to be silently treated as "duplicate": true
 * without ever marking the order paid. This harness proves the fix directly
 * at the real HTTP entry point, in a process that never held any
 * in-memory state from before that DB row was written.
 *
 * The parent test seeds the order/order_items/processed_webhooks rows and
 * closes its own DB handle before spawning this harness, per the same
 * pattern already established in scripts/recovery-restart-harness.cjs.
 *
 * No live network call is possible: axios.post is replaced with a fixed,
 * local mock covering exactly the two PayPal endpoints this flow calls
 * (oauth2/token, capture), and PRINTIFY_API_TOKEN is deliberately left
 * unset so services/printify.js's own real missing-token guard (not a test
 * double) makes every fulfillment call a no-network structurally mocked
 * result, identical to the pattern in recovery-restart-harness.cjs.
 */

'use strict';

(async () => {
  const axios = require('axios');

  const fakePaypalOrderId = process.env.CRASH_HARNESS_FAKE_PAYPAL_ORDER_ID;
  const localOrderId = String(Number(process.env.CRASH_HARNESS_LOCAL_ORDER_ID));
  const expectedCurrency = process.env.CRASH_HARNESS_EXPECTED_CURRENCY;
  const expectedAmount = process.env.CRASH_HARNESS_EXPECTED_AMOUNT;
  const captureId = `CAPTURE-${fakePaypalOrderId}`;

  axios.post = async (url) => {
    if (url.includes('/v1/oauth2/token')) {
      return { data: { access_token: 'fake-token-crash-harness' } };
    }
    if (url.endsWith('/capture')) {
      return {
        data: {
          status: 'COMPLETED',
          purchase_units: [{
            reference_id: localOrderId,
            custom_id: localOrderId,
            payments: { captures: [{ id: captureId, amount: { currency_code: expectedCurrency, value: expectedAmount } }] },
          }],
        },
      };
    }
    throw new Error(`UNEXPECTED axios.post to ${url} in paid-order-crash-harness`);
  };

  const { app } = require('../index.js');
  const db = require('../db.js');

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });

  const server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderID: fakePaypalOrderId }),
  });
  const body = await res.json();

  // Let the fire-and-forget fulfillment call settle before reading state.
  await new Promise((resolve) => setTimeout(resolve, 600));

  const orderRow = await dbGet(`SELECT status FROM orders WHERE id = ?`, [localOrderId]);
  const itemRow = await dbGet(`SELECT fulfillment_status FROM order_items WHERE orderId = ?`, [localOrderId]);
  const webhookRows = await new Promise((resolve, reject) => {
    db.all(`SELECT provider, eventId FROM processed_webhooks WHERE provider = 'paypal' AND eventId = ?`, [captureId], (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });

  console.log('CRASH_HARNESS_RESULT=' + JSON.stringify({
    httpStatus: res.status,
    body,
    orderStatusAfter: orderRow ? orderRow.status : null,
    itemFulfillmentStatusAfter: itemRow ? itemRow.fulfillment_status : null,
    processedWebhookRowCount: webhookRows.length,
  }));

  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
})().catch((err) => {
  console.log('CRASH_HARNESS_ERROR=' + JSON.stringify({ message: err.message, stack: err.stack }));
  process.exit(1);
});
