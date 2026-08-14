// Regression coverage for the partial unique index on products.printifyId
// (backend/db.js): real DB-engine-level enforcement that two products can
// never share one non-empty Printify identity, on top of (not instead of)
// the application-level guards in checkout and sync.
//
// Same db-init-harness.cjs child-process pattern as
// tests/legacy-schema-migration.test.js: a real, separate Node process
// requires backend/db.js fresh against a given DB_PATH, so this proves
// actual startup behavior -- not an in-process require-cache approximation
// of it.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();

const HARNESS_PATH = path.join(__dirname, '..', 'scripts', 'db-init-harness.cjs');

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}
function closeDb(conn) {
  return new Promise((resolve) => conn.close(resolve));
}
function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));
}
function all(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); }));
}

function runHarness(dbPath) {
  return spawnSync(process.execPath, [HARNESS_PATH], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      NODE_ENV: 'test',
      HERMETIC_TEST_MODE: 'true',
      DISABLE_BACKGROUND_JOBS: 'true',
      PRINTIFY_API_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      RESEND_API_KEY: '',
      ENABLE_PRINTIFY_SYNC: 'false',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function newTmpDb(prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tmpDir, 'test.db');
}

const MINIMAL_PRODUCTS_SCHEMA = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    type TEXT DEFAULT 'local',
    printifyId TEXT
  )
`;

// ═══════════════════════════════════════════════════════════════════════════
// A/E — clean startup: index is created and actually enforces uniqueness
// ═══════════════════════════════════════════════════════════════════════════

test('A: after a clean startup, inserting a duplicate non-empty printifyId is rejected by SQLite itself', async () => {
  const dbPath = newTmpDb('unique-index-clean-');
  const harnessResult = runHarness(dbPath);
  assert.equal(harnessResult.status, 0, `harness must exit 0; stderr: ${harnessResult.stderr}`);

  const conn = openDb(dbPath);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'printify', 'dup-id-123')`);
  await assert.rejects(
    () => run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'printify', 'dup-id-123')`),
    /UNIQUE constraint failed/i,
  );
  await closeDb(conn);
});

test('E: distinct non-empty printifyId values all succeed', async () => {
  const dbPath = newTmpDb('unique-index-distinct-');
  const harnessResult = runHarness(dbPath);
  assert.equal(harnessResult.status, 0, `harness must exit 0; stderr: ${harnessResult.stderr}`);

  const conn = openDb(dbPath);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'printify', 'id-aaa')`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'printify', 'id-bbb')`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('C', 10, 'printify', 'id-ccc')`);
  const rows = await all(conn, `SELECT COUNT(*) AS c FROM products WHERE printifyId IN ('id-aaa','id-bbb','id-ccc')`);
  assert.equal(rows[0].c, 3);
  await closeDb(conn);
});

// ═══════════════════════════════════════════════════════════════════════════
// B/C/D — NULL, empty, and whitespace-only printifyId are all exempt
// ═══════════════════════════════════════════════════════════════════════════

test('B: multiple NULL printifyId values are allowed (not treated as duplicates of each other)', async () => {
  const dbPath = newTmpDb('unique-index-null-');
  const harnessResult = runHarness(dbPath);
  assert.equal(harnessResult.status, 0, `harness must exit 0; stderr: ${harnessResult.stderr}`);

  const conn = openDb(dbPath);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'local', NULL)`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'local', NULL)`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('C', 10, 'local', NULL)`);
  const rows = await all(conn, `SELECT COUNT(*) AS c FROM products WHERE printifyId IS NULL`);
  assert.equal(rows[0].c, 3);
  await closeDb(conn);
});

test('C: multiple empty-string printifyId values are allowed', async () => {
  const dbPath = newTmpDb('unique-index-empty-');
  const harnessResult = runHarness(dbPath);
  assert.equal(harnessResult.status, 0, `harness must exit 0; stderr: ${harnessResult.stderr}`);

  const conn = openDb(dbPath);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'local', '')`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'local', '')`);
  const rows = await all(conn, `SELECT COUNT(*) AS c FROM products WHERE printifyId = ''`);
  assert.equal(rows[0].c, 2);
  await closeDb(conn);
});

test('D: multiple whitespace-only printifyId values are allowed (excluded by TRIM() in the partial index)', async () => {
  const dbPath = newTmpDb('unique-index-whitespace-');
  const harnessResult = runHarness(dbPath);
  assert.equal(harnessResult.status, 0, `harness must exit 0; stderr: ${harnessResult.stderr}`);

  const conn = openDb(dbPath);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'local', '   ')`);
  await run(conn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'local', '  ')`);
  const rows = await all(conn, `SELECT COUNT(*) AS c FROM products WHERE printifyId IN ('   ', '  ')`);
  assert.equal(rows[0].c, 2);
  await closeDb(conn);
});

// ═══════════════════════════════════════════════════════════════════════════
// F/G — a pre-existing duplicate at first startup does not crash the process
// ═══════════════════════════════════════════════════════════════════════════

test('F/G: a legacy DB with a pre-existing duplicate printifyId does not crash startup, and the failure is logged loudly and distinctively', async () => {
  const dbPath = newTmpDb('unique-index-preexisting-dup-');

  // Seed a minimal legacy products table (pre-dates this index) with a real
  // conflict already present, exactly like a database that predates this
  // migration and was never repaired.
  const seedConn = openDb(dbPath);
  await run(seedConn, MINIMAL_PRODUCTS_SCHEMA);
  await run(seedConn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'printify', 'preexisting-dup')`);
  await run(seedConn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'printify', 'preexisting-dup')`);
  await closeDb(seedConn);

  const harnessResult = runHarness(dbPath);

  // F: must not crash -- the whole store staying up matters more than one
  // integrity constraint being temporarily unavailable.
  assert.equal(harnessResult.status, 0, `harness must still exit 0 despite the pre-existing duplicate; stderr: ${harnessResult.stderr}`);
  assert.match(harnessResult.stdout, /DB_INIT_HARNESS_DONE=true/);

  // G: must not fail silently -- every required substring present verbatim.
  assert.match(harnessResult.stderr, /Printify/);
  assert.match(harnessResult.stderr, /uniqueness/);
  assert.match(harnessResult.stderr, /duplicate/);
  assert.match(harnessResult.stderr, /index not active/);

  // The two pre-existing conflicting rows themselves must be untouched --
  // this migration only ever adds an index, it never modifies data.
  const verifyConn = openDb(dbPath);
  const rows = await all(verifyConn, `SELECT COUNT(*) AS c FROM products WHERE printifyId = 'preexisting-dup'`);
  assert.equal(rows[0].c, 2);
  await closeDb(verifyConn);
});

// ═══════════════════════════════════════════════════════════════════════════
// H — after the operator resolves the duplicate, a later restart succeeds
// ═══════════════════════════════════════════════════════════════════════════

test('H: after the duplicate is resolved, a subsequent restart successfully creates the index', async () => {
  const dbPath = newTmpDb('unique-index-recovery-');

  const seedConn = openDb(dbPath);
  await run(seedConn, MINIMAL_PRODUCTS_SCHEMA);
  await run(seedConn, `INSERT INTO products (title, price, type, printifyId) VALUES ('A', 10, 'printify', 'recoverable-dup')`);
  const secondInsert = await run(seedConn, `INSERT INTO products (title, price, type, printifyId) VALUES ('B', 10, 'printify', 'recoverable-dup')`);
  await closeDb(seedConn);

  const firstRun = runHarness(dbPath);
  assert.equal(firstRun.status, 0);
  assert.match(firstRun.stderr, /index not active/, 'first run must fail to create the index while the duplicate exists');

  // Operator resolves the conflict exactly the way this session's real
  // production repair did: clear the printifyId on the stale duplicate.
  const repairConn = openDb(dbPath);
  await run(repairConn, `UPDATE products SET printifyId = NULL WHERE id = ?`, [secondInsert.lastID]);
  await closeDb(repairConn);

  const secondRun = runHarness(dbPath);
  assert.equal(secondRun.status, 0, `second harness run must exit 0; stderr: ${secondRun.stderr}`);
  assert.doesNotMatch(secondRun.stderr, /index not active/, 'second run must succeed now that the conflict is resolved');

  const verifyConn = openDb(dbPath);
  const indexRows = await all(
    verifyConn,
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_products_printifyId_unique'`,
  );
  assert.equal(indexRows.length, 1, 'the unique index must now exist');

  await assert.rejects(
    () => run(verifyConn, `INSERT INTO products (title, price, type, printifyId) VALUES ('C', 10, 'printify', 'recoverable-dup')`),
    /UNIQUE constraint failed/i,
    'the now-active index must genuinely enforce uniqueness',
  );
  await closeDb(verifyConn);
});
