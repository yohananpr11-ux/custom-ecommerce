const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
      type TEXT DEFAULT 'local',
      printifyId TEXT
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

// Simulate the product matching logic from printify.js
async function matchAndUpsertProduct(printifyId, title, price, imageUrl, description) {
  return new Promise((resolve, reject) => {
    // Step 1: Match by printifyId first
    db.get(`SELECT id, title, printifyId FROM products WHERE type = 'printify' AND printifyId = ?`, [printifyId], (err, rows) => {
      if (err) return reject(err);

      if (rows) {
        // Check for duplicates
        db.all(`SELECT id FROM products WHERE type = 'printify' AND printifyId = ?`, [printifyId], (err2, allMatches) => {
          if (err2) return reject(err2);

          if (allMatches && allMatches.length > 1) {
            return reject(new Error(`Duplicate printifyId ${printifyId} found in ${allMatches.length} products. Sync aborted.`));
          }

          // Single match - UPDATE including title
          db.run(`UPDATE products SET title = ?, price = ?, imageUrl = ?, description = ?, printifyId = ? WHERE id = ?`,
            [title, price, imageUrl, description, printifyId, rows.id],
            (updateErr) => {
              if (updateErr) return reject(updateErr);
              resolve(rows.id);
            });
        });
      } else {
        // Step 2: Fallback to title matching for legacy rows
        db.get(`SELECT id FROM products WHERE type = 'printify' AND title = ? AND (printifyId IS NULL OR printifyId = '')`, [title], (err3, legacyMatch) => {
          if (err3) return reject(err3);

          if (legacyMatch) {
            // Check for legacy duplicates
            db.all(`SELECT id FROM products WHERE type = 'printify' AND title = ? AND (printifyId IS NULL OR printifyId = '')`, [title], (err4, allLegacy) => {
              if (err4) return reject(err4);

              if (allLegacy && allLegacy.length > 1) {
                return reject(new Error(`Duplicate legacy title "${title}" found in ${allLegacy.length} products. Sync aborted.`));
              }

              // Backfill printifyId for legacy match
              db.run(`UPDATE products SET printifyId = ? WHERE id = ?`, [printifyId, legacyMatch.id], (updateErr) => {
                if (updateErr) return reject(updateErr);
                resolve(legacyMatch.id);
              });
            });
          } else {
            // Step 3: INSERT new product
            db.run(`INSERT INTO products (title, description, price, imageUrl, type, printifyId) VALUES (?, ?, ?, ?, ?, ?)`,
              [title, description, price, imageUrl, 'printify', printifyId],
              function(insertErr) {
                if (insertErr) return reject(insertErr);
                resolve(this.lastID);
              });
          }
        });
      }
    });
  });
}

// Simulate variant reconciliation logic
async function reconcileVariant(productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isAvailable, imageUrl, incomingPrintifyVariantIds) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM product_variants WHERE productId = ? AND printifyVariantId = ?`, [productId, printifyVariantId], (err, existing) => {
      if (err) return reject(err);

      if (existing) {
        // Check for duplicates
        db.all(`SELECT id FROM product_variants WHERE productId = ? AND printifyVariantId = ?`, [productId, printifyVariantId], (err2, allMatches) => {
          if (err2) return reject(err2);

          if (allMatches && allMatches.length > 1) {
            return reject(new Error(`Duplicate variant identity (productId=${productId}, printifyVariantId=${printifyVariantId}) found in ${allMatches.length} rows. Sync aborted.`));
          }

          // UPDATE existing variant (preserving local id)
          db.run(`UPDATE product_variants SET color = ?, colorHex = ?, size = ?, price = ?, cost = ?, stockQty = ?, isEnabled = 1, isAvailable = ?, imageUrl = ? WHERE id = ?`,
            [color, colorHex, size, price, cost, stockQty, isAvailable, imageUrl, existing.id],
            (updateErr) => {
              if (updateErr) return reject(updateErr);
              resolve(existing.id);
            });
        });
      } else {
        // INSERT new variant
        db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isAvailable, imageUrl],
          function(insertErr) {
            if (insertErr) return reject(insertErr);
            resolve(this.lastID);
          });
      }
    });
  });
}

async function disableStaleVariants(productId, incomingPrintifyVariantIds) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId FROM product_variants WHERE productId = ?`, [productId], (err, allVariants) => {
      if (err) return reject(err);

      if (allVariants) {
        for (const v of allVariants) {
          if (v.printifyVariantId && !incomingPrintifyVariantIds.has(v.printifyVariantId)) {
            db.run(`UPDATE product_variants SET isEnabled = 0, isAvailable = 0 WHERE id = ?`, [v.id], (updateErr) => {
              if (updateErr) return reject(updateErr);
            });
          }
        }
      }
      resolve();
    });
  });
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
  const productId1 = await matchAndUpsertProduct('P1', 'New title', 100, 'http://img.jpg', 'desc');
  const products1 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test1Pass = products1.length === 1 && products1[0].id === productId1 && products1[0].title === 'New title' && products1[0].printifyId === 'P1';
  console.log(`  ${test1Pass ? '✅ PASS' : '❌ FAIL'} - ${test1Pass ? 'Product renamed, ID preserved, no duplicate' : 'Test failed'}`);
  await cleanupTestDb();

  // TEST 2 — legacy backfill
  console.log('\nTEST 2 — legacy backfill:');
  await setupTestDb();
  await new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (title, type, printifyId, price, imageUrl, description) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Same title', 'printify', null, 100, 'http://img.jpg', 'desc'], resolve);
  });
  const productId2 = await matchAndUpsertProduct('P2', 'Same title', 100, 'http://img.jpg', 'desc');
  const products2 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test2Pass = products2.length === 1 && products2[0].id === productId2 && products2[0].printifyId === 'P2';
  console.log(`  ${test2Pass ? '✅ PASS' : '❌ FAIL'} - ${test2Pass ? 'Legacy row backfilled with printifyId, no INSERT' : 'Test failed'}`);
  await cleanupTestDb();

  // TEST 3 — new product
  console.log('\nTEST 3 — new product:');
  await setupTestDb();
  const productId3 = await matchAndUpsertProduct('P3', 'New Product', 100, 'http://img.jpg', 'desc');
  const products3 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, title, printifyId FROM products`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test3Pass = products3.length === 1 && products3[0].printifyId === 'P3' && products3[0].title === 'New Product';
  console.log(`  ${test3Pass ? '✅ PASS' : '❌ FAIL'} - ${test3Pass ? 'New product inserted with printifyId' : 'Test failed'}`);
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
  const variantId4 = await reconcileVariant(prodId4, 'V1', 'Black', '#000000', 'M', 110, 55, 15, 1, 'http://var2.jpg', incomingSet4);
  const variants4 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId, price FROM product_variants WHERE productId = ?`, [prodId4], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test4Pass = variants4.length === 1 && variants4[0].id === variantId4 && variants4[0].price === 110;
  console.log(`  ${test4Pass ? '✅ PASS' : '❌ FAIL'} - ${test4Pass ? 'Existing variant updated, ID preserved' : 'Test failed'}`);
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
  const variantId5 = await reconcileVariant(prodId5, 'V2', 'White', '#FFFFFF', 'L', 100, 50, 10, 1, 'http://var.jpg', incomingSet5);
  const variants5 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId FROM product_variants WHERE productId = ?`, [prodId5], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test5Pass = variants5.length === 1 && variants5[0].printifyVariantId === 'V2';
  console.log(`  ${test5Pass ? '✅ PASS' : '❌ FAIL'} - ${test5Pass ? 'New variant inserted' : 'Test failed'}`);
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
  await disableStaleVariants(prodId6, incomingSet6);
  const variants6 = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId, isEnabled, isAvailable FROM product_variants WHERE productId = ?`, [prodId6], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const test6Pass = variants6.length === 1 && variants6[0].printifyVariantId === 'V3' && variants6[0].isEnabled === 0 && variants6[0].isAvailable === 0;
  console.log(`  ${test6Pass ? '✅ PASS' : '❌ FAIL'} - ${test6Pass ? 'Stale variant disabled, not deleted, ID preserved' : 'Test failed'}`);
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
  await reconcileVariant(prodId7, 'V5', 'Blue', '#0000FF', 'XL', 110, 55, 15, 1, 'http://var2.jpg', incomingSet7);
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
  const test7Pass = orderItems7.length === 1 && orderItems7[0].variantId === varId7 && variants7.length === 1;
  console.log(`  ${test7Pass ? '✅ PASS' : '❌ FAIL'} - ${test7Pass ? 'Historical order reference preserved, variant ID unchanged' : 'Test failed'}`);
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
  let test8Pass = false;
  try {
    await matchAndUpsertProduct('PDUP', 'Product C', 100, 'http://img.jpg', 'desc');
  } catch (err) {
    test8Pass = err.message.includes('Duplicate printifyId');
  }
  console.log(`  ${test8Pass ? '✅ PASS' : '❌ FAIL'} - ${test8Pass ? 'Sync aborted on duplicate printifyId' : 'Test failed'}`);
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
  let test9Pass = false;
  try {
    await reconcileVariant(prodId9, 'VDUP', 'Green', '#00FF00', 'M', 100, 50, 10, 1, 'http://var.jpg', incomingSet9);
  } catch (err) {
    test9Pass = err.message.includes('Duplicate variant identity');
  }
  console.log(`  ${test9Pass ? '✅ PASS' : '❌ FAIL'} - ${test9Pass ? 'Sync aborted on duplicate variant identity' : 'Test failed'}`);
  await cleanupTestDb();

  console.log('\n=== ALL TESTS COMPLETED ===');
}

runTests().catch(console.error);
