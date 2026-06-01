const db = require('./db');

console.log('🌱 Starting CJ Dropshipping Product Seeding (Idempotent Mode)...');

const title = 'Six-sided Grinding Cuban Link Chain | Premium Jewelry';
const description = 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the Drip Street jewelry line.';
const price = 5.00; // ~1.33 USD for sandbox testing
const priceUSD = 1.33;
const imageUrl = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=80';
const supplier_id = 'dropship';
const type = 'dropship';
const printifyId = 'CJLX222053101AZ';

const color = 'Gold';
const size = '20 Inch';
const cost = 21.80; // ~$5.84 USD
const printifyVariantId = 'CJLX222053101AZ';

db.serialize(() => {
  // Check if product already exists
  db.get(`SELECT id FROM products WHERE printifyId = ?`, [printifyId], (err, existingProduct) => {
    if (err) {
      console.error('❌ Database error checking product existence:', err.message);
      process.exit(1);
    }

    if (existingProduct) {
      const productId = existingProduct.id;
      console.log(`ℹ️ Product already exists (ID: ${productId}). Updating product and variant...`);

      // Update product, forcing images = NULL so the new imageUrl is preferred
      db.run(
        `UPDATE products
         SET title = ?, description = ?, price = ?, priceUSD = ?, imageUrl = ?, images = NULL, type = ?, supplier_id = ?, stock = ?
         WHERE id = ?`,
        [title, description, price, priceUSD, imageUrl, type, supplier_id, 999, productId],
        (updateErr) => {
          if (updateErr) {
            console.error('❌ Failed to update product:', updateErr.message);
            process.exit(1);
          }

          // Update variant
          db.run(
            `UPDATE product_variants
             SET price = ?, cost = ?, color = ?, size = ?, stockQty = ?, imageUrl = ?, isEnabled = 1, isAvailable = 1
             WHERE productId = ? AND printifyVariantId = ?`,
            [price, cost, color, size, 999, imageUrl, productId, printifyVariantId],
            (vUpdateErr) => {
              if (vUpdateErr) {
                console.error('❌ Failed to update product variant:', vUpdateErr.message);
                process.exit(1);
              }

              console.log('✅ Product and variant updated successfully (idempotent)!');
              displayAndExit(productId);
            }
          );
        }
      );
    } else {
      console.log('🌱 Product does not exist. Creating new product and variant...');

      // Insert product
      db.run(
        `INSERT INTO products (title, description, price, priceUSD, imageUrl, images, type, printifyId, supplier_id, stock)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [title, description, price, priceUSD, imageUrl, type, printifyId, supplier_id, 999],
        function (insertErr) {
          if (insertErr) {
            console.error('❌ Failed to seed product:', insertErr.message);
            process.exit(1);
          }

          const productId = this.lastID;
          console.log(`✅ Product seeded successfully! ID: ${productId}`);

          // Insert variant
          db.run(
            `INSERT INTO product_variants (productId, printifyVariantId, color, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, printifyVariantId, color, size, price, cost, 999, 1, 1, imageUrl],
            function (vInsertErr) {
              if (vInsertErr) {
                console.error('❌ Failed to seed product variant:', vInsertErr.message);
                process.exit(1);
              }

              console.log(`✅ Product Variant seeded successfully! ID: ${this.lastID}`);
              displayAndExit(productId);
            }
          );
        }
      );
    }
  });
});

function displayAndExit(productId) {
  // Fetch and display product from DB to confirm
  db.get(`SELECT * FROM products WHERE id = ?`, [productId], (e, pRow) => {
    console.log('\n=== Seeded Product in DB ===');
    console.log(pRow);

    db.all(`SELECT * FROM product_variants WHERE productId = ?`, [productId], (e2, vRows) => {
      console.log('\n=== Seeded Variant in DB ===');
      console.log(vRows);
      process.exit(0);
    });
  });
}
