const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'ecommerce.db');

const REQUIRED_COLUMNS = [
  { name: 'variantId',     ddl: 'ALTER TABLE order_items ADD COLUMN variantId INTEGER' },
  { name: 'selectedColor', ddl: 'ALTER TABLE order_items ADD COLUMN selectedColor TEXT' },
  { name: 'selectedSize',  ddl: 'ALTER TABLE order_items ADD COLUMN selectedSize TEXT' },
];

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve({ changes: this.changes }); });
});

(async () => {
  console.log(`📦 Migration: order_items schema sync`);
  console.log(`📁 DB file:   ${DB_PATH}`);

  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(DB_PATH, (err) => (err ? reject(err) : resolve(conn)));
  });

  try {
    const before = await all(db, `PRAGMA table_info(order_items)`);
    if (!before.length) {
      throw new Error('Table "order_items" does not exist. Run the server once to let db.js create the base schema.');
    }
    const existingCols = new Set(before.map((c) => c.name));
    console.log(`\n🔍 Existing columns: ${[...existingCols].join(', ')}`);

    let added = 0;
    let skipped = 0;
    for (const col of REQUIRED_COLUMNS) {
      if (existingCols.has(col.name)) {
        console.log(`   ↪ ${col.name.padEnd(14)} already present, skipping.`);
        skipped += 1;
        continue;
      }
      try {
        await run(db, col.ddl);
        console.log(`   ✅ ${col.name.padEnd(14)} added.`);
        added += 1;
      } catch (err) {
        if (/duplicate column name/i.test(err.message)) {
          console.log(`   ↪ ${col.name.padEnd(14)} already present (race), skipping.`);
          skipped += 1;
        } else {
          throw err;
        }
      }
    }

    const after = await all(db, `PRAGMA table_info(order_items)`);
    console.log(`\n📊 Final columns: ${after.map((c) => c.name).join(', ')}`);
    console.log(`\n✅ Migration complete: ${added} added, ${skipped} already present.`);
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
})().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
