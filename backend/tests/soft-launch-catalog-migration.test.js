const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const TMP_DB = path.join(__dirname, `test-soft-launch-catalog-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.JONO_ADMIN_SECRET = 'test-admin-secret-catalog';

const db = require('../db');
const { app } = require('../index');

test('Soft Launch Catalog Migration & Visibility Gate', async (t) => {
  let server;
  let baseUrl;

  t.after(() => {
    if (server) server.close();
    try { fs.rmSync(TMP_DB, { force: true }); } catch { /* noop */ }
    try { fs.rmSync(TMP_DB + '-wal', { force: true }); } catch { /* noop */ }
    try { fs.rmSync(TMP_DB + '-shm', { force: true }); } catch { /* noop */ }
  });

  await db.readyPromise;

  // Insert mock test products: 16 (old text), 17-21 (hardware items), 22, 23, 24 (mock text), 99 (clean product)
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
         VALUES (16, 'JONO - Oversized CVC Logo Heather Grey', 'Old mock copy.', 169.9, 'printify', 'printify', 10)`
      );
      for (let hid = 17; hid <= 21; hid++) {
        db.run(
          `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
           VALUES (${hid}, 'Old Hardware Item ${hid}', 'Hardware drop.', 149, 'dropship', 'dropship', 5)`
        );
      }
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
         VALUES (22, 'Premium Street Hoodie v3', 'Old mock copy.', 300, 'printify', 'printify', 8)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
         VALUES (23, 'Premium Street Hoodie v4', 'Old mock copy.', 300, 'printify', 'printify', 8)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
         VALUES (24, 'Premium Street Hoodie v5', 'Old mock copy.', 300, 'printify', 'printify', 8)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, supplier_id, stock)
         VALUES (99, 'JONO Flagship Hoodie', 'Premium heavyweight cotton hoodie.', 349, 'printify', 'printify', 12)`
      );
      resolve();
    });
  });

  // Re-run the migration logic explicitly to simulate upgrade on existing DB
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`UPDATE products SET is_hidden = 1 WHERE id IN (17, 18, 19, 20, 21)`);
      db.run(
        `UPDATE products
         SET description = 'JONO - Oversized CVC Logo Heather Grey — JONO CVC Minimalist Streetwear. Premium Airlume cotton-poly zero-iron blend.'
         WHERE id = 16`
      );
      db.run(
        `UPDATE products
         SET description = 'Premium Street Hoodie v3 — JONO drop. Heavyweight cotton fleece with tailored silhouette.'
         WHERE id = 22`
      );
      db.run(
        `UPDATE products
         SET description = 'Premium Street Hoodie v4 — JONO drop. Heavyweight cotton fleece with tailored silhouette.'
         WHERE id = 23`
      );
      db.run(
        `UPDATE products
         SET description = 'Premium Street Hoodie v5 — JONO drop. Heavyweight cotton fleece with tailored silhouette.'
         WHERE id = 24`,
        resolve
      );
    });
  });

  // 1. Verify DB rows
  const prod16 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 16', (_, r) => resolve(r)));
  assert.ok(prod16.description.includes('JONO CVC Minimalist Streetwear'));
  assert.equal(prod16.is_hidden, 0);

  for (let hid = 17; hid <= 21; hid++) {
    const prodH = await new Promise((resolve) => db.get(`SELECT * FROM products WHERE id = ${hid}`, (_, r) => resolve(r)));
    assert.equal(prodH.is_hidden, 1, `Product ${hid} must be hidden for soft launch`);
  }

  const prod22 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 22', (_, r) => resolve(r)));
  assert.ok(prod22.description.includes('Premium Street Hoodie v3 — JONO drop'));

  const prod23 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 23', (_, r) => resolve(r)));
  assert.ok(prod23.description.includes('Premium Street Hoodie v4 — JONO drop'));

  const prod24 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 24', (_, r) => resolve(r)));
  assert.ok(prod24.description.includes('Premium Street Hoodie v5 — JONO drop'));

  // 2. Start HTTP server to test endpoints
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Test GET /api/products
  const resProducts = await fetch(`${baseUrl}/api/products`);
  const productsList = await resProducts.json();
  const ids = productsList.map((p) => p.id);
  assert.ok(!ids.includes(17), 'Product 17 must NOT appear in /api/products');
  assert.ok(ids.includes(99), 'Product 99 must appear in /api/products');

  // Test GET /api/products/active-ids
  const resActiveIds = await fetch(`${baseUrl}/api/products/active-ids`);
  const activeIdsData = await resActiveIds.json();
  assert.ok(!activeIdsData.ids.includes(17), 'Product 17 must NOT appear in active-ids');

  // Test GET /api/products/:id for hidden product -> 404
  const resHiddenProduct = await fetch(`${baseUrl}/api/products/17`);
  assert.equal(resHiddenProduct.status, 404, 'Hidden product 17 must return 404 on PDP');

  // Test GET /api/products/:id for active product -> 200
  const resActiveProduct = await fetch(`${baseUrl}/api/products/99`);
  assert.equal(resActiveProduct.status, 200, 'Active product 99 must return 200 on PDP');
});
