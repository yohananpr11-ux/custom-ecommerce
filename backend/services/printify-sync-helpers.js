/**
 * Printify sync helper functions
 * Shared between production sync and tests
 */

/**
 * Match or upsert a product by printifyId with fallback to title
 * @param {Object} db - SQLite database instance
 * @param {string} printifyId - Printify product ID
 * @param {Object} productData - Product data (title, price, imageUrl, backImageUrl, images, description, fabric, careInstructions, deliveryInfo)
 * @returns {Promise<number>} - Local product ID
 */
async function matchAndUpsertProduct(db, printifyId, productData) {
  const { title, price, imageUrl, backImageUrl, images, description, fabric, careInstructions, deliveryInfo } = productData;

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
          db.run(`UPDATE products SET title = ?, price = ?, imageUrl = ?, backImageUrl = ?, images = ?, description = ?, printifyId = ?, fabric = ?, careInstructions = ?, deliveryInfo = ? WHERE id = ?`,
            [title, price, imageUrl, backImageUrl, images, description, printifyId, fabric, careInstructions, deliveryInfo, rows.id],
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

              // Backfill printifyId and refresh all fields for legacy match
              db.run(`UPDATE products SET title = ?, price = ?, imageUrl = ?, backImageUrl = ?, images = ?, description = ?, printifyId = ?, fabric = ?, careInstructions = ?, deliveryInfo = ? WHERE id = ?`,
                [title, price, imageUrl, backImageUrl, images, description, printifyId, fabric, careInstructions, deliveryInfo, legacyMatch.id],
                (updateErr) => {
                  if (updateErr) return reject(updateErr);
                  resolve(legacyMatch.id);
                });
            });
          } else {
            // Step 3: INSERT new product
            db.run(`INSERT INTO products (title, description, price, imageUrl, backImageUrl, images, stock, type, printifyId, fabric, careInstructions, deliveryInfo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [title, description, price, imageUrl, backImageUrl, images, 999, 'printify', printifyId, fabric, careInstructions, deliveryInfo],
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

/**
 * Reconcile a variant by printifyVariantId
 * @param {Object} db - SQLite database instance
 * @param {number} productId - Local product ID
 * @param {string} printifyVariantId - Printify variant ID
 * @param {Object} variantData - Variant data (color, colorHex, size, price, cost, stockQty, isAvailable, imageUrl)
 * @returns {Promise<number>} - Local variant ID
 */
async function reconcileVariant(db, productId, printifyVariantId, variantData) {
  const { color, colorHex, size, price, cost, stockQty, isAvailable, imageUrl } = variantData;

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

/**
 * Disable stale variants (not in incoming Printify response)
 * @param {Object} db - SQLite database instance
 * @param {number} productId - Local product ID
 * @param {Set<string>} incomingPrintifyVariantIds - Set of incoming printifyVariantIds
 * @returns {Promise<void>}
 */
async function disableStaleVariants(db, productId, incomingPrintifyVariantIds) {
  const allVariants = await new Promise((resolve, reject) => {
    db.all(`SELECT id, printifyVariantId FROM product_variants WHERE productId = ?`, [productId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  for (const v of allVariants) {
    if (v.printifyVariantId && !incomingPrintifyVariantIds.has(v.printifyVariantId)) {
      await new Promise((resolve, reject) => {
        db.run(`UPDATE product_variants SET isEnabled = 0, isAvailable = 0 WHERE id = ?`, [v.id], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }
}

module.exports = {
  matchAndUpsertProduct,
  reconcileVariant,
  disableStaleVariants
};
