// Regression coverage for GET /api/products/:id's fail-closed access-token
// gate on supplier_id='manual' rows (backend/index.js).
//
// Found in production: the gate used to only activate `if (row.supplier_id
// === 'manual' && row.access_token_hash)` -- a manual-supplier row with no
// access_token_hash configured (created by quarantining a stale product
// directly, not through scripts/manual-payment-test-product.js) fell
// through the whole check and was served at 200 with full product data.
// The fix removes the `&& row.access_token_hash` condition and reuses
// validateManualProductAccessToken (the same function resolveValidatedOrderItems
// already uses at checkout) so a missing hash is just another way to fail
// the match, not a way to skip the gate entirely.
//
// Same harness pattern as tests/manual-product-checkout-security.test.js:
// boots the real exported Express app and makes real HTTP requests.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-product-detail-access-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.PRINTIFY_API_TOKEN = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { app } = require('../index.js');
const db = require('../db.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});

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

async function getProduct(id, headerToken) {
  const res = await fetch(`${baseUrl}/api/products/${id}`, headerToken ? { headers: { 'X-Access-Token': headerToken } } : undefined);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

let nextProductId = 970001;

async function seedManualProduct({ withToken = true, tokenTtlHours = 48 } = {}) {
  const productId = nextProductId++;
  let rawToken = null;
  let tokenHash = null;
  let expiresAt = null;
  if (withToken) {
    rawToken = crypto.randomBytes(32).toString('hex');
    tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    expiresAt = new Date(Date.now() + tokenTtlHours * 60 * 60 * 1000).toISOString();
  }
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, access_token_hash, access_token_expires_at)
     VALUES (?, ?, ?, ?, ?, 'local', 'manual', ?, ?)`,
    [productId, '[TEST] Manual product detail-access fixture', 'synthetic fixture', 5, 1, tokenHash, expiresAt]
  );
  return { productId, rawToken };
}

// ═══════════════════════════════════════════════════════════════════════════
// A — no access_token_hash configured at all: must fail closed, not open
// ═══════════════════════════════════════════════════════════════════════════

test('A: manual product with NULL access_token_hash and no token header returns 404, not the product', async () => {
  const product = await seedManualProduct({ withToken: false });
  const res = await getProduct(product.productId);
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'Product not found');
});

test('A2: manual product with NULL access_token_hash still returns 404 even if SOME token header is supplied', async () => {
  const product = await seedManualProduct({ withToken: false });
  const res = await getProduct(product.productId, 'any-token-at-all');
  assert.equal(res.status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// B — a valid token still works (no regression for the intended flow)
// ═══════════════════════════════════════════════════════════════════════════

test('B: manual product with a valid, non-expired token returns 200 with product data', async () => {
  const product = await seedManualProduct();
  const res = await getProduct(product.productId, product.rawToken);
  assert.equal(res.status, 200);
  assert.equal(res.json.id, product.productId);
});

// ═══════════════════════════════════════════════════════════════════════════
// C — wrong token
// ═══════════════════════════════════════════════════════════════════════════

test('C: manual product with a wrong token returns 404', async () => {
  const product = await seedManualProduct();
  const res = await getProduct(product.productId, 'this-is-not-the-right-token');
  assert.equal(res.status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// D — expired token
// ═══════════════════════════════════════════════════════════════════════════

test('D: manual product with an expired token returns 404 even though the token itself is otherwise correct', async () => {
  const product = await seedManualProduct({ tokenTtlHours: -1 });
  const res = await getProduct(product.productId, product.rawToken);
  assert.equal(res.status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// Non-manual products are completely unaffected
// ═══════════════════════════════════════════════════════════════════════════

test('a normal type=printify product (supplier_id != manual) is served with no token required, unaffected by this gate', async () => {
  const productId = nextProductId++;
  await dbRun(
    `INSERT INTO products (id, title, description, price, stock, type, supplier_id, printifyId)
     VALUES (?, ?, ?, ?, ?, 'printify', 'printify', ?)`,
    [productId, '[TEST] Ordinary printify product', 'synthetic fixture', 149.9, 999, 'live-pf-id-detail-access']
  );
  const res = await getProduct(productId);
  assert.equal(res.status, 200);
  assert.equal(res.json.id, productId);
});
