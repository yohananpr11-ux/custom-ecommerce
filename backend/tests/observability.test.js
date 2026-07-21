// Proves the new safe, non-PII structured observability events
// (OPS_PRINTIFY_SYNC, OPS_FULFILLMENT_RECOVERY, APP_RUNTIME_NODE_VERSION)
// added in this PR: they fire exactly when expected, carry correct
// aggregate counts, and never leak customer data, tokens, auth headers,
// external/supplier order IDs, or raw exception response bodies.
//
// No real Printify/Telegram/payment network call is ever made — the
// Printify-failure case mocks axios.get() directly (node:test's
// mock.method(), same technique already used throughout
// printify-fulfillment-reconciliation.test.js), and the
// APP_RUNTIME_NODE_VERSION case spawns the real app with
// DISABLE_BACKGROUND_JOBS=true so it never reaches any sync/cron code at
// all before being killed.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mock } = require('node:test');
const { spawn } = require('node:child_process');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'observability-test-'));
const tmpDb = path.join(tmpDir, 'isolated.db');
process.env.DB_PATH = tmpDb;
process.env.ENABLE_PRINTIFY_SYNC = 'false';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.RESEND_API_KEY = '';

const { processPaidOrderFulfillment } = require('../index.js');
const db = require('../db.js');
const printify = require('../services/printify.js');
const { recoverStalePaidFulfillments } = require('../services/fulfillment-recovery.js');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort on Windows */ }
});

test.before(async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
});

// Captures every console.log call made during fn() and returns the lines.
async function captureLogs(fn) {
  const lines = [];
  const logMock = mock.method(console, 'log', (...args) => { lines.push(args.join(' ')); });
  try {
    await fn();
  } finally {
    logMock.mock.restore();
  }
  return lines;
}

function opsLines(lines, tag) {
  return lines.filter((l) => l.startsWith(tag));
}

async function seedPaidPrintifyOrder(email = 'observability-fixture@example.com') {
  const productInsert = await dbRun(
    `INSERT INTO products (title, description, price, priceUSD, stock, type, supplier_id, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Observability Test Product', 'seeded for observability tests', 100, 27, 10, 'printify', 'printify', 'pf-obs-product']
  );
  const productId = productInsert.lastID;
  const orderInsert = await dbRun(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Observability Fixture', email, '1 Fixture St, Tel Aviv, IL', 100, 'paid', 'Observability', 'Fixture', '0501234567', '1 Fixture St', 'Tel Aviv', 'IL']
  );
  const orderId = orderInsert.lastID;
  await dbRun(
    `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id, fulfillment_status) VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, productId, 1, 100, 'printify', 'pending']
  );
  return orderId;
}

// ── 1/2. Printify sync events ───────────────────────────────────────────────

test('successful Printify sync emits exactly one safe OPS_PRINTIFY_SYNC summary event', async () => {
  const originalToken = printify.token;
  printify.token = ''; // forces the built-in no-network simulate-sync branch

  const lines = await captureLogs(async () => {
    const count = await printify.syncProducts('startup');
    assert.equal(count, 10);
  });

  printify.token = originalToken;

  const events = opsLines(lines, 'OPS_PRINTIFY_SYNC');
  assert.equal(events.length, 1, 'exactly one OPS_PRINTIFY_SYNC line');
  assert.match(events[0], /^OPS_PRINTIFY_SYNC source=startup result=success products_seen=10 products_updated=10 duration_ms=\d+$/);
});

test('failed Printify sync emits a coarse safe OPS_PRINTIFY_SYNC error event, never the raw response body', async () => {
  const originalToken = printify.token;
  const originalShopId = printify.shopId;
  printify.token = 'fake-real-token-not-a-placeholder';
  printify.shopId = 'fake-shop-id';

  const leakyBody = { email: 'should-never-leak@example.com', token: 'super-secret-leaked-token-xyz' };
  const getMock = mock.method(axios, 'get', async () => {
    const err = new Error('Request failed with status code 500');
    err.response = { status: 500, data: leakyBody };
    throw err;
  });

  let lines;
  try {
    lines = await captureLogs(async () => {
      await assert.rejects(() => printify.syncProducts('scheduled'));
    });
  } finally {
    getMock.mock.restore();
    printify.token = originalToken;
    printify.shopId = originalShopId;
  }

  const events = opsLines(lines, 'OPS_PRINTIFY_SYNC');
  assert.equal(events.length, 1, 'exactly one OPS_PRINTIFY_SYNC line even on failure');
  assert.match(events[0], /^OPS_PRINTIFY_SYNC source=scheduled result=failed products_seen=0 products_updated=0 error_code=HTTP_500 duration_ms=\d+$/);

  const fullOutput = lines.join('\n');
  assert.doesNotMatch(fullOutput, /should-never-leak@example\.com/, 'raw response body email must never appear in logs');
  assert.doesNotMatch(fullOutput, /super-secret-leaked-token-xyz/, 'raw response body token must never appear in logs');
});

// ── 3/4. Recovery startup vs scheduled source tagging ───────────────────────

test('startup recovery pass (zero candidates) emits one OPS_FULFILLMENT_RECOVERY summary event', async () => {
  const lines = await captureLogs(async () => {
    const result = await recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async () => {},
      source: 'startup',
    });
    assert.equal(result.scanned, 0);
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  assert.equal(events.length, 1);
  assert.match(events[0], /^OPS_FULFILLMENT_RECOVERY source=startup result=success candidates=0 recovered=0 failed=0 skipped=0 duration_ms=\d+$/);
});

test('scheduled recovery pass with one eligible order emits one OPS_FULFILLMENT_RECOVERY summary event tagged scheduled', async () => {
  await seedPaidPrintifyOrder('scheduled-fixture@example.com');

  const lines = await captureLogs(async () => {
    const result = await recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async (orderId) => { await processPaidOrderFulfillment(orderId, 'Recovery'); },
      source: 'scheduled',
    });
    assert.equal(result.scanned, 1);
    assert.equal(result.recovered, 1);
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  assert.equal(events.length, 1);
  assert.match(events[0], /^OPS_FULFILLMENT_RECOVERY source=scheduled result=success candidates=1 recovered=1 failed=0 skipped=0 duration_ms=\d+$/);
});

// ── 5. Overlap detection ────────────────────────────────────────────────────

test('two overlapping recovery calls: the second emits skipped_overlap immediately', async () => {
  let releaseFirst;
  const firstCallGate = new Promise((resolve) => { releaseFirst = resolve; });

  const lines = await captureLogs(async () => {
    // Fired but not awaited yet -- scanInFlight is set synchronously before
    // the first `await` inside recoverStalePaidFulfillments, so the second
    // call below is guaranteed to observe it.
    const p1 = recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async () => { await firstCallGate; },
      source: 'scheduled',
    });
    const p2 = recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async () => {},
      source: 'scheduled',
    });

    const r2 = await p2;
    assert.equal(r2.overlapped, true);
    releaseFirst();
    await p1;
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  const overlapEvents = events.filter((l) => l.includes('result=skipped_overlap'));
  assert.equal(overlapEvents.length, 1, 'exactly one skipped_overlap event from the second call');
  assert.match(overlapEvents[0], /^OPS_FULFILLMENT_RECOVERY source=scheduled result=skipped_overlap candidates=0 recovered=0 failed=0 skipped=1 duration_ms=\d+$/);
});

// ── 6/7. Partial failure still emits one aggregate event with correct counts ─

test('one failed order among several does not prevent the final aggregate event, and counts are correct', async () => {
  const okOrderId = await seedPaidPrintifyOrder('partial-ok-fixture@example.com');
  const failOrderId = await seedPaidPrintifyOrder('partial-fail-fixture@example.com');

  const lines = await captureLogs(async () => {
    const result = await recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async (orderId) => {
        if (orderId === failOrderId) throw new Error('simulated recovery failure');
        await processPaidOrderFulfillment(orderId, 'Recovery');
      },
      source: 'scheduled',
    });
    assert.equal(result.scanned, 2);
    assert.equal(result.recovered, 1);
    assert.equal(result.failed, 1);
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  assert.equal(events.length, 1, 'exactly one aggregate event even though one order failed');
  assert.match(events[0], /^OPS_FULFILLMENT_RECOVERY source=scheduled result=partial candidates=2 recovered=1 failed=1 skipped=0 duration_ms=\d+$/);
  void okOrderId;
});

// ── 8. No PII/token/external-ID fixture values leak into the OPS events ─────

test('OPS_FULFILLMENT_RECOVERY events never contain seeded customer PII, only internal aggregate counts', async () => {
  const canaryEmail = 'pii-canary-should-never-appear@example.com';
  await seedPaidPrintifyOrder(canaryEmail);

  const lines = await captureLogs(async () => {
    await recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async (orderId) => { await processPaidOrderFulfillment(orderId, 'Recovery'); },
      source: 'startup',
    });
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  assert.ok(events.length >= 1);
  for (const line of events) {
    assert.doesNotMatch(line, /pii-canary/, 'no customer email in OPS event');
    assert.doesNotMatch(line, /0501234567/, 'no phone number in OPS event');
    assert.doesNotMatch(line, /Tel Aviv/, 'no address in OPS event');
    assert.doesNotMatch(line, /Bearer /i, 'no auth header in OPS event');
    assert.doesNotMatch(line, /pf-obs-product/, 'no supplier product ref in OPS event');
    // Only the documented field set is present.
    assert.match(line, /^OPS_FULFILLMENT_RECOVERY source=\w+ result=\w+ candidates=\d+ recovered=\d+ failed=\d+ skipped=\d+ duration_ms=\d+$/);
  }
});

// ── 10. Runtime startup log reports the actual process.version ─────────────

test('APP_RUNTIME_NODE_VERSION startup log reports the real running Node version', async () => {
  const indexPath = path.join(__dirname, '..', 'index.js');
  const startupDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'observability-startup-'));
  const startupDb = path.join(startupDbDir, 'startup.db');
  const guardPath = path.join(__dirname, '..', 'scripts', 'network-guard.cjs');
  const guardLogPath = path.join(startupDbDir, 'guard.jsonl');

  const child = spawn(process.execPath, ['-r', guardPath, indexPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: startupDb,
      PORT: '4098',
      NODE_ENV: 'test',
      DISABLE_BACKGROUND_JOBS: 'true',
      NETWORK_GUARD_LOG_PATH: guardLogPath,
      PRINTIFY_API_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      RESEND_API_KEY: '',
      ENABLE_PRINTIFY_SYNC: 'false',
    },
  });

  let stdout = '';
  const sawLine = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for APP_RUNTIME_NODE_VERSION log line')), 15000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('APP_RUNTIME_NODE_VERSION=')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
  });

  try {
    await sawLine;
  } finally {
    child.kill();
    try { fs.rmSync(startupDbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('APP_RUNTIME_NODE_VERSION='));
  assert.ok(line, 'APP_RUNTIME_NODE_VERSION line must appear in real server startup output');
  // Anchored full-line match, not a substring extraction -- proves nothing
  // else (no extra env values, no trailing text) rides on the same line.
  assert.equal(line, `APP_RUNTIME_NODE_VERSION=${process.version}`, 'the whole line must be exactly the label and the real running Node version, nothing else');
});

// ── Adversarial-review additions: non-Error rejections and source allowlist ─
//
// Found by an independent adversarial review of this PR: err.message /
// error.message access on a non-Error rejection (Promise.reject(null) and
// friends are valid JS) threw its own TypeError, which escaped the
// surrounding catch block and silently prevented the OPS_* event from ever
// being emitted -- exactly the "logging must not swallow the original
// operational failure" property this instrumentation exists to provide.
// Fixed with safeErrMessage()/_safeErrorCode() guards in both
// services/fulfillment-recovery.js and services/printify.js.

test('a non-Error rejection from processPaidOrderFulfillment does not prevent the OPS_FULFILLMENT_RECOVERY aggregate event', async () => {
  await seedPaidPrintifyOrder('non-error-rejection-fixture@example.com');

  const lines = await captureLogs(async () => {
    const result = await recoverStalePaidFulfillments({
      // eslint-disable-next-line prefer-promise-reject-errors -- deliberately non-Error
      processPaidOrderFulfillment: async () => { throw null; },
      source: 'startup',
    });
    assert.equal(result.scanned, 1);
    assert.equal(result.failed, 1);
  });

  const events = opsLines(lines, 'OPS_FULFILLMENT_RECOVERY');
  assert.equal(events.length, 1, 'the aggregate event must still fire even when the underlying rejection is not an Error');
  assert.match(events[0], /^OPS_FULFILLMENT_RECOVERY source=startup result=failed candidates=1 recovered=0 failed=1 skipped=0 duration_ms=\d+$/);
});

test('a non-Error rejection from axios.get does not prevent the OPS_PRINTIFY_SYNC failure event', async () => {
  const originalToken = printify.token;
  const originalShopId = printify.shopId;
  printify.token = 'fake-real-token-not-a-placeholder';
  printify.shopId = 'fake-shop-id';

  // eslint-disable-next-line prefer-promise-reject-errors -- deliberately non-Error
  const getMock = mock.method(axios, 'get', async () => { throw 'a plain string rejection, not an Error'; });

  let lines;
  try {
    lines = await captureLogs(async () => {
      await assert.rejects(() => printify.syncProducts('scheduled'));
    });
  } finally {
    getMock.mock.restore();
    printify.token = originalToken;
    printify.shopId = originalShopId;
  }

  const events = opsLines(lines, 'OPS_PRINTIFY_SYNC');
  assert.equal(events.length, 1, 'the failure event must still fire even when the underlying rejection is not an Error');
  assert.match(events[0], /^OPS_PRINTIFY_SYNC source=scheduled result=failed products_seen=0 products_updated=0 error_code=UNKNOWN_ERROR duration_ms=\d+$/);
});

test('an unrecognized/malicious source value is replaced with "unknown" in both OPS event types, preventing log-line injection', async () => {
  const maliciousSource = 'startup\nOPS_FULFILLMENT_RECOVERY source=scheduled result=success candidates=0 recovered=0 failed=0 skipped=0 duration_ms=0\nFORGED';

  const recoveryLines = await captureLogs(async () => {
    await recoverStalePaidFulfillments({
      processPaidOrderFulfillment: async () => {},
      source: maliciousSource,
    });
  });
  const recoveryEvents = opsLines(recoveryLines, 'OPS_FULFILLMENT_RECOVERY');
  assert.equal(recoveryEvents.length, 1, 'a malicious multi-line source must not forge additional OPS lines');
  // candidates/recovered may be non-zero here since this test file shares
  // one DB across earlier tests -- only source-sanitization and single-line
  // integrity are this test's concern, not the exact counts.
  assert.match(recoveryEvents[0], /^OPS_FULFILLMENT_RECOVERY source=unknown result=success candidates=\d+ recovered=\d+ failed=0 skipped=0 duration_ms=\d+$/);

  const originalToken = printify.token;
  printify.token = '';
  const syncLines = await captureLogs(async () => {
    await printify.syncProducts(maliciousSource);
  });
  printify.token = originalToken;
  const syncEvents = opsLines(syncLines, 'OPS_PRINTIFY_SYNC');
  assert.equal(syncEvents.length, 1, 'a malicious multi-line source must not forge additional OPS lines');
  assert.match(syncEvents[0], /^OPS_PRINTIFY_SYNC source=unknown result=success products_seen=10 products_updated=10 duration_ms=\d+$/);
});
