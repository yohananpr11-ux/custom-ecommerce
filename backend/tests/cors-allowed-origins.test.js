// Focused coverage for the production CORS allowlist (backend/index.js,
// CORS_ALLOWED_ORIGINS / app.use(cors({...}))) after adding the new JOAKIM
// domain (shopjoakim.com, purchased 2026-07-26, not yet connected to
// Vercel/DNS) alongside the existing Drip Street origins.
//
// Exact-match allowlist, no wildcard -- confirms both new JOAKIM origins
// are accepted, both existing Drip Street origins remain accepted, an
// unrelated origin is rejected, and credentials/no-Origin/preflight
// behavior is unchanged by this addition.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cors-allowed-origins-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PAYPAL_CLIENT_ID = 'test-paypal-client-id-cors';
process.env.PAYPAL_CLIENT_SECRET = 'test-paypal-client-secret-cors';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

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

const ACCEPTED_ORIGINS = [
  'https://shopjoakim.com',
  'https://www.shopjoakim.com',
  'https://dripstreetshop.com',
  'https://www.dripstreetshop.com',
];

for (const origin of ACCEPTED_ORIGINS) {
  test(`CORS: ${origin} is accepted -- safe GET succeeds with a matching Access-Control-Allow-Origin header`, async () => {
    const res = await fetch(`${baseUrl}/api/checkout/config`, { headers: { Origin: origin } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
  });
}

test('CORS: an unrelated/malicious origin is rejected', async () => {
  const res = await fetch(`${baseUrl}/api/checkout/config`, {
    headers: { Origin: 'https://evil-phishing-site.example' },
  });
  // The middleware's origin() callback rejects with an Error for any origin
  // not in CORS_ALLOWED_ORIGINS, which Express's default error handler
  // turns into a 500 with no CORS header -- the browser then blocks the
  // response from ever being read by the rejected origin's JS, regardless
  // of this status code.
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('CORS: no Origin header at all still succeeds (server-to-server / curl / same-origin)', async () => {
  const res = await fetch(`${baseUrl}/api/checkout/config`);
  assert.equal(res.status, 200);
});

test('CORS: credentials are not enabled (unrelated security rule preserved, no regression)', async () => {
  const res = await fetch(`${baseUrl}/api/checkout/config`, {
    headers: { Origin: 'https://shopjoakim.com' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-credentials'), null, 'credentials support must remain off unless explicitly enabled elsewhere');
});

test('CORS: preflight (OPTIONS) for a new JOAKIM origin against a real POST route is allowed', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://www.shopjoakim.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.ok(res.status === 200 || res.status === 204, `expected a successful preflight response, got ${res.status}`);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://www.shopjoakim.com');
});

test('CORS: preflight (OPTIONS) for the rejected origin is refused', async () => {
  const res = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil-phishing-site.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
