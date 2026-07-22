// Guarded operator tool for creating/disabling the ONE temporary,
// hidden, manual-fulfillment product used for a single controlled real
// PayPal payment test.
//
// Usage:
//   DB_PATH=/path/to/some.db node scripts/manual-payment-test-product.js status
//   DB_PATH=/path/to/some.db node scripts/manual-payment-test-product.js create [--confirm] [--price=5] [--title="..."] [--token-ttl-hours=48]
//   DB_PATH=/path/to/some.db node scripts/manual-payment-test-product.js disable [--confirm]
//
// Hard safety properties, all enforced below, not just documented:
//   - DB_PATH must be set explicitly -- there is no fallback to
//     backend/ecommerce.db or any other implicit default, so a missing
//     env var can never silently target the wrong database;
//   - `create` and `disable` are dry-run by default -- only --confirm
//     performs any write;
//   - `create` refuses if a supplier_id='manual' product already exists
//     (of any stock/enabled state) -- exactly one test product may exist
//     at a time;
//   - `create` writes exactly one products row and exactly one
//     product_variants row, both inside one transaction;
//   - the raw access token is generated with crypto.randomBytes, never
//     derived from anything guessable, and only its SHA-256 hash is ever
//     written to the database -- the raw token is printed to this
//     process's own stdout exactly once, for the operator to copy, and is
//     never written to any file or passed to any logging call;
//   - `disable` never deletes the products row, and never touches orders
//     or order_items -- it sets stock=0 and expires the access token
//     immediately, which is sufficient to make the product both
//     unpurchasable (checkout's stock check in resolveValidatedOrderItems)
//     and unreachable (the token gate in GET /api/products/:id), while
//     leaving any already-placed order's history fully intact;
//   - `disable` refuses if an order referencing the current manual test
//     product was created within the last 10 minutes and is still
//     'pending_payment' -- a payment may genuinely be in flight;
//   - `status` performs no writes and prints only booleans/counts/the
//     product id -- never the raw token, its hash, or any customer data;
//   - this script never contacts PayPal, Printify, CJ Dropshipping,
//     Telegram, or an email provider.

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve({ changes: this.changes, lastID: this.lastID }); });
});

function resolveDbPath() {
  const raw = process.env.DB_PATH;
  if (!raw) {
    console.error('❌ Refusing to run: DB_PATH must be set explicitly. This script never falls back to a default database path.');
    process.exit(1);
  }
  return path.resolve(raw);
}

function parseFlags(argv) {
  const flags = { confirm: false, price: 5, title: null, tokenTtlHours: 48 };
  for (const arg of argv) {
    if (arg === '--confirm') flags.confirm = true;
    else if (arg.startsWith('--price=')) flags.price = Number(arg.slice('--price='.length));
    else if (arg.startsWith('--title=')) flags.title = arg.slice('--title='.length);
    else if (arg.startsWith('--token-ttl-hours=')) flags.tokenTtlHours = Number(arg.slice('--token-ttl-hours='.length));
  }
  return flags;
}

async function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
  });
}

async function findManualProduct(db) {
  return get(db, `SELECT * FROM products WHERE supplier_id = 'manual' ORDER BY id DESC LIMIT 1`);
}

async function cmdStatus(db) {
  const product = await findManualProduct(db);
  if (!product) {
    console.log(JSON.stringify({ exists: false }, null, 2));
    return;
  }
  const orderCount = (await get(
    db,
    `SELECT COUNT(*) AS n FROM order_items WHERE productId = ?`,
    [product.id]
  ))?.n || 0;
  const paidOrderCount = (await get(
    db,
    `SELECT COUNT(DISTINCT o.id) AS n
     FROM orders o
     JOIN order_items oi ON oi.orderId = o.id
     WHERE oi.productId = ? AND o.status = 'paid'`,
    [product.id]
  ))?.n || 0;
  const tokenExpiresAt = product.access_token_expires_at ? new Date(product.access_token_expires_at) : null;
  console.log(JSON.stringify({
    exists: true,
    productId: product.id,
    type: product.type,
    supplier_id: product.supplier_id,
    stock: product.stock,
    purchasable: Number(product.stock) > 0,
    tokenSet: Boolean(product.access_token_hash),
    tokenExpired: tokenExpiresAt ? tokenExpiresAt.getTime() <= Date.now() : null,
    orderItemsReferencingProduct: orderCount,
    paidOrdersReferencingProduct: paidOrderCount,
  }, null, 2));
}

async function cmdCreate(db, flags) {
  const existing = await findManualProduct(db);
  if (existing) {
    console.error(`❌ Refusing to create: a supplier_id='manual' product already exists (id=${existing.id}, stock=${existing.stock}). Run 'disable' first, or use 'status' to inspect it.`);
    process.exit(1);
  }

  if (!Number.isFinite(flags.price) || flags.price <= 0) {
    console.error(`❌ Refusing to create: --price must be a positive number, got ${flags.price}.`);
    process.exit(1);
  }
  if (!Number.isFinite(flags.tokenTtlHours) || flags.tokenTtlHours <= 0) {
    console.error(`❌ Refusing to create: --token-ttl-hours must be a positive number, got ${flags.tokenTtlHours}.`);
    process.exit(1);
  }

  const title = flags.title || '[INTERNAL TEST] Manual Payment Verification — DO NOT PURCHASE';
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + flags.tokenTtlHours * 60 * 60 * 1000).toISOString();

  console.log('🧪 Manual payment-test product — create');
  console.log(`   title: ${title}`);
  console.log(`   price: ${flags.price} (currency follows normal server-side checkout pricing)`);
  console.log(`   stock: 1`);
  console.log(`   type: local (excluded from /api/products, active-ids, and the Google feed)`);
  console.log(`   supplier_id: manual (zero external calls on fulfillment)`);
  console.log(`   token ttl: ${flags.tokenTtlHours}h`);

  if (!flags.confirm) {
    console.log('\n⚠️  Dry run only (no --confirm flag passed). No rows will be created.');
    return;
  }

  await run(db, 'BEGIN TRANSACTION');
  try {
    const productInsert = await run(
      db,
      `INSERT INTO products (title, description, price, stock, type, supplier_id, access_token_hash, access_token_expires_at)
       VALUES (?, ?, ?, 1, 'local', 'manual', ?, ?)`,
      [title, 'Internal payment-verification fixture. Not a real product. Safe to disable after one test order.', flags.price, tokenHash, expiresAt]
    );
    const productId = productInsert.lastID;

    await run(
      db,
      `INSERT INTO product_variants (productId, color, size, price, isEnabled, isAvailable, stockQty)
       VALUES (?, 'Default', 'OS', ?, 1, 1, 1)`,
      [productId, flags.price]
    );

    await run(db, 'COMMIT');

    console.log(`\n✅ Created product id=${productId}.`);
    console.log(`\n🔑 One-time direct link (copy this now — the raw token is never shown again and is never written to any log):`);
    console.log(`   /product/${productId}?token=${rawToken}`);
    console.log(`\nRun 'disable' after the single real payment test completes.`);
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function cmdDisable(db, flags) {
  const existing = await findManualProduct(db);
  if (!existing) {
    console.log('✅ Nothing to do: no supplier_id=\'manual\' product exists.');
    return;
  }

  const recentPending = await get(
    db,
    `SELECT o.id FROM orders o
     JOIN order_items oi ON oi.orderId = o.id
     WHERE oi.productId = ?
       AND o.status = 'pending_payment'
       AND o.createdAt > datetime('now', '-10 minutes')
     LIMIT 1`,
    [existing.id]
  );
  if (recentPending) {
    console.error(`❌ Refusing to disable: order #${recentPending.id} for this product was created within the last 10 minutes and is still pending_payment — a payment may be actively in flight. Re-run once you are certain no payment is in progress.`);
    process.exit(1);
  }

  console.log(`🧪 Manual payment-test product — disable (id=${existing.id}, current stock=${existing.stock})`);
  if (!flags.confirm) {
    console.log('\n⚠️  Dry run only (no --confirm flag passed). No rows will be changed.');
    return;
  }

  await run(
    db,
    `UPDATE products SET stock = 0, access_token_expires_at = datetime('now', '-1 minute') WHERE id = ? AND supplier_id = 'manual'`,
    [existing.id]
  );
  console.log(`\n✅ Disabled product id=${existing.id}: stock=0, access token expired. The row and any order history referencing it are unchanged.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const dbPath = resolveDbPath();

  if (!['status', 'create', 'disable'].includes(command)) {
    console.error('Usage: node scripts/manual-payment-test-product.js <status|create|disable> [--confirm] [--price=5] [--title="..."] [--token-ttl-hours=48]');
    process.exit(1);
  }

  console.log(`📁 DB file: ${dbPath}`);
  const db = await openDb(dbPath);
  try {
    if (command === 'status') await cmdStatus(db);
    else if (command === 'create') await cmdCreate(db, flags);
    else if (command === 'disable') await cmdDisable(db, flags);
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { parseFlags };
