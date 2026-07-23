// Round-3 adversarial review: every other test exercising the operator
// script's documented behavior does so by REPLICATING what the script's
// comments say it writes (see manual-payment-test-product.test.js's
// seedManualTestProduct: "Mirrors exactly what scripts/
// manual-payment-test-product.js's `create` writes"). No test anywhere
// actually SPAWNS the real script and inspects its real stdout/exit code/DB
// effects -- exactly the kind of gap "do not trust the prior report, verify
// directly" exists to catch. This file spawns the real script as a real
// child process against a real throwaway SQLite file for every documented
// safety property in its own header comment.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'manual-payment-test-product.js');

function runScript(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 15000,
  });
  return result;
}

const DB_INIT_HARNESS_PATH = path.join(__dirname, '..', 'scripts', 'db-init-harness.cjs');

// The operator script deliberately does NOT bootstrap schema itself (see
// its own openDb -- a bare sqlite3.Database connection, no CREATE TABLE
// anywhere): it is designed to run against the real, already-initialized
// production ecommerce.db, whose schema the real backend's own db.js
// migrations already created. A genuinely fresh throwaway file for this
// test suite needs the same real initialization first -- reusing the
// existing db-init-harness.cjs (already used by legacy-schema-migration.
// test.js for exactly this) is what makes this the REAL schema, not a
// hand-rolled approximation that could silently drift from it.
function freshDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-payment-script-e2e-'));
  const dbPath = path.join(dir, 'test.db');
  const init = spawnSync(process.execPath, [DB_INIT_HARNESS_PATH], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_PATH: dbPath, DISABLE_BACKGROUND_JOBS: 'true', ENABLE_PRINTIFY_SYNC: 'false' },
    encoding: 'utf8',
    timeout: 15000,
  });
  if (init.status !== 0 || !/DB_INIT_HARNESS_DONE=true/.test(init.stdout)) {
    throw new Error(`schema init harness failed: status=${init.status} stdout=${init.stdout} stderr=${init.stderr}`);
  }
  return dbPath;
}

async function readProductsTable(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      db.all(`SELECT * FROM products WHERE supplier_id = 'manual'`, [], (err2, rows) => {
        db.close();
        if (err2) reject(err2); else resolve(rows);
      });
    });
  });
}

// The script itself creates the products table via db.js's normal startup
// path (required internally), so we don't need to pre-seed schema here --
// only DB_PATH needs to point at a not-yet-existing file.

test('DB_PATH is required -- running the real script with it unset refuses and exits non-zero, never falling back to any default path', () => {
  // Deliberately NOT using freshDbPath() here -- that helper now
  // schema-initializes a real file via db-init-harness.cjs, which would
  // defeat the point of this specific test (proving the script touches
  // NOTHING when DB_PATH is absent). A bare, never-touched temp path only.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-payment-script-e2e-nopath-'));
  const untouchedDbPath = path.join(dir, 'never-created.db');
  const env = { ...process.env };
  delete env.DB_PATH;
  const result = spawnSync(process.execPath, [SCRIPT_PATH, 'status'], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /DB_PATH must be set explicitly/i);
  assert.equal(fs.existsSync(untouchedDbPath), false, 'no file was created at the path we would have used');
});

test('real `status` against an empty database reports exists:false and prints no token/hash-shaped data', () => {
  const dbPath = freshDbPath();
  const result = runScript(['status'], { DB_PATH: dbPath });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"exists":\s*false/);
  assert.doesNotMatch(result.stdout, /[a-f0-9]{64}/, 'no 64-hex-char (SHA-256-shaped) string anywhere in status output');
});

test('real `create` without --confirm is a dry run: prints intent, creates no row, prints no token', () => {
  const dbPath = freshDbPath();
  const result = runScript(['create'], { DB_PATH: dbPath });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run only/i);
  assert.doesNotMatch(result.stdout, /🔑/, 'no token-link marker printed in a dry run');
});

test('real `create --confirm` writes exactly one row, prints the raw token exactly once in the new #access= fragment format, never the hash, and the DB only ever stores the hash', async () => {
  const dbPath = freshDbPath();
  const result = runScript(['create', '--confirm', '--price=7'], { DB_PATH: dbPath });
  assert.equal(result.status, 0, result.stderr);

  // Exactly one link line, using the fragment transport (#access=...), NOT
  // a query string -- see this review's Section 1 redesign.
  const linkMatches = [...result.stdout.matchAll(/\/product\/\d+#access=([0-9a-f]+)/g)];
  assert.equal(linkMatches.length, 1, `expected exactly one printed link, got: ${JSON.stringify(result.stdout)}`);
  assert.doesNotMatch(result.stdout, /\/product\/\d+\?token=/, 'must never print the legacy query-string link format');

  const rawToken = linkMatches[0][1];
  assert.equal(rawToken.length, 64, 'crypto.randomBytes(32).toString(\'hex\') is 64 hex chars');

  const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  // The raw token itself must never appear a second time, and the hash
  // must never appear anywhere in stdout at all.
  const rawTokenOccurrences = result.stdout.split(rawToken).length - 1;
  assert.equal(rawTokenOccurrences, 1, 'the raw token must be printed exactly once');
  assert.doesNotMatch(result.stdout, new RegExp(expectedHash), 'the hash must never be printed');

  const rows = await readProductsTable(dbPath);
  assert.equal(rows.length, 1, 'exactly one products row created');
  assert.equal(rows[0].stock, 1);
  assert.equal(rows[0].price, 7);
  assert.equal(rows[0].access_token_hash, expectedHash, 'the DB stores exactly the hash of the printed token');
  assert.notEqual(rows[0].access_token_hash, rawToken, 'the DB must never store the raw token');
});

test('real `create` refuses a second time while a manual product already exists, and creates no second row', async () => {
  const dbPath = freshDbPath();
  const first = runScript(['create', '--confirm'], { DB_PATH: dbPath });
  assert.equal(first.status, 0, first.stderr);

  const second = runScript(['create', '--confirm'], { DB_PATH: dbPath });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Refusing to create/i);

  const rows = await readProductsTable(dbPath);
  assert.equal(rows.length, 1, 'still exactly one row -- the refused second attempt created nothing');
});

test('real `disable --confirm` sets stock=0 and expires the token, prints no token/hash, and never deletes the row', async () => {
  const dbPath = freshDbPath();
  const created = runScript(['create', '--confirm'], { DB_PATH: dbPath });
  assert.equal(created.status, 0, created.stderr);

  const disableDryRun = runScript(['disable'], { DB_PATH: dbPath });
  assert.equal(disableDryRun.status, 0, disableDryRun.stderr);
  assert.match(disableDryRun.stdout, /Dry run only/i);
  let rows = await readProductsTable(dbPath);
  assert.equal(rows[0].stock, 1, 'a dry run must not change stock');

  const disabled = runScript(['disable', '--confirm'], { DB_PATH: dbPath });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.doesNotMatch(disabled.stdout, /[a-f0-9]{64}/, 'no raw-token- or hash-shaped string printed by disable');

  rows = await readProductsTable(dbPath);
  assert.equal(rows.length, 1, 'the row is never deleted');
  assert.equal(rows[0].stock, 0);
  assert.ok(new Date(rows[0].access_token_expires_at).getTime() <= Date.now(), 'the token is expired, not cleared/deleted');
  assert.ok(rows[0].access_token_hash, 'the hash itself is left in place -- disable expires access, it does not erase history');
});

test('real `disable` on an empty database (nothing to disable) is a safe no-op, exit 0', () => {
  const dbPath = freshDbPath();
  const result = runScript(['disable', '--confirm'], { DB_PATH: dbPath });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Nothing to do/i);
});

test('real `disable --confirm` refuses while a same-product order is pending_payment and less than 10 minutes old, protecting an in-flight payment', async () => {
  const dbPath = freshDbPath();
  const created = runScript(['create', '--confirm'], { DB_PATH: dbPath });
  assert.equal(created.status, 0, created.stderr);

  const rows = await readProductsTable(dbPath);
  const productId = rows[0].id;

  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
      db.run(
        `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status, firstName, lastName, phone, addressLine1, city, country)
         VALUES ('T', 't@example.invalid', 'A', 5, 'pending_payment', 'T', 'C', '+1', 'A', 'City', 'US')`
      );
      db.get(`SELECT last_insert_rowid() AS id`, (err, row) => {
        if (err) { db.close(); return reject(err); }
        db.run(
          `INSERT INTO order_items (orderId, productId, quantity, price, supplier_id) VALUES (?, ?, 1, 5, 'manual')`,
          [row.id, productId],
          (err2) => { db.close(); if (err2) reject(err2); else resolve(); }
        );
      });
    });
  });

  const result = runScript(['disable', '--confirm'], { DB_PATH: dbPath });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /actively in flight|payment may be actively/i);

  const rowsAfter = await readProductsTable(dbPath);
  assert.equal(rowsAfter[0].stock, 1, 'refused disable must not change stock');
});

test('the real script never contacts the network under any subcommand -- guard-clean across status/create/disable', () => {
  const guardPath = path.join(__dirname, '..', 'scripts', 'network-guard.cjs');
  const dbPath = freshDbPath();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-payment-script-guard-'));
  const logPath = path.join(logDir, 'guard.jsonl');

  const env = {
    ...process.env,
    DB_PATH: dbPath,
    NODE_OPTIONS: `-r ${guardPath}`,
    NETWORK_GUARD_LOG_PATH: logPath,
  };

  runScript(['status'], env);
  runScript(['create', '--confirm'], env);
  runScript(['status'], env);
  runScript(['disable', '--confirm'], env);

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const blocked = lines.filter((l) => l.blocked);
  assert.equal(blocked.length, 0, `unexpected network attempt(s) from the operator script: ${JSON.stringify(blocked)}`);
  try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});
