// Explicit, opt-in-only cleanup for legacy type='local' placeholder
// products (the hardcoded, non-fulfillable demo catalog rows that predate
// real Printify/CJ sync). This used to run unconditionally on every
// backend startup (backend/db.js) -- moved here so normal application
// startup, in every environment including production, can never delete a
// catalog row.
//
// Usage: DB_PATH=/path/to/some.db node scripts/purge-local-placeholder-products.js --yes
//
// Hard safety properties, all enforced below, not just documented:
//   - the entire body only runs when this file is executed directly
//     (require.main === module) -- merely require()'ing it from anywhere
//     (a test, a future refactor, an editor auto-import) does nothing;
//   - DB_PATH must be set explicitly -- there is no fallback to
//     backend/ecommerce.db or any other implicit default, so a missing
//     env var can never silently target a real database;
//   - refuses unconditionally if NODE_ENV=production, regardless of
//     --yes;
//   - refuses unconditionally if DB_PATH resolves anywhere under
//     /var/data (Render's persistent-disk mount path for this service's
//     real production database), regardless of --yes;
//   - dry-run by default -- only --yes performs any write;
//   - the destructive path runs inside one explicit transaction and
//     rolls back on any error, so a failure partway through can never
//     leave products deleted but their variants/images orphaned (or
//     vice versa);
//   - deletes the variants/images belonging ONLY to the specific
//     type='local' rows being removed (never a blanket
//     products/variants join), so no orphaned product_variants or
//     product_images rows are left behind for the rows this script
//     actually touches;
//   - reports only aggregate counts, never row titles/content.

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve({ changes: this.changes }); });
});

function resolveAndValidateDbPath() {
  const raw = process.env.DB_PATH;
  if (!raw) {
    console.error('❌ Refusing to run: DB_PATH must be set explicitly. This script never falls back to a default database path.');
    process.exit(1);
  }

  const resolved = path.resolve(raw);
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/var/data')) {
    console.error(`❌ Refusing to run: DB_PATH resolves under /var/data (${resolved}) -- this is the production persistent-disk mount path and is always refused, regardless of flags.`);
    process.exit(1);
  }

  return resolved;
}

async function main() {
  const argv = process.argv.slice(2);
  const confirmed = argv.includes('--yes');

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run: NODE_ENV=production. This script is never safe to run against a production environment, regardless of flags.');
    process.exit(1);
  }

  const dbPath = resolveAndValidateDbPath();

  console.log('🧹 Explicit cleanup: legacy type=\'local\' placeholder products');
  console.log(`📁 DB file: ${dbPath}`);
  if (!confirmed) {
    console.log('\n⚠️  Dry run only (no --yes flag passed). No rows will be deleted.');
  }

  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
  });

  try {
    const targetIds = (await all(db, `SELECT id FROM products WHERE type = 'local'`)).map((r) => r.id);
    const productCount = targetIds.length;
    console.log(`\n🔍 Found ${productCount} product(s) with type='local'.`);

    if (productCount === 0) {
      console.log('\n✅ Nothing to do.');
      return;
    }

    const placeholders = targetIds.map(() => '?').join(',');
    const variantRows = await all(db, `SELECT id FROM product_variants WHERE productId IN (${placeholders})`, targetIds);
    const variantIds = variantRows.map((r) => r.id);
    const variantCount = variantIds.length;

    let imageCount = 0;
    if (variantIds.length > 0) {
      const variantPlaceholders = variantIds.map(() => '?').join(',');
      const imageRows = await all(db, `SELECT id FROM product_images WHERE product_variant_id IN (${variantPlaceholders})`, variantIds);
      imageCount = imageRows.length;
    }

    console.log(`🔍 That includes ${variantCount} variant row(s) and ${imageCount} image row(s) that would also be removed (never a blanket delete -- only rows belonging to the targeted products).`);

    if (!confirmed) {
      console.log('\nRe-run with --yes to actually delete the counts listed above (one transaction, rolled back on any error).');
      return;
    }

    await run(db, 'BEGIN TRANSACTION');
    try {
      let deletedImages = 0;
      if (variantIds.length > 0) {
        const variantPlaceholders = variantIds.map(() => '?').join(',');
        deletedImages = (await run(db, `DELETE FROM product_images WHERE product_variant_id IN (${variantPlaceholders})`, variantIds)).changes;
      }
      const deletedVariants = (await run(db, `DELETE FROM product_variants WHERE productId IN (${placeholders})`, targetIds)).changes;
      const deletedProducts = (await run(db, `DELETE FROM products WHERE type = 'local'`)).changes;
      await run(db, 'COMMIT');
      console.log(`\n✅ Deleted ${deletedProducts} product(s), ${deletedVariants} variant(s), ${deletedImages} image(s).`);
    } catch (err) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Cleanup failed:', err.message);
    process.exit(1);
  });
}
