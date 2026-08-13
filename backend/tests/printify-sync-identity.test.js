const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const syncHelpers = require('../services/printify-sync-helpers');
const assert = require('node:assert/strict');

// Create a temporary test database
const testDbPath = path.resolve(__dirname, 'test-ecommerce.db');
let db;

async function setupTestDb() {
  // Remove existing test DB if present
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  db = new sqlite3.Database(testDbPath);

  // Create schema
  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      imageUrl TEXT,
      backImageUrl TEXT,
      images TEXT,
      stock INTEGER DEFAULT 0,
      type TEXT DEFAULT 'local',
      printifyId TEXT,
      fabric TEXT,
      careInstructions TEXT,
      deliveryInfo TEXT
    )`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      printifyVariantId TEXT,
      color TEXT,
      colorHex TEXT,
      size TEXT,
      price REAL,
      cost REAL,
      stockQty INTEGER,
      isEnabled INTEGER DEFAULT 1,
      isAvailable INTEGER DEFAULT 1,
      imageUrl TEXT
    )`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER,
      productId INTEGER,
      variantId INTEGER,
      quantity INTEGER
    )`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function cleanupTestDb() {
  await new Promise((resolve) => db.close(resolve));
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}

// TESTS
async function runTests() {
  console.log('=== RUNNING PRINTIFY SYNC IDENTITY TESTS ===\n');

  // TEST 1 — product rename
  console.log('TEST 1 — product rename:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Old title', 'printify', 'P1', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const productId1 = await syncHelpers.matchAndUpsertProduct(db, 'P1', {
    title: 'New title',
    price: 100,
    imageUrl: 'http://img.jpg',
    backImageUrl: '',
    images: '{}',
    description: 'desc',
    fabric: '',
    careInstructions: '',
    deliveryInfo: ''
  });
  const products1 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(products1.length, 1, 'Should have exactly 1 product');
  assert.equal(products1[0].id, productId1, 'Product ID should be preserved');
  assert.equal(products1[0].title, 'New title', 'Product title should be updated');
  assert.equal(products1[0].printifyId, 'P1', 'Product printifyId should be preserved');
  console.log('  ✅ PASS - Product renamed, ID preserved, no duplicate');
  await cleanupTestDb();

  // TEST 2 — legacy backfill
  console.log('\nTEST 2 — legacy backfill:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Same title', 'printify', null, 100, 'http://img.jpg', 'desc'], resolve);
  });
  const productId2 = await syncHelpers.matchAndUpsertProduct(db, 'P2', {
    title: 'Same title',
    price: 100,
    imageUrl: 'http://img.jpg',
    backImageUrl: '',
    images: '{}',
    description: 'desc',
    fabric: '',
    careInstructions: '',
    deliveryInfo: ''
  });
  const products2 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(products2.length, 1, 'Should have exactly 1 product');
  assert.equal(products2[0].id, productId2, 'Product ID should be preserved');
  assert.equal(products2[0].printifyId, 'P2', 'Product printifyId should be backfilled');
  console.log('  ✅ PASS - Legacy row backfilled with printifyId, no INSERT');
  await cleanupTestDb();

  // TEST 3 — new product
  console.log('\nTEST 3 — new product:');
  await setupTestDb();
  const productId3 = await syncHelpers.matchAndUpsertProduct(db, 'P3', {
    title: 'New Product',
    price: 100,
    imageUrl: 'http://img.jpg',
    backImageUrl: '',
    images: '{}',
    description: 'desc',
    fabric: '',
    careInstructions: '',
    deliveryInfo: ''
  });
  const products3 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(products3.length, 1, 'Should have exactly 1 product');
  assert.equal(products3[0].printifyId, 'P3', 'Product printifyId should be set');
  assert.equal(products3[0].title, 'New Product', 'Product title should be set');
  console.log('  ✅ PASS - New product inserted with printifyId');
  await cleanupTestDb();

  // TEST 4 — existing variant
  console.log('\nTEST 4 — existing variant:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product X', 'printify', 'PX', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId4 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PX'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId4, 'V1', 'Black', '#000000', 'M', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  const incomingSet4 = new Set(['V1']);
  const variantId4 = await syncHelpers.reconcileVariant(db, prodId4, 'V1', {
    color: 'Black',
    colorHex: '#000000',
    size: 'M',
    price: 110,
    cost: 55,
    stockQty: 15,
    isAvailable: 1,
    imageUrl: 'http://var2.jpg'
  });
  const variants4 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId, price FROM product_variants WHERE productId = ?`, [prodId4], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(variants4.length, 1, 'Should have exactly 1 variant');
  assert.equal(variants4[0].id, variantId4, 'Variant ID should be preserved');
  assert.equal(variants4[0].price, 110, 'Variant price should be updated');
  console.log('  ✅ PASS - Existing variant updated, ID preserved');
  await cleanupTestDb();

  // TEST 5 — new variant
  console.log('\nTEST 5 — new variant:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product Y', 'printify', 'PY', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId5 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PY'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  const incomingSet5 = new Set(['V2']);
  const variantId5 = await syncHelpers.reconcileVariant(db, prodId5, 'V2', {
    color: 'White',
    colorHex: '#FFFFFF',
    size: 'L',
    price: 100,
    cost: 50,
    stockQty: 10,
    isAvailable: 1,
    imageUrl: 'http://var.jpg'
  });
  const variants5 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId FROM product_variants WHERE productId = ?`, [prodId5], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(variants5.length, 1, 'Should have exactly 1 variant');
  assert.equal(variants5[0].printifyVariantId, 'V2', 'Variant printifyVariantId should be set');
  console.log('  ✅ PASS - New variant inserted');
  await cleanupTestDb();

  // TEST 6 — removed/stale variant
  console.log('\nTEST 6 — removed/stale variant:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product Z', 'printify', 'PZ', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId6 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PZ'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId6, 'V3', 'Red', '#FF0000', 'S', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  const incomingSet6 = new Set(['V4']); // V3 not in incoming
  await syncHelpers.disableStaleVariants(db, prodId6, incomingSet6);
  const variants6 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId, isEnabled, isAvailable FROM product_variants WHERE productId = ?`, [prodId6], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(variants6.length, 1, 'Should have exactly 1 variant');
  assert.equal(variants6[0].printifyVariantId, 'V3', 'Variant printifyVariantId should be preserved');
  assert.equal(variants6[0].isEnabled, 0, 'Variant should be disabled');
  assert.equal(variants6[0].isAvailable, 0, 'Variant should be unavailable');
  console.log('  ✅ PASS - Stale variant disabled, not deleted, ID preserved');
  await cleanupTestDb();

  // TEST 7 — historical reference preservation
  console.log('\nTEST 7 — historical reference preservation:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product H', 'printify', 'PH', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId7 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PH'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId7, 'V5', 'Blue', '#0000FF', 'XL', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  const varId7 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM product_variants WHERE printifyVariantId = ?`, ['V5'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO order_items (orderId, productId, variantId, quantity) VALUES (?, ?, ?, ?)`,
      [1, prodId7, varId7, 2], resolve);
  });
  const incomingSet7 = new Set(['V5']);
  await syncHelpers.reconcileVariant(db, prodId7, 'V5', {
    color: 'Blue',
    colorHex: '#0000FF',
    size: 'XL',
    price: 110,
    cost: 55,
    stockQty: 15,
    isAvailable: 1,
    imageUrl: 'http://var2.jpg'
  });
  const orderItems7 = await new Promise((resolve, reject) => {
    db.all(`SELECT variantId FROM order_items`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const variants7 = await new Promise((resolve, reject) => {
    db.all(`SELECT id FROM product_variants WHERE id = ?`, [varId7], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(orderItems7.length, 1, 'Should have exactly 1 order item');
  assert.equal(orderItems7[0].variantId, varId7, 'Order item variantId should be preserved');
  assert.equal(variants7.length, 1, 'Variant should still exist');
  console.log('  ✅ PASS - Historical order reference preserved, variant ID unchanged');
  await cleanupTestDb();

  // TEST 8 — duplicate product printifyId
  console.log('\nTEST 8 — duplicate product printifyId:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product A', 'printify', 'PDUP', 100, 'http://img.jpg', 'desc'], resolve);
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product B', 'printify', 'PDUP', 100, 'http://img.jpg', 'desc'], resolve);
  });
  await assert.rejects(
    syncHelpers.matchAndUpsertProduct(db, 'PDUP', {
      title: 'Product C',
      price: 100,
      imageUrl: 'http://img.jpg',
      backImageUrl: '',
      images: '{}',
      description: 'desc',
      fabric: '',
      careInstructions: '',
      deliveryInfo: ''
    }),
    /Duplicate printifyId/
  );
  console.log('  ✅ PASS - Sync aborted on duplicate printifyId');
  await cleanupTestDb();

  // TEST 9 — duplicate variant identity
  console.log('\nTEST 9 — duplicate variant identity:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product D', 'printify', 'PD', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId9 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PD'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId9, 'VDUP', 'Green', '#00FF00', 'M', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId9, 'VDUP', 'Green', '#00FF00', 'L', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  const incomingSet9 = new Set(['VDUP']);
  await assert.rejects(
    syncHelpers.reconcileVariant(db, prodId9, 'VDUP', {
      color: 'Green',
      colorHex: '#00FF00',
      size: 'M',
      price: 100,
      cost: 50,
      stockQty: 10,
      isAvailable: 1,
      imageUrl: 'http://var.jpg'
    }),
    /Duplicate variant identity/
  );
  console.log('  ✅ PASS - Sync aborted on duplicate variant identity');
  await cleanupTestDb();

  // TEST 10 — stale variant async completion
  console.log('\nTEST 10 — stale variant async completion:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product Async', 'printify', 'PASYNC', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId10 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PASYNC'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId10, 'VASYNC', 'Yellow', '#FFFF00', 'S', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  const incomingSet10 = new Set(['VOTHER']); // VASYNC not in incoming
  await syncHelpers.disableStaleVariants(db, prodId10, incomingSet10);
  // Immediately check DB after await - should see disabled state
  const variants10 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId, isEnabled, isAvailable FROM product_variants WHERE productId = ?`, [prodId10], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  assert.equal(variants10.length, 1, 'Should have exactly 1 variant');
  assert.equal(variants10[0].printifyVariantId, 'VASYNC', 'Variant printifyVariantId should be preserved');
  assert.equal(variants10[0].isEnabled, 0, 'Variant should be disabled');
  assert.equal(variants10[0].isAvailable, 0, 'Variant should be unavailable');
  console.log('  ✅ PASS - Stale variant update completed before promise resolved');
  await cleanupTestDb();

  // TEST 11 — stale variant DB error rejection
  console.log('\nTEST 11 — stale variant DB error rejection:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Product Err', 'printify', 'PERR', 100, 'http://img.jpg', 'desc'], resolve);
  });
  const prodId11 = await new Promise((resolve, reject) => {
    db.get(`SELECT id FROM products WHERE printifyId = ?`, ['PERR'], (err, row) => {
      if (err) reject(err);
      else resolve(row.id);
    });
  });
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prodId11, 'VERR', 'Red', '#FF0000', 'M', 100, 50, 10, 1, 1, 'http://var.jpg'], resolve);
  });
  // Close DB to simulate error
  await new Promise((resolve) => db.close(resolve));
  const incomingSet11 = new Set(['VOTHER']);
  await assert.rejects(
    syncHelpers.disableStaleVariants(db, prodId11, incomingSet11),
    /SQLITE|database is closed/
  );
  console.log('  ✅ PASS - DB error rejects the promise');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // TEST 12 — sync serialization (concurrent calls)
  console.log('\nTEST 12 — sync serialization (concurrent calls):');
  const { PrintifyService } = require('../services/printify');
  const printifyService = new PrintifyService();

  let executionOrder = [];
  let sync1Started = false;
  let sync1Completed = false;
  let sync2Started = false;

  // Mock _syncProductsOnce to track execution order
  const originalSyncOnce = printifyService._syncProductsOnce;
  printifyService._syncProductsOnce = async function(source) {
    if (source === 'sync1') {
      sync1Started = true;
      executionOrder.push('sync1-start');
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
      sync1Completed = true;
      executionOrder.push('sync1-end');
      return 1;
    } else if (source === 'sync2') {
      sync2Started = true;
      executionOrder.push('sync2-start');
      return 2;
    }
    return 0;
  };

  // Start both syncs concurrently
  const p1 = printifyService.syncProducts('sync1');
  await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure sync1 starts first
  const p2 = printifyService.syncProducts('sync2');

  await Promise.all([p1, p2]);

  // Verify execution order: sync1 must complete before sync2 starts
  assert.equal(executionOrder[0], 'sync1-start', 'sync1 should start first');
  assert.equal(executionOrder[1], 'sync1-end', 'sync1 should end before sync2 starts');
  assert.equal(executionOrder[2], 'sync2-start', 'sync2 should start after sync1 ends');
  assert.equal(executionOrder.length, 3, 'Should have exactly 3 execution events');

  // Restore original
  printifyService._syncProductsOnce = originalSyncOnce;
  console.log('  ✅ PASS - Concurrent syncs are serialized');

  // TEST 13 — sync failure releases queue
  console.log('\nTEST 13 — sync failure releases queue:');
  let sync3Started = false;
  let sync4Started = false;

  printifyService._syncProductsOnce = async function(source) {
    if (source === 'sync3') {
      sync3Started = true;
      throw new Error('sync3 failed');
    } else if (source === 'sync4') {
      sync4Started = true;
      return 4;
    }
    return 0;
  };

  const p3 = printifyService.syncProducts('sync3').catch(() => {}); // Catch expected error
  await new Promise(resolve => setTimeout(resolve, 10));
  const p4 = printifyService.syncProducts('sync4');

  await Promise.all([p3, p4]);

  assert.equal(sync3Started, true, 'sync3 should have started');
  assert.equal(sync4Started, true, 'sync4 should start after sync3 fails');

  printifyService._syncProductsOnce = originalSyncOnce;
  console.log('  ✅ PASS - Failed sync releases queue for next sync');

  console.log('\n=== ALL TESTS COMPLETED ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
