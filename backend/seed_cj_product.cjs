const db = require('./db');

console.log('🌱 Starting CJ Dropshipping Product Seeding...');

db.serialize(() => {
  // 1. Insert product
  const title = 'Six-sided Grinding Cuban Link Chain | Premium Jewelry';
  const description = 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the Drip Street jewelry line.';
  const price = 149.00; // ~39.99 USD
  const priceUSD = 39.99;
  const imageUrl = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=600&q=80';
  const supplier_id = 'dropship';
  const type = 'dropship'; // Do NOT use 'local' to avoid being deleted by db.js cleanup
  const printifyId = 'CJLX222053101AZ'; // Stored as fallback SKU

  db.run(
    `INSERT INTO products (title, description, price, priceUSD, imageUrl, type, printifyId, supplier_id, stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description, price, priceUSD, imageUrl, type, printifyId, supplier_id, 999],
    function (err) {
      if (err) {
        console.error('❌ Failed to seed product:', err.message);
        process.exit(1);
      }

      const productId = this.lastID;
      console.log(`✅ Product seeded successfully! ID: ${productId}`);

      // 2. Insert variant
      const color = 'Gold';
      const size = '20 Inch';
      const cost = 21.80; // ~$5.84 USD
      const printifyVariantId = 'CJLX222053101AZ'; // The actual SKU used by dropship.js

      db.run(
        `INSERT INTO product_variants (productId, printifyVariantId, color, size, price, cost, stockQty, isEnabled, isAvailable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, printifyVariantId, color, size, price, cost, 999, 1, 1],
        function (vErr) {
          if (vErr) {
            console.error('❌ Failed to seed product variant:', vErr.message);
            process.exit(1);
          }

          console.log(`✅ Product Variant seeded successfully! ID: ${this.lastID}`);

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
      );
    }
  );
});
