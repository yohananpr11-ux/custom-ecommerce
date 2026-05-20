const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const REMOTE_API_BASE = process.env.REMOTE_RESTORE_API_BASE || 'https://custom-ecommerce-qp30.onrender.com';
const backendDir = path.resolve(__dirname, '..');
const dbPath = path.join(backendDir, 'ecommerce.db');
const backupsDir = path.join(backendDir, 'backups');
const reportsDir = path.join(backendDir, 'reports');
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isExecute = args.includes('--execute');

if ((isDryRun && isExecute) || (!isDryRun && !isExecute)) {
  console.error('Usage: node backend/scripts/restore-products-from-remote.js --dry-run|--execute');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function closeDb() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function ensureColumns() {
  const productCols = await all('PRAGMA table_info(products)');
  const variantCols = await all('PRAGMA table_info(product_variants)');

  if (!productCols.some((col) => col.name === 'priceUSD')) {
    await run('ALTER TABLE products ADD COLUMN priceUSD REAL');
  }

  if (!variantCols.some((col) => col.name === 'priceUSD')) {
    await run('ALTER TABLE product_variants ADD COLUMN priceUSD REAL');
  }
}

async function fetchRemoteCatalog() {
  const listResponse = await axios.get(`${REMOTE_API_BASE}/api/products`, { timeout: 30000 });
  const products = Array.isArray(listResponse.data) ? listResponse.data : [];
  const details = [];

  for (const product of products) {
    const detailResponse = await axios.get(`${REMOTE_API_BASE}/api/products/${product.id}`, { timeout: 30000 });
    details.push(detailResponse.data);
  }

  return details;
}

function summarize(products) {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    price: product.price,
    priceUSD: product.priceUSD,
    variants: Array.isArray(product.variants) ? product.variants.length : 0,
  }));
}

function writeReport(mode, products, backupPath = null) {
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(reportsDir, `remote-restore-${mode}-${safeTs}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    timestamp: new Date().toISOString(),
    mode,
    remoteApiBase: REMOTE_API_BASE,
    backupPath,
    productCount: products.length,
    products: summarize(products),
  }, null, 2), 'utf8');
  return filePath;
}

async function replaceCatalog(products) {
  await run('BEGIN TRANSACTION');
  try {
    await run('DELETE FROM product_variants');
    await run('DELETE FROM products');

    for (const product of products) {
      await run(
        `INSERT INTO products (id, title, description, price, priceUSD, imageUrl, backImageUrl, images, stock, type, printifyId, fabric, careInstructions, deliveryInfo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id,
          product.title,
          product.description || '',
          Number(product.price || 0),
          Number(product.priceUSD || 0),
          product.imageUrl || null,
          product.backImageUrl || null,
          JSON.stringify({
            allImages: Array.isArray(product.images) ? product.images : [],
            variantImageMap: Array.isArray(product.images)
              ? product.images.reduce((acc, image) => {
                  if (!image || !image.variantId) return acc;
                  if (!acc[image.variantId]) acc[image.variantId] = [];
                  acc[image.variantId].push(image);
                  return acc;
                }, {})
              : {},
          }),
          Number(product.stock || 0),
          product.type || 'printify',
          product.printifyId || null,
          product.fabric || null,
          product.careInstructions || null,
          product.deliveryInfo || null,
        ]
      );

      const variants = Array.isArray(product.variants) ? product.variants : [];
      for (const variant of variants) {
        await run(
          `INSERT INTO product_variants (id, productId, printifyVariantId, color, colorHex, size, price, priceUSD, cost, stockQty, isEnabled, isAvailable, imageUrl)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            variant.id,
            product.id,
            variant.printifyVariantId || null,
            variant.color || null,
            variant.colorHex || null,
            variant.size || null,
            Number(variant.price || 0),
            Number(variant.priceUSD || 0),
            Number(variant.cost || 0),
            Number.isFinite(Number(variant.stockQty)) ? Number(variant.stockQty) : null,
            Number(variant.isEnabled) || 0,
            Number(variant.isAvailable) || 0,
            variant.imageUrl || null,
          ]
        );
      }
    }

    await run("DELETE FROM sqlite_sequence WHERE name IN ('products', 'product_variants')");
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function main() {
  try {
    await ensureColumns();
    const products = await fetchRemoteCatalog();

    console.log(`REMOTE_PRODUCT_COUNT=${products.length}`);
    console.log(JSON.stringify(summarize(products), null, 2));

    if (isDryRun) {
      const reportPath = writeReport('dry-run', products);
      console.log(`Dry-run completed. No DB changes were made.`);
      console.log(`Report: ${reportPath}`);
      return;
    }

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const backupTs = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDir, `ecommerce-before-remote-restore-${backupTs}.db`);
    fs.copyFileSync(dbPath, backupPath);

    await replaceCatalog(products);

    const countRow = await all('SELECT COUNT(*) as count FROM products');
    if (!countRow[0] || Number(countRow[0].count) !== products.length) {
      throw new Error(`Restore validation failed. Expected ${products.length} products, found ${countRow[0] ? countRow[0].count : 'unknown'}.`);
    }

    const reportPath = writeReport('execute', products, backupPath);
    console.log(`Restore completed successfully.`);
    console.log(`Backup: ${backupPath}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});
