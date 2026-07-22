// PayPlus inert-gap verification.
//
// PayPlus's backend implementation (checkout-page creation, webhook
// signature verification, idempotency, atomic paid-claim) is genuinely
// complete -- proven end-to-end elsewhere in this suite
// (paid-order-crash-recovery.test.js, paid-order-pii-audit.test.js). It is
// deliberately NOT live in production because it is missing one real
// safeguard PayPal has: cross-verifying the webhook-reported amount/
// currency against the order's own expected_payment_currency/
// expected_payment_amount snapshot (see the KNOWN GAP comment directly
// above the relevant code in backend/index.js's /api/webhooks/payplus
// handler). This file proves the OTHER half of that safety story: that
// PayPlus cannot become reachable by accident through a partial or
// malformed environment configuration -- every one of the three required
// env vars must be present, non-placeholder-shaped, AND the route/webhook
// each independently re-check this (not just the one customer-facing
// config flag), so a customer can never be routed into an unfinished
// payment flow.
//
// EXACT PREREQUISITES BEFORE PAYPLUS MAY GO LIVE (for whoever picks this up
// later): all three of PAYPLUS_API_KEY, PAYPLUS_SECRET_KEY, and
// PAYPLUS_PAGE_UID must be set to real, non-placeholder values (see
// hasConfiguredValue() -- rejects blank and anything containing YOUR_ /
// CHANGE_ME / placeholder / example / mock, case-insensitive). That alone
// is enough to make the checkout flow reachable and the webhook signature
// check active -- but activation should still be considered BLOCKED beyond
// that until the amount/currency cross-verification gap above is closed
// against PayPlus's actual, documented webhook payload shape (not a
// guessed field name -- see the KNOWN GAP comment in index.js for why this
// was deliberately not implemented from assumption).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-order-payplus-inert-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';
// PayPal intentionally left configured (with safe fake values) so
// payplusEnabled is proven false specifically because of PayPlus's OWN
// config state, not merely because nothing at all is configured.
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-payplus-inert';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-payplus-inert';

const { app } = require('../index.js');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

const PAYPLUS_ENV_KEYS = ['PAYPLUS_API_KEY', 'PAYPLUS_SECRET_KEY', 'PAYPLUS_PAGE_UID'];

function clearPayplusEnv() {
  for (const key of PAYPLUS_ENV_KEYS) delete process.env[key];
}

async function getCheckoutConfig() {
  const res = await fetch(`${baseUrl}/api/checkout/config`);
  return { status: res.status, json: await res.json() };
}

async function postCheckoutPayplus(body = {}) {
  const res = await fetch(`${baseUrl}/api/checkout/payplus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const FULL_VALID_CONFIG = {
  PAYPLUS_API_KEY: 'test-payplus-api-key-full',
  PAYPLUS_SECRET_KEY: 'test-payplus-secret-key-full',
  PAYPLUS_PAGE_UID: 'test-payplus-page-uid-full',
};

// ── /api/checkout/config: payplusEnabled must be true only with all three ──

test('payplusEnabled is true only when all three required env vars are configured with real values', async () => {
  clearPayplusEnv();
  Object.assign(process.env, FULL_VALID_CONFIG);
  try {
    const { json } = await getCheckoutConfig();
    assert.equal(json.payplusEnabled, true);
  } finally {
    clearPayplusEnv();
  }
});

const PARTIAL_CONFIGS = [
  { name: 'none set', env: {} },
  { name: 'only PAYPLUS_API_KEY', env: { PAYPLUS_API_KEY: FULL_VALID_CONFIG.PAYPLUS_API_KEY } },
  { name: 'only PAYPLUS_SECRET_KEY', env: { PAYPLUS_SECRET_KEY: FULL_VALID_CONFIG.PAYPLUS_SECRET_KEY } },
  { name: 'only PAYPLUS_PAGE_UID', env: { PAYPLUS_PAGE_UID: FULL_VALID_CONFIG.PAYPLUS_PAGE_UID } },
  { name: 'API_KEY + SECRET_KEY but not PAGE_UID', env: { PAYPLUS_API_KEY: FULL_VALID_CONFIG.PAYPLUS_API_KEY, PAYPLUS_SECRET_KEY: FULL_VALID_CONFIG.PAYPLUS_SECRET_KEY } },
  { name: 'API_KEY + PAGE_UID but not SECRET_KEY', env: { PAYPLUS_API_KEY: FULL_VALID_CONFIG.PAYPLUS_API_KEY, PAYPLUS_PAGE_UID: FULL_VALID_CONFIG.PAYPLUS_PAGE_UID } },
  { name: 'SECRET_KEY + PAGE_UID but not API_KEY', env: { PAYPLUS_SECRET_KEY: FULL_VALID_CONFIG.PAYPLUS_SECRET_KEY, PAYPLUS_PAGE_UID: FULL_VALID_CONFIG.PAYPLUS_PAGE_UID } },
  { name: 'all three set but PAGE_UID is placeholder-shaped', env: { ...FULL_VALID_CONFIG, PAYPLUS_PAGE_UID: 'YOUR_PAYPLUS_PAGE_UID' } },
  { name: 'all three set but SECRET_KEY is placeholder-shaped', env: { ...FULL_VALID_CONFIG, PAYPLUS_SECRET_KEY: 'CHANGE_ME' } },
  { name: 'all three set but API_KEY is blank', env: { ...FULL_VALID_CONFIG, PAYPLUS_API_KEY: '' } },
];

for (const { name, env } of PARTIAL_CONFIGS) {
  test(`payplusEnabled is false, and /api/checkout/payplus refuses with 503, when: ${name}`, async () => {
    clearPayplusEnv();
    Object.assign(process.env, env);
    try {
      const { json: configJson } = await getCheckoutConfig();
      assert.equal(configJson.payplusEnabled, false, `payplusEnabled must be false when: ${name}`);

      // Defense-in-depth: the actual checkout route must independently
      // refuse too, not merely rely on the frontend never rendering the
      // option because of the config flag above.
      const { status, json } = await postCheckoutPayplus({
        customerName: 'Test Customer', customerEmail: 'test@example.invalid',
        firstName: 'Test', lastName: 'Customer', phone: '+15550000000',
        addressLine1: 'Synthetic Street 1', city: 'Faketown', country: 'US',
        items: [],
      });
      assert.equal(status, 503, `/api/checkout/payplus must refuse with 503 when: ${name}`);
      assert.equal(json.success, false);
    } finally {
      clearPayplusEnv();
    }
  });
}

// ── Webhook: must independently refuse without PAYPLUS_SECRET_KEY ──────────

test('the PayPlus webhook route refuses (500, not configured) when PAYPLUS_SECRET_KEY is unset, even if a well-formed-looking signature header is sent', async () => {
  clearPayplusEnv();
  try {
    const payload = JSON.stringify({ transaction_uid: 'irrelevant', status: 'success', custom_field: '1' });
    // A signature computed with a key the server does not have configured --
    // proves the route checks for its OWN configuration before ever
    // attempting a comparison, rather than e.g. crashing on a null secret.
    const hash = crypto.createHmac('sha256', 'attacker-guessed-key').update(payload).digest('base64');
    const res = await fetch(`${baseUrl}/api/webhooks/payplus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', hash },
      body: payload,
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.match(json.error, /not configured/i);
  } finally {
    clearPayplusEnv();
  }
});

test('the PayPlus webhook route requires a valid HMAC signature even with a fully configured PAYPLUS_SECRET_KEY (real signature verification, not a stub)', async () => {
  clearPayplusEnv();
  Object.assign(process.env, FULL_VALID_CONFIG);
  try {
    const payload = JSON.stringify({ transaction_uid: 'irrelevant', status: 'success', custom_field: '1' });
    const wrongHash = crypto.createHmac('sha256', 'not-the-real-secret').update(payload).digest('base64');
    const res = await fetch(`${baseUrl}/api/webhooks/payplus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', hash: wrongHash },
      body: payload,
    });
    assert.equal(res.status, 401);
  } finally {
    clearPayplusEnv();
  }
});
