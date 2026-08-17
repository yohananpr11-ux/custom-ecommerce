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
process.env.DRIP_ADMIN_SECRET = 'test-admin-secret-catalog';

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

  // Insert mock test products: 16 (old text), 17 (hardware item), 22 (mock text), 99 (clean product)
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, stock)
         VALUES (16, 'Cuban Link Chain', 'Outdated mock copy.', 299, 'dropship', 10)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, stock)
         VALUES (17, 'Old Legacy Hardware', 'Hardware drop.', 149, 'dropship', 5)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, stock)
         VALUES (22, 'Vintage Hoodie', 'Outdated mock copy.', 199, 'dropship', 8)`
      );
      db.run(
        `INSERT OR REPLACE INTO products (id, title, description, price, type, stock)
         VALUES (99, 'JONO Flagship Hoodie', 'Premium heavyweight cotton hoodie.', 349, 'printify', 12)`
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
         SET description = 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the JONO jewelry line.'
         WHERE id = 16`
      );
      db.run(
        `UPDATE products
         SET description = 'JONO Premium Street Hoodie Drop. Heavyweight cotton fleece with tailored silhouette.'
         WHERE id = 22`,
        resolve
      );
    });
  });

  // 1. Verify DB rows
  const prod16 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 16', (_, r) => resolve(r)));
  assert.ok(prod16.description.includes('flagship staple of the JONO jewelry line'));
  assert.equal(prod16.is_hidden, 0);

  const prod17 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 17', (_, r) => resolve(r)));
  assert.equal(prod17.is_hidden, 1, 'Product 17 must be hidden for soft launch');

  const prod22 = await new Promise((resolve) => db.get('SELECT * FROM products WHERE id = 22', (_, r) => resolve(r)));
  assert.ok(prod22.description.includes('JONO Premium Street Hoodie Drop'));

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
