// Proves backend/db.js's schema migration is safe to run against a
// synthetic pre-PR ("legacy") database, and that running it a second time
// (in a genuinely separate fresh process, not a require-cache re-call) is
// still safe. Uses no real production backup or customer-derived data --
// every row below is synthetic and fabricated for this test only.
//
// Both initialization passes run in their own child process
// (backend/scripts/db-init-harness.cjs) so Node's module cache cannot hide
// what "the app starting up against this file a second time" actually does.

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
function get(conn, sql, params = []) {
  return new Promise((resolve, reject) => conn.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); }));
}

// The exact table set/shape as it existed on origin/main before this PR
// (backend/db.js's CREATE TABLE statements, minus supplier_fulfillments and
// minus every column since added by addColumnIfMissing) -- deliberately
// reconstructed narrower than current db.js so the migration has real work
// to do, exactly like a genuine pre-upgrade production database would.
async function createLegacySchema(conn) {
  await run(conn, `
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      imageUrl TEXT,
      stock INTEGER DEFAULT 0,
      type TEXT DEFAULT 'local',
      printifyId TEXT
    )
  `);
  await run(conn, `
    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      printifyVariantId TEXT,
      color TEXT,
      colorHex TEXT,
      size TEXT,
      price REAL,
      cost REAL,
      isEnabled INTEGER DEFAULT 1,
      FOREIGN KEY (productId) REFERENCES products(id)
    )
  `);
  await run(conn, `
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      customerEmail TEXT NOT NULL,
      address TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(conn, `
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      promo_code TEXT NOT NULL UNIQUE,
      is_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(conn, `
    CREATE TABLE abandoned_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      cart_fingerprint TEXT NOT NULL,
      items_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email, cart_fingerprint)
    )
  `);
  await run(conn, `
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER,
      productId INTEGER,
      quantity INTEGER,
      price REAL,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )
  `);
  await run(conn, `
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      customerName TEXT,
      status TEXT DEFAULT 'bot',
      history TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(conn, `
    CREATE TABLE processed_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      eventId TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, eventId)
    )
  `);
  await run(conn, `
    CREATE TABLE design_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printifyProductId TEXT NOT NULL,
      blueprintId INTEGER NOT NULL,
      printProviderId INTEGER NOT NULL,
      productType TEXT NOT NULL DEFAULT 'tee',
      title TEXT,
      priceILS REAL NOT NULL,
      mockupUrl TEXT,
      sourceImageRef TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_approval',
      requestedBy TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      decidedAt DATETIME,
      publishedProductId INTEGER
    )
  `);
  await run(conn, `
    CREATE TABLE product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      design_job_id INTEGER,
      product_variant_id INTEGER,
      view TEXT NOT NULL,
      url TEXT NOT NULL,
      is_custom_mockup INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(design_job_id, view),
      UNIQUE(product_variant_id, view)
    )
  `);
}

async function seedLegacyRows(conn) {
  await run(conn, `INSERT INTO products (id, title, description, price, imageUrl, stock, type, printifyId) VALUES (1, 'Legacy Fixture Tee', 'synthetic legacy row', 149.9, 'https://example.invalid/img.jpg', 5, 'printify', 'legacy-pf-product-1')`);
  await run(conn, `INSERT INTO orders (id, customerName, customerEmail, address, totalAmount, status) VALUES (1, 'Legacy Customer', 'legacy-fixture@example.com', '1 Legacy St, Tel Aviv, IL', 149.9, 'paid')`);
  // Representative existing fulfillment_status/fulfillment_ref values --
  // this column does not exist yet in the hand-built legacy schema above
  // (it was itself added by an earlier addColumnIfMissing migration), so
  // it is added here to stand in for "a database mid-way through the
  // pre-PR migration history", then populated with a legacy-shaped value.
  await run(conn, `ALTER TABLE order_items ADD COLUMN supplier_id TEXT`);
  await run(conn, `ALTER TABLE order_items ADD COLUMN fulfillment_status TEXT DEFAULT 'pending'`);
  await run(conn, `ALTER TABLE order_items ADD COLUMN fulfillment_ref TEXT`);
  await run(conn, `INSERT INTO order_items (id, orderId, productId, quantity, price, supplier_id, fulfillment_status, fulfillment_ref) VALUES (1, 1, 1, 1, 149.9, 'printify', 'submitted', 'PRINTIFY-ORD-1')`);
  await run(conn, `INSERT INTO processed_webhooks (id, provider, eventId) VALUES (1, 'paypal', 'legacy-capture-evt-1')`);
}

async function snapshotAllTables(conn) {
  const tableNames = ['products', 'product_variants', 'orders', 'leads', 'abandoned_carts', 'order_items', 'chat_sessions', 'processed_webhooks', 'design_jobs', 'product_images'];
  const snapshot = {};
  for (const t of tableNames) {
    snapshot[t] = await all(conn, `SELECT * FROM ${t} ORDER BY id`);
  }
  return snapshot;
}

// addColumnIfMissing legitimately adds new columns (populated with their
// declared defaults) to existing rows -- that is the whole point of an
// additive migration, and is pre-existing behavior this PR does not change.
// "Legacy rows unchanged" therefore means every column value that existed
// BEFORE must be identical AFTER, not that the row's column set is frozen.
// A new column appearing with its default value is expected; any existing
// column's value silently changing, or any row being added/removed, is not.
function assertOriginalValuesPreserved(beforeSnapshot, afterSnapshot, label) {
  for (const table of Object.keys(beforeSnapshot)) {
    const beforeRows = beforeSnapshot[table];
    const afterRows = afterSnapshot[table];
    assert.equal(afterRows.length, beforeRows.length, `${label}: row count for ${table} must not change`);
    for (let i = 0; i < beforeRows.length; i += 1) {
      const beforeRow = beforeRows[i];
      const afterRow = afterRows[i];
      assert.equal(afterRow.id, beforeRow.id, `${label}: row order/identity in ${table} must not change`);
      for (const key of Object.keys(beforeRow)) {
        assert.equal(
          afterRow[key],
          beforeRow[key],
          `${label}: ${table}.${key} on row id=${beforeRow.id} changed from ${JSON.stringify(beforeRow[key])} to ${JSON.stringify(afterRow[key])}`
        );
      }
    }
  }
}

function runHarness(dbPath) {
  const result = spawnSync(process.execPath, [HARNESS_PATH], {
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
  return result;
}

test('legacy database upgrade: first initialization creates supplier_fulfillments additively, leaves every legacy row unchanged', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-schema-test-'));
  const dbPath = path.join(tmpDir, 'legacy.db');

  const seedConn = openDb(dbPath);
  await createLegacySchema(seedConn);
  await seedLegacyRows(seedConn);
  const beforeSnapshot = await snapshotAllTables(seedConn);
  await closeDb(seedConn);

  const firstRun = runHarness(dbPath);
  assert.equal(firstRun.status, 0, `harness must exit 0; stderr: ${firstRun.stderr}`);
  assert.match(firstRun.stdout, /DB_INIT_HARNESS_DONE=true/);

  const verifyConn = openDb(dbPath);

  const tableExists = await get(verifyConn, `SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_fulfillments'`);
  assert.ok(tableExists, 'supplier_fulfillments must exist after first initialization');

  const indexExists = await get(verifyConn, `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_supplier_fulfillments_state'`);
  assert.ok(indexExists, 'idx_supplier_fulfillments_state must exist after first initialization');

  const columns = await all(verifyConn, `PRAGMA table_info(supplier_fulfillments)`);
  const columnMap = Object.fromEntries(columns.map((c) => [c.name, c]));
  assert.equal(columnMap.id.pk, 1);
  assert.equal(columnMap.orderId.notnull, 1);
  assert.equal(columnMap.supplierId.notnull, 1);
  assert.equal(columnMap.externalId.notnull, 1);
  assert.equal(columnMap.supplierOrderId.notnull, 0, 'supplierOrderId must be nullable');
  assert.equal(columnMap.state.dflt_value, "'pending'");
  assert.equal(columnMap.attemptCount.dflt_value, '0');
  assert.ok('lastErrorCode' in columnMap);
  assert.ok('createdAt' in columnMap);
  assert.ok('updatedAt' in columnMap);

  // UNIQUE(orderId, supplierId) enforced.
  await run(verifyConn, `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, state) VALUES (1, 'printify', 'joakim-order-1-printify-v1', 'pending')`);
  await assert.rejects(
    () => run(verifyConn, `INSERT INTO supplier_fulfillments (orderId, supplierId, externalId, state) VALUES (1, 'printify', 'a-different-external-id', 'pending')`),
    /UNIQUE constraint failed/
  );

  // Every legacy table/row byte/logically unchanged -- remove the one row
  // this test itself just inserted before comparing, then diff exactly.
  await run(verifyConn, `DELETE FROM supplier_fulfillments WHERE orderId = 1 AND supplierId = 'printify'`);
  const afterSnapshot = await snapshotAllTables(verifyConn);
  assertOriginalValuesPreserved(beforeSnapshot, afterSnapshot, 'first initialization');

  await closeDb(verifyConn);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('legacy database upgrade: a second fresh-process initialization against the same file is a safe no-op', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-schema-repeat-test-'));
  const dbPath = path.join(tmpDir, 'legacy.db');

  const seedConn = openDb(dbPath);
  await createLegacySchema(seedConn);
  await seedLegacyRows(seedConn);
  await closeDb(seedConn);

  const firstRun = runHarness(dbPath);
  assert.equal(firstRun.status, 0, `first harness run must exit 0; stderr: ${firstRun.stderr}`);

  const midConn = openDb(dbPath);
  const beforeSecondRun = await snapshotAllTables2(midConn);
  const tableCountBefore = await get(midConn, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`);
  const indexCountBefore = await get(midConn, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_supplier_fulfillments_state'`);
  await closeDb(midConn);

  const secondRun = runHarness(dbPath);
  assert.equal(secondRun.status, 0, `second harness run must exit 0 (no error) -- stderr: ${secondRun.stderr}`);
  assert.match(secondRun.stdout, /DB_INIT_HARNESS_DONE=true/);

  const finalConn = openDb(dbPath);
  const tableCountAfter = await get(finalConn, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`);
  const indexCountAfter = await get(finalConn, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_supplier_fulfillments_state'`);
  assert.equal(tableCountAfter.n, tableCountBefore.n, 'no table duplicated by a second initialization');
  assert.equal(indexCountAfter.n, indexCountBefore.n, 'index must not be duplicated (exactly one idx_supplier_fulfillments_state)');
  assert.equal(indexCountAfter.n, 1);

  const afterSecondRun = await snapshotAllTables2(finalConn);
  assertOriginalValuesPreserved(beforeSecondRun, afterSecondRun, 'second initialization');

  await closeDb(finalConn);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function snapshotAllTables2(conn) {
  const tableNames = ['products', 'product_variants', 'orders', 'leads', 'abandoned_carts', 'order_items', 'chat_sessions', 'processed_webhooks', 'design_jobs', 'product_images', 'supplier_fulfillments'];
  const snapshot = {};
  for (const t of tableNames) {
    snapshot[t] = await all(conn, `SELECT * FROM ${t} ORDER BY id`);
  }
  return snapshot;
}
