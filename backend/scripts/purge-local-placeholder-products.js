// Explicit, opt-in-only cleanup for legacy type='local' placeholder
// products (the hardcoded, non-fulfillable demo catalog rows that predate
// real Printify/CJ sync). This used to run unconditionally on every
// backend startup (backend/db.js) -- moved here so normal application
// startup, in every environment including production, can never delete a
// catalog row. Never imported or required by db.js/index.js; only runs
// when a human explicitly invokes it with --yes.
//
// Usage: node scripts/purge-local-placeholder-products.js --yes

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'ecommerce.db');

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve({ changes: this.changes }); });
});

(async () => {
  const confirmed = process.argv.includes('--yes');

  console.log('🧹 Explicit cleanup: legacy type=\'local\' placeholder products');
  console.log(`📁 DB file: ${DB_PATH}`);

  if (!confirmed) {
    console.log('\n⚠️  Dry run only (no --yes flag passed). No rows will be deleted.');
  }

  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(DB_PATH, (err) => (err ? reject(err) : resolve(conn)));
  });

  try {
    const targets = await all(db, `SELECT id, title FROM products WHERE type = 'local'`);
    console.log(`\n🔍 Found ${targets.length} product(s) with type='local'.`);
    targets.forEach((p) => console.log(`   - #${p.id} ${p.title}`));

    if (targets.length === 0) {
      console.log('\n✅ Nothing to do.');
      return;
    }

    if (!confirmed) {
      console.log('\nRe-run with --yes to actually delete the rows listed above.');
      console.log('Note: this does NOT cascade to product_variants/product_images/order_items --');
      console.log('review those tables for orphaned references first if any of these products were ever ordered.');
      return;
    }

    const { changes } = await run(db, `DELETE FROM products WHERE type = 'local'`);
    console.log(`\n✅ Deleted ${changes} product(s).`);
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
})().catch((err) => {
  console.error('❌ Cleanup failed:', err.message);
  process.exit(1);
});
