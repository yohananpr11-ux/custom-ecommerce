const db = require('./db');

console.log('🌱 Starting CJ Dropshipping Product Seeding (Idempotent Mode)...');

const title = 'Six-sided Grinding Cuban Link Chain | Premium Jewelry';
const description = 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the Drip Street jewelry line.';
const price = 149.00;
const priceUSD = 39.90;
const imageUrl = 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?q=80&w=1000&auto=format&fit=crop';
const supplier_id = 'dropship';
const type = 'dropship';
const printifyId = 'CJLX222053101AZ';
const productId = 16;

const color = 'Gold';
const size = '20 Inch';
const cost = 21.80; // ~$5.84 USD
const printifyVariantId = 'CJLX222053101AZ';

db.serialize(() => {
  console.log('☢️ Forcing Product 16 overwrite via DELETE + INSERT...');

  db.run(`DELETE FROM product_variants WHERE productId = ?`, [productId], (variantDeleteErr) => {
    if (variantDeleteErr) {
      console.error('❌ Failed to delete existing variants:', variantDeleteErr.message);
      process.exit(1);
    }

    db.run(`DELETE FROM products WHERE id = ?`, [productId], (productDeleteErr) => {
      if (productDeleteErr) {
        console.error('❌ Failed to delete existing product:', productDeleteErr.message);
        process.exit(1);
      }

      db.run(
        `INSERT INTO products (id, title, description, price, priceUSD, imageUrl, images, type, printifyId, supplier_id, stock)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [productId, title, description, price, priceUSD, imageUrl, type, printifyId, supplier_id, 999],
        (insertErr) => {
          if (insertErr) {
            console.error('❌ Failed to insert product:', insertErr.message);
            process.exit(1);
          }

          db.run(
            `INSERT INTO product_variants (productId, printifyVariantId, color, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, printifyVariantId, color, size, price, cost, 999, 1, 1, imageUrl],
            (variantInsertErr) => {
              if (variantInsertErr) {
                console.error('❌ Failed to insert product variant:', variantInsertErr.message);
                process.exit(1);
              }

              console.log('✅ Forced overwrite complete for product 16.');
              displayAndExit(productId);
            }
          );
        }
      );
    });
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
