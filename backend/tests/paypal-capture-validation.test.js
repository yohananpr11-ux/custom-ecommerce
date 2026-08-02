const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolate DB_PATH to a throwaway file before requiring index.js, even though
// this specific function makes no DB calls — keeps this test consistent with
// "never touch the real ecommerce.db" regardless of what index.js does at
// module-load time.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-capture-test-')), 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.ENABLE_PRINTIFY_SYNC = 'false';

// require.main !== module here (we're required by the test runner, not run
// directly), so index.js's own require.main guard skips app.listen() and
// pricingEngine.start() entirely — this import has no network/port side effects.
const { validatePaypalCaptureAgainstExpectation } = require('../index.js');

test.after(() => {
  // Best-effort: on Windows the sqlite3 connection opened by requiring
  // index.js may still hold the file open at this point (no explicit
  // db.close() is exposed to this test), which can make rmSync fail with
  // EPERM. Not fatal — it's an OS temp directory either way.
  try {
    fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
  } catch { /* best-effort cleanup only */ }
});

test('accepts a capture matching the stored expectation exactly', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('accepts a capture within the existing small numeric tolerance', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'USD',
    captureValue: 47.51, // 0.01 off from expected
    expectedCurrency: 'USD',
    expectedAmount: 47.50,
  });
  assert.equal(verdict.ok, true);
});

test('rejects a capture that is not COMPLETED, before any currency/amount check', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'PENDING',
    captureCurrency: 'ILS',
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'not_completed');
});

test('rejects a currency mismatch even when the amount matches numerically', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'USD', // order was created expecting ILS
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'currency_mismatch');
});

test('rejects an amount below the expected value beyond tolerance', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 1.00, // manipulated-price style underpayment
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'amount_mismatch');
});

test('rejects an amount above the expected value beyond tolerance', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 999.00,
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'amount_mismatch');
});

test('fails closed when expected currency is missing (legacy order)', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 179.80,
    expectedCurrency: null,
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'missing_expectation');
});

test('fails closed when expected amount is missing (legacy order)', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: null,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'missing_expectation');
});

test('fails closed when expected amount is not a finite number', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ILS',
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: NaN,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'missing_expectation');
});

test('is case-insensitive on currency comparison (defensive, not a real-world PayPal case)', () => {
  const verdict = validatePaypalCaptureAgainstExpectation({
    captureStatus: 'COMPLETED',
    captureCurrency: 'ils',
    captureValue: 179.80,
    expectedCurrency: 'ILS',
    expectedAmount: 179.80,
  });
  assert.equal(verdict.ok, true);
});

// This test module never calls axios, never contacts PayPal, and only ever
// talks to a throwaway DB path that nothing in this suite even queries —
// no real PayPal network request is possible from this file.
test('this suite made no outbound HTTP requests (sanity check on test design, not runtime instrumentation)', () => {
  assert.equal(typeof validatePaypalCaptureAgainstExpectation, 'function');
});
