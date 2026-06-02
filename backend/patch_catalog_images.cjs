// One-shot targeted patch for catalog image alignment.
// Run via:  node backend/patch_catalog_images.cjs
//
// Updates ONLY imageUrl (and Product 18 SPU). Uses simple UPDATE statements.
// Does NOT touch prices, descriptions, or any product outside the listed IDs.

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, 'ecommerce.db');

const PATCHES = [
  {
    id: 16,
    imageUrl: 'https://cf.cjdropshipping.com/f737cb87-9e26-4215-af24-032cb5bb980e.jpg',
  },
  {
    id: 17,
    imageUrl: 'https://cf.cjdropshipping.com/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg',
  },
  {
    id: 18,
    imageUrl: 'https://cf.cjdropshipping.com/quick/product/88af505d-2f06-4dc1-a84b-6cc0530a5c89.jpg',
    spu: 'CJLX2853160',
  },
  {
    id: 21,
    imageUrl: 'https://cf.cjdropshipping.com/f737cb87-9e26-4215-af24-032cb5bb980e.jpg',
  },
];

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Could not open DB:', err.message);
    process.exit(1);
  }
});

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function runCb(err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

(async () => {
  try {
    for (const patch of PATCHES) {
      const productChanges = await run(
        'UPDATE products SET imageUrl = ? WHERE id = ?',
        [patch.imageUrl, patch.id]
      );
      const variantChanges = await run(
        'UPDATE product_variants SET imageUrl = ? WHERE productId = ?',
        [patch.imageUrl, patch.id]
      );
      console.log(
        `[patch] id=${patch.id} imageUrl updated (products: ${productChanges} row, variants: ${variantChanges} rows)`
      );

      if (patch.spu) {
        const productSpuChanges = await run(
          'UPDATE products SET printifyId = ? WHERE id = ?',
          [patch.spu, patch.id]
        );
        const variantSpuChanges = await run(
          'UPDATE product_variants SET printifyVariantId = ? WHERE productId = ?',
          [patch.spu, patch.id]
        );
        console.log(
          `[patch] id=${patch.id} SPU updated to ${patch.spu} (products: ${productSpuChanges} row, variants: ${variantSpuChanges} rows)`
        );
      }
    }

    const rows = await all(
      'SELECT id, title, price, imageUrl, printifyId FROM products WHERE id BETWEEN 16 AND 21 ORDER BY id'
    );
    console.log('\n=== Catalog after patch ===');
    console.table(rows);

    const variants = await all(
      'SELECT productId, printifyVariantId, price, imageUrl FROM product_variants WHERE productId BETWEEN 16 AND 21 ORDER BY productId'
    );
    console.log('\n=== Variants after patch ===');
    console.table(variants);

    db.close();
    process.exit(0);
  } catch (err) {
    console.error('[patch] FAILED:', err.message);
    db.close();
    process.exit(1);
  }
})();
