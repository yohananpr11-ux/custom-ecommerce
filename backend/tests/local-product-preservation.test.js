// Proves backend/db.js's startup migration NEVER deletes catalog rows --
// closing the latent data-loss risk of the old unconditional
// "DELETE FROM products WHERE type = 'local'" that used to run on every
// boot. Uses the same db-init-harness.cjs child-process pattern as
// legacy-schema-migration.test.js so "the app starting up" means a real,
// separate Node process each time, not an in-process re-require.
//
// Uses no real production data anywhere -- every row is synthetic and
// fabricated for this test only.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();

const HARNESS_PATH = path.join(__dirname, '..', 'scripts', 'db-init-harness.cjs');
const PURGE_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'purge-local-placeholder-products.js');

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

function runHarness(dbPath, extraEnv = {}) {
  return spawnSync(process.execPath, [HARNESS_PATH], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      HERMETIC_TEST_MODE: 'true',
      DISABLE_BACKGROUND_JOBS: 'true',
      PRINTIFY_API_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      RESEND_API_KEY: '',
      ENABLE_PRINTIFY_SYNC: 'false',
      NODE_ENV: 'test',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function runPurgeScript(dbPath, args = [], { extraEnv = {}, omitDbPath = false } = {}) {
  const env = { ...process.env, ...extraEnv };
  if (omitDbPath) {
    delete env.DB_PATH;
  } else {
    env.DB_PATH = dbPath;
  }
  return spawnSync(process.execPath, [PURGE_SCRIPT_PATH, ...args], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
}

async function seedMixedCatalog(dbPath) {
  const seedConn = openDb(dbPath);
  await run(
    seedConn,
    `INSERT INTO products (id, title, description, price, imageUrl, stock, type) VALUES (1, 'Local Placeholder Tee', 'legacy demo fixture, never fulfillable', 89.9, 'https://example.invalid/local.jpg', 5, 'local')`
  );
  await run(
    seedConn,
    `INSERT INTO product_variants (id, productId, color, size, price, isEnabled) VALUES (1, 1, 'Black', 'M', 89.9, 1)`
  );
  await run(
    seedConn,
    `INSERT INTO product_images (id, product_variant_id, view, url) VALUES (1, 1, 'front', 'https://example.invalid/local-front.jpg')`
  );
  await run(
    seedConn,
    `INSERT INTO products (id, title, description, price, imageUrl, stock, type, printifyId) VALUES (2, 'Printify Hoodie', 'real supplier product', 159.9, 'https://example.invalid/printify.jpg', 999, 'printify', 'pf-1')`
  );
  await run(
    seedConn,
    `INSERT INTO products (id, title, description, price, imageUrl, stock, type, printifyId) VALUES (3, 'CJ Dropship Necklace', 'real supplier product', 49.9, 'https://example.invalid/cj.jpg', 999, 'dropship', 'cj-1')`
  );
  await closeDb(seedConn);
}

test('a type=local product survives normal db initialization', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-preservation-'));
  const dbPath = path.join(tmpDir, 'test.db');

  const firstRun = runHarness(dbPath);
  assert.equal(firstRun.status, 0, `harness must exit 0; stderr: ${firstRun.stderr}`);

  await seedMixedCatalog(dbPath);

  const secondRun = runHarness(dbPath);
  assert.equal(secondRun.status, 0, `second harness run (normal startup) must exit 0; stderr: ${secondRun.stderr}`);

  const conn = openDb(dbPath);
  const localProduct = await get(conn, `SELECT * FROM products WHERE id = 1`);
  assert.ok(localProduct, 'type=local product must still exist after normal startup');
  assert.equal(localProduct.type, 'local');
  assert.equal(localProduct.title, 'Local Placeholder Tee');
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('variants and images belonging to a type=local product survive normal db initialization', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-preservation-'));
  const dbPath = path.join(tmpDir, 'test.db');

  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);
  assert.equal(runHarness(dbPath).status, 0);

  const conn = openDb(dbPath);
  const variant = await get(conn, `SELECT * FROM product_variants WHERE id = 1`);
  assert.ok(variant, 'variant belonging to the local product must survive');
  assert.equal(variant.productId, 1);

  const image = await get(conn, `SELECT * FROM product_images WHERE id = 1`);
  assert.ok(image, 'image belonging to the local product\'s variant must survive');
  assert.equal(image.product_variant_id, 1);
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('running initialization twice (two real separate startups) still preserves the local product', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-preservation-'));
  const dbPath = path.join(tmpDir, 'test.db');

  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  // Two further genuinely separate startups (fresh child process each time).
  assert.equal(runHarness(dbPath).status, 0);
  assert.equal(runHarness(dbPath).status, 0);

  const conn = openDb(dbPath);
  const rows = await all(conn, `SELECT id, type FROM products ORDER BY id`);
  assert.deepEqual(rows, [
    { id: 1, type: 'local' },
    { id: 2, type: 'printify' },
    { id: 3, type: 'dropship' },
  ], 'all three products, across all three types, must survive two additional real startups unchanged');
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('production mode (NODE_ENV=production) cannot execute any local-product cleanup', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-preservation-prod-'));
  const dbPath = path.join(tmpDir, 'test.db');

  assert.equal(runHarness(dbPath, { NODE_ENV: 'production' }).status, 0);
  await seedMixedCatalog(dbPath);

  const prodRun = runHarness(dbPath, { NODE_ENV: 'production' });
  assert.equal(prodRun.status, 0, `production-mode startup must exit 0; stderr: ${prodRun.stderr}`);
  assert.doesNotMatch(prodRun.stdout, /[Pp]urge/, 'production startup output must never mention purging');

  const conn = openDb(dbPath);
  const localProduct = await get(conn, `SELECT * FROM products WHERE id = 1`);
  assert.ok(localProduct, 'type=local product must survive a production-mode startup');
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('explicit dev-only purge script is a no-op without --yes, and deletes only type=local rows with --yes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-purge-script-'));
  const dbPath = path.join(tmpDir, 'test.db');

  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  const dryRun = runPurgeScript(dbPath, []);
  assert.equal(dryRun.status, 0, `dry run must exit 0; stderr: ${dryRun.stderr}`);
  assert.match(dryRun.stdout, /Dry run only/);

  const afterDryRunConn = openDb(dbPath);
  const stillThere = await get(afterDryRunConn, `SELECT * FROM products WHERE id = 1`);
  assert.ok(stillThere, 'local product must survive a dry run (no --yes)');
  await closeDb(afterDryRunConn);

  const realRun = runPurgeScript(dbPath, ['--yes']);
  assert.equal(realRun.status, 0, `--yes run must exit 0; stderr: ${realRun.stderr}`);
  assert.match(realRun.stdout, /Deleted 1 product/);
  assert.doesNotMatch(realRun.stdout, /Local Placeholder Tee/, 'purge script must report only aggregate counts, never row titles');

  const afterConn = openDb(dbPath);
  const deleted = await get(afterConn, `SELECT * FROM products WHERE id = 1`);
  assert.equal(deleted, undefined, 'local product must be gone after explicit --yes invocation');

  const deletedVariant = await get(afterConn, `SELECT * FROM product_variants WHERE id = 1`);
  const deletedImage = await get(afterConn, `SELECT * FROM product_images WHERE id = 1`);
  assert.equal(deletedVariant, undefined, 'the local product\'s variant must be deleted too, not left orphaned');
  assert.equal(deletedImage, undefined, 'the local product\'s image must be deleted too, not left orphaned');

  const printifyStillThere = await get(afterConn, `SELECT * FROM products WHERE id = 2`);
  const dropshipStillThere = await get(afterConn, `SELECT * FROM products WHERE id = 3`);
  assert.ok(printifyStillThere, 'printify product must be untouched by the explicit purge script');
  assert.ok(dropshipStillThere, 'dropship (CJ) product must be untouched by the explicit purge script');
  await closeDb(afterConn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('purge script does absolutely nothing when merely require()-d, not executed directly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-purge-require-'));
  const dbPath = path.join(tmpDir, 'test.db');
  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  const proof = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(PURGE_SCRIPT_PATH)}); console.log('REQUIRE_COMPLETED_NO_THROW');`],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', timeout: 10000 }
  );
  assert.equal(proof.status, 0, `require() alone must not throw or exit non-zero; stderr: ${proof.stderr}`);
  assert.match(proof.stdout, /REQUIRE_COMPLETED_NO_THROW/);
  assert.doesNotMatch(proof.stdout, /Explicit cleanup/, 'require() alone must never print the script\'s own startup banner -- it must not run at all');

  const conn = openDb(dbPath);
  const stillThere = await get(conn, `SELECT * FROM products WHERE id = 1`);
  assert.ok(stillThere, 'local product must be untouched -- require() must never connect to or query the database');
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('purge script refuses to run when NODE_ENV=production, even with --yes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-purge-prod-refusal-'));
  const dbPath = path.join(tmpDir, 'test.db');
  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  const result = runPurgeScript(dbPath, ['--yes'], { extraEnv: { NODE_ENV: 'production' } });
  assert.notEqual(result.status, 0, 'must exit non-zero when NODE_ENV=production');
  assert.match(result.stderr, /Refusing to run.*NODE_ENV=production/);

  const conn = openDb(dbPath);
  const stillThere = await get(conn, `SELECT * FROM products WHERE id = 1`);
  assert.ok(stillThere, 'local product must survive a refused NODE_ENV=production invocation');
  await closeDb(conn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('purge script refuses to run against any DB_PATH under /var/data, even with --yes', async () => {
  const varDataPaths = ['/var/data/ecommerce.db', '/var/data/some/other/nested.db'];
  for (const target of varDataPaths) {
    const result = runPurgeScript(target, ['--yes']);
    assert.notEqual(result.status, 0, `must exit non-zero for DB_PATH=${target}`);
    assert.match(result.stderr, /Refusing to run.*\/var\/data/, `refusal message must cite /var/data for ${target}`);
  }
});

test('purge script refuses to run when DB_PATH is not set, never falling back to an implicit default database', async () => {
  const result = runPurgeScript(undefined, ['--yes'], { omitDbPath: true });
  assert.notEqual(result.status, 0, 'must exit non-zero when DB_PATH is unset');
  assert.match(result.stderr, /Refusing to run.*DB_PATH must be set explicitly/);
  // Must never have attempted to open any database at all -- no DB-related
  // output of any kind, success or failure, beyond the refusal itself.
  assert.doesNotMatch(result.stdout, /Explicit cleanup|Found \d+ product/);
});

test('purge script rolls back the entire transaction if any statement in it fails, leaving no partial deletion', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-purge-rollback-'));
  const dbPath = path.join(tmpDir, 'test.db');
  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  // Forces the final DELETE FROM products statement to fail AFTER the
  // variant/image deletes earlier in the same transaction have already
  // run -- a real, deterministic way to prove the whole transaction rolls
  // back together, not just the statement that happened to fail.
  const conn = openDb(dbPath);
  await run(conn, `
    CREATE TRIGGER block_local_product_delete BEFORE DELETE ON products
    WHEN OLD.type = 'local'
    BEGIN
      SELECT RAISE(ABORT, 'simulated failure for rollback test');
    END
  `);
  await closeDb(conn);

  const result = runPurgeScript(dbPath, ['--yes']);
  assert.notEqual(result.status, 0, 'script must exit non-zero when the transaction fails');
  assert.match(result.stderr, /Cleanup failed/);

  const afterConn = openDb(dbPath);
  const product = await get(afterConn, `SELECT * FROM products WHERE id = 1`);
  const variant = await get(afterConn, `SELECT * FROM product_variants WHERE id = 1`);
  const image = await get(afterConn, `SELECT * FROM product_images WHERE id = 1`);
  assert.ok(product, 'product must still exist after a rolled-back transaction');
  assert.ok(variant, 'variant must still exist after rollback -- must not be left deleted while the product survives');
  assert.ok(image, 'image must still exist after rollback -- must not be left deleted while the product survives');
  await closeDb(afterConn);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('existing Printify and CJ products remain byte-unchanged across normal startup', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-product-preservation-supplier-'));
  const dbPath = path.join(tmpDir, 'test.db');

  assert.equal(runHarness(dbPath).status, 0);
  await seedMixedCatalog(dbPath);

  const beforeConn = openDb(dbPath);
  const before = await all(beforeConn, `SELECT * FROM products WHERE type IN ('printify', 'dropship') ORDER BY id`);
  await closeDb(beforeConn);

  assert.equal(runHarness(dbPath).status, 0);

  const afterConn = openDb(dbPath);
  const after = await all(afterConn, `SELECT * FROM products WHERE type IN ('printify', 'dropship') ORDER BY id`);
  await closeDb(afterConn);

  assert.deepEqual(after, before, 'Printify/CJ product rows must be byte-identical after a normal startup');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});
