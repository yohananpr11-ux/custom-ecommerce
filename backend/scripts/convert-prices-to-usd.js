const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ILS_TO_USD_RATE = 3.6;
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isExecute = args.includes('--execute');

if ((isDryRun && isExecute) || (!isDryRun && !isExecute)) {
  console.error('Usage: node backend/scripts/convert-prices-to-usd.js --dry-run|--execute');
  process.exit(1);
}

const backendDir = path.resolve(__dirname, '..');
const dbPath = path.join(backendDir, 'ecommerce.db');
const backupsDir = path.join(backendDir, 'backups');
const reportsDir = path.join(backendDir, 'reports');

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundToNinetyNine(value) {
  const numeric = Number(value || 0);
  const base = Math.floor(numeric);
  const fraction = numeric - base;

  // Exception rule requested: when decimal is above .95, always round up to .99.
  if (fraction > 0.95) {
    return round2(Math.ceil(numeric) - 0.01);
  }

  // Default rule: nearest integer, then move to .99 pricing.
  return round2(Math.round(numeric) - 0.01);
}

function fmt(value) {
  return Number(value).toFixed(2);
}

function pad(text, width) {
  const value = String(text);
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

async function ensurePriceUsdColumn(executeMode) {
  const columns = await all('PRAGMA table_info(products)');
  const hasPriceUSD = columns.some((col) => String(col.name).toLowerCase() === 'priceusd');

  if (hasPriceUSD) return true;

  if (!executeMode) {
    console.log('Note: column priceUSD does not exist yet. It will be created in --execute mode.');
    return false;
  }

  await run('ALTER TABLE products ADD COLUMN priceUSD REAL');
  console.log('Added missing column: products.priceUSD');
  return true;
}

async function hasPriceUsdColumn() {
  const columns = await all('PRAGMA table_info(products)');
  return columns.some((col) => String(col.name).toLowerCase() === 'priceusd');
}

function printTable(rows) {
  const headers = ['Product ID', 'Title', 'Current (ILS)', 'New (USD)'];
  const widths = [10, 28, 13, 9];

  console.log(`${pad(headers[0], widths[0])} | ${pad(headers[1], widths[1])} | ${pad(headers[2], widths[2])} | ${pad(headers[3], widths[3])}`);
  console.log(`${'-'.repeat(widths[0])}-|-${'-'.repeat(widths[1])}-|-${'-'.repeat(widths[2])}-|-${'-'.repeat(widths[3])}`);

  rows.forEach((row) => {
    const title = String(row.title || '').replace(/\s+/g, ' ').trim();
    const shortTitle = title.length > widths[1] ? `${title.slice(0, widths[1] - 3)}...` : title;
    console.log(`${pad(row.id, widths[0])} | ${pad(shortTitle, widths[1])} | ${pad(fmt(row.currentILS), widths[2])} | ${pad(fmt(row.newUSD), widths[3])}`);
  });
}

function buildReport(mode, rows, backupPath = null) {
  return {
    timestamp: new Date().toISOString(),
    mode,
    rate: ILS_TO_USD_RATE,
    backupPath,
    totals: {
      productCount: rows.length,
    },
    rows,
  };
}

function writeReport(report) {
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(reportsDir, `price-conversion-${report.mode}-${safeTs}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}

async function main() {
  try {
    await ensurePriceUsdColumn(isExecute);
    const includePriceUsd = await hasPriceUsdColumn();
    const selectSql = includePriceUsd
      ? 'SELECT id, title, price, priceUSD FROM products ORDER BY id'
      : 'SELECT id, title, price FROM products ORDER BY id';
    const products = await all(selectSql);

    if (!products.length) {
      console.log('No products found in products table. Nothing to convert.');
      return;
    }

    const convertedRows = products.map((product) => {
      const currentILS = Number(product.price || 0);
      const rawUSD = currentILS / ILS_TO_USD_RATE;
      const newUSD = roundToNinetyNine(rawUSD);
      return {
        id: product.id,
        title: product.title,
        currentILS,
        rawUSD: round2(rawUSD),
        previousUSD: includePriceUsd ? product.priceUSD : null,
        newUSD,
      };
    });

    printTable(convertedRows);

    if (isDryRun) {
      const reportPath = writeReport(buildReport('dry-run', convertedRows));
      console.log(`\nDry-run completed. No DB changes were made.`);
      console.log(`Report: ${reportPath}`);
      return;
    }

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const backupTs = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDir, `ecommerce-before-usd-conversion-${backupTs}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`Backup created: ${backupPath}`);

    await run('BEGIN TRANSACTION');
    try {
      for (const row of convertedRows) {
        await run('UPDATE products SET priceUSD = ? WHERE id = ?', [row.newUSD, row.id]);
      }
      await run('COMMIT');
    } catch (txError) {
      await run('ROLLBACK');
      throw txError;
    }

    const validationRows = await all('SELECT id, priceUSD FROM products ORDER BY id');
    const mismatches = [];

    for (const row of convertedRows) {
      const persisted = validationRows.find((v) => Number(v.id) === Number(row.id));
      const persistedValue = persisted ? round2(Number(persisted.priceUSD || 0)) : null;
      if (persistedValue === null || persistedValue !== row.newUSD) {
        mismatches.push({ id: row.id, expected: row.newUSD, actual: persistedValue });
      }
    }

    if (mismatches.length) {
      throw new Error(`Validation failed for ${mismatches.length} rows: ${JSON.stringify(mismatches)}`);
    }

    const reportPath = writeReport(buildReport('execute', convertedRows, backupPath));
    console.log('\nExecute completed successfully. DB updated.');
    console.log(`Report: ${reportPath}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`Conversion failed: ${err.message}`);
  process.exit(1);
});
