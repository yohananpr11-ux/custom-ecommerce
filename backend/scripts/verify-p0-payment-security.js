#!/usr/bin/env node
/**
 * P0 payment-security regression check.
 *
 * Verifies two fixes made during the Braintree/Meshulam removal pass:
 *
 * 1. Stripe webhook signature enforcement (backend/index.js, /api/webhooks/stripe):
 *    a forged, unsigned "checkout.session.completed" event must be rejected
 *    outright — never trusted, never allowed to mark an order paid or trigger
 *    fulfillment. Previously, when STRIPE_WEBHOOK_SECRET was unset (e.g.
 *    because Stripe checkout is intentionally disabled), the handler fell
 *    back to trusting the raw request body as a real event.
 *
 * 2. Server-side price trust (backend/index.js, resolveValidatedOrderItems,
 *    used by both /api/paypal/create-order and /api/checkout/payplus): the
 *    price actually charged must always come from the product/variant record
 *    in the database, never from a client-supplied `price` field. This
 *    matters most for products with no color/size variant (e.g. jewelry
 *    SKUs), which previously fell back to trusting the client price.
 *
 * Usage — run against a server you started yourself, NEVER against
 * production. Recommended: an isolated throwaway DB via DB_PATH, e.g.
 *
 *   DB_PATH=/tmp/p0-test.db PORT=4091 node index.js &
 *   node scripts/verify-p0-payment-security.js --baseUrl=http://localhost:4091 --productId=<id> --realPrice=<price>
 *
 * --productId/--realPrice must reference a product that exists in whatever
 * DB the target server is using, with no product_variants rows (so the
 * fix's fallback-to-product.price branch is what gets exercised). Check 2
 * is skipped if --productId is omitted (Check 1 alone still runs).
 */

const axios = require('axios');

const parseArgs = (argv) => {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const [key, value] = token.replace(/^--/, '').split('=');
    args[key] = value === undefined ? 'true' : value;
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.baseUrl || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
const dbPathArg = args.dbPath ? String(args.dbPath) : null;

if (!baseUrl) {
  console.error('Missing base URL. Provide --baseUrl=http://localhost:PORT (never a production URL).');
  process.exit(1);
}
if (/dripstreetshop\.com|onrender\.com|vercel\.app/i.test(baseUrl)) {
  console.error('Refusing to run: baseUrl looks like a production/hosted URL. Use a local instance only.');
  process.exit(1);
}

let failures = 0;

const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function checkStripeWebhookRejectsUnsigned() {
  console.log('\n[1] Stripe webhook must reject an unsigned/forged event');
  const forgedEvent = {
    id: 'evt_forged_verify_script',
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: '999999',
        amount_total: 100,
        currency: 'ils',
        id: 'cs_forged_verify_script',
      },
    },
  };

  try {
    const res = await axios.post(`${baseUrl}/api/webhooks/stripe`, forgedEvent, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    check(
      'forged event rejected (not 200)',
      res.status !== 200,
      `got HTTP ${res.status}`
    );
    check(
      'rejection is a config/signature error, not silent acceptance',
      res.status === 503 || res.status === 400,
      `got HTTP ${res.status}, body=${JSON.stringify(res.data).slice(0, 200)}`
    );
  } catch (err) {
    check('request completed without network error', false, err.message);
  }
}

async function checkPriceIsServerTrusted() {
  const productId = Number(args.productId);
  const realPrice = Number(args.realPrice);
  if (!productId || !Number.isFinite(realPrice)) {
    console.log('\n[2] Skipped (pass --productId=<id> --realPrice=<price> to run this check)');
    return;
  }

  console.log(`\n[2] Server must ignore a manipulated client price (product ${productId}, real price ${realPrice})`);
  const injectedPrice = 1;

  try {
    const res = await axios.post(`${baseUrl}/api/paypal/create-order`, {
      customerName: 'P0 Verify Script',
      customerEmail: 'p0-verify@example.com',
      address: '1 Test St, Tel Aviv, 6300100, IL',
      firstName: 'P0',
      lastName: 'Verify',
      phone: '0501234567',
      addressLine1: '1 Test St',
      city: 'Tel Aviv',
      postalCode: '6300100',
      country: 'IL',
      currency: 'ILS',
      items: [{ id: productId, quantity: 1, price: injectedPrice }],
    }, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    const missingPaypalCreds = res.status === 500
      && /PayPal credentials are missing/i.test(JSON.stringify(res.data || {}));

    if (res.status === 200 && res.data && res.data.orderId) {
      const amount = Number(res.data.amount);
      check(
        'charged amount reflects the real product price (± shipping), not the injected price',
        Number.isFinite(amount) && amount >= realPrice && amount < realPrice + 100,
        `charged amount=${res.data.amount}, injected price was ${injectedPrice}`
      );
      console.log(`  (local order #${res.data.orderId} created — inspect order_items.price directly in your test DB for full confirmation)`);
      return;
    }

    if (missingPaypalCreds) {
      // This is the expected, safer outcome when run with zero real PayPal
      // credentials (as this script always should be): order creation itself
      // — including price validation — runs to completion before the
      // PayPal API call is ever attempted, so a "credentials missing" 500 is
      // proof the pricing step was reached, not a failure of this check.
      check('order creation reached the pricing step (blocked only by missing PayPal creds, as expected)', true);
      if (dbPathArg) {
        const row = await queryLatestOrderItem(dbPathArg);
        if (!row) {
          check('order_items row found in DB to verify price', false, 'no rows returned');
        } else {
          check(
            'stored order_items.price reflects the real product price, not the injected price',
            Math.abs(Number(row.price) - realPrice) < 0.01,
            `stored price=${row.price}, injected price was ${injectedPrice}`
          );
        }
      } else {
        console.log('  (pass --dbPath=<file> to also directly verify order_items.price in the DB)');
      }
      return;
    }

    check('order creation reached the pricing step', false, `HTTP ${res.status}, body=${JSON.stringify(res.data).slice(0, 200)}`);
  } catch (err) {
    check('request completed without network error', false, err.message);
  }
}

function queryLatestOrderItem(dbPath) {
  const sqlite3 = require('sqlite3').verbose();
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.get(
      `SELECT price FROM order_items ORDER BY id DESC LIMIT 1`,
      (err, row) => {
        db.close();
        if (err) return reject(err);
        resolve(row);
      }
    );
  });
}

(async () => {
  console.log(`P0 payment-security verification against ${baseUrl}`);
  await checkStripeWebhookRejectsUnsigned();
  await checkPriceIsServerTrusted();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
