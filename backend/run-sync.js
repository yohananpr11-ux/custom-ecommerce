const axios = require('axios');

const token = process.env.PRINTIFY_API_TOKEN;
if (!token || token === 'YOUR_PRINTIFY_TOKEN') {
  console.error('❌ PRINTIFY_API_TOKEN is missing, empty, or still set to the placeholder value. Set a real Printify API token in your environment before running this script.');
  process.exit(1);
}

const SHOP_ID = 27495153;

async function main() {
  try {
    // Step 1: Fetch products from Printify
    console.log('🔄 Fetching products from Printify...');
    const res = await axios.get(`https://api.printify.com/v1/shops/${SHOP_ID}/products.json?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const products = res.data.data || [];
    console.log(`📦 Found ${products.length} products in Printify\n`);

    if (products.length === 0) {
      console.log('❌ No products found. Make sure products are saved in Printify.');
      return;
    }

    // Step 2: Process each product
    const processedProducts = [];
    for (const p of products) {
      const title = p.title;
      const description = p.description ? p.description.replace(/<[^>]*>/g, '').substring(0, 500) : '';
      
      // Get the best image
      let imageUrl = '';
      if (p.images && p.images.length > 0) {
        const frontImg = p.images.find(img => img.position === 'front' && img.is_default);
        imageUrl = frontImg ? frontImg.src : p.images[0].src;
      }
      
      // Calculate base cost from variants
      const enabledVariants = p.variants ? p.variants.filter(v => v.is_enabled) : [];
      let baseCostCents = 0;
      if (enabledVariants.length > 0) {
        baseCostCents = Math.min(...enabledVariants.map(v => v.cost || v.price || 0));
      }
      const baseCostUSD = baseCostCents / 100;

      // Calculate optimal NIS retail price (same logic as pricing engine)
      const exchangeRate = 3.76;
      const taxRate = 0.17;
      const profitMargin = 0.15;
      const paymentFee = 0.029;
      const fixedFee = 1.20;
      const setupCost = 5.00;
      const shippingCost = 4.50;

      const totalCostNIS = ((baseCostUSD + shippingCost) * exchangeRate) + fixedFee + setupCost;
      const marginDivisor = 1 - taxRate - profitMargin - paymentFee;
      let retailPrice = totalCostNIS / marginDivisor;
      retailPrice = Math.ceil(retailPrice / 10) * 10 - 0.10; // Psychological pricing (X9.90)

      console.log(`  📌 ${title}`);
      console.log(`     Base Cost: $${baseCostUSD.toFixed(2)} | Variants: ${enabledVariants.length}`);
      console.log(`     Retail Price: ₪${retailPrice.toFixed(2)}`);
      console.log(`     Image: ${imageUrl ? imageUrl.substring(0, 80) + '...' : 'NO IMAGE'}`);
      console.log('');

      processedProducts.push({
        title,
        description,
        price: retailPrice,
        imageUrl,
        stock: 999,
        type: 'printify',
        printifyId: p.id
      });
    }

    // Step 3: Insert into local SQLite DB
    console.log('💾 Inserting products into local database...');
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.resolve(__dirname, 'ecommerce.db');
    const db = new sqlite3.Database(dbPath);

    for (const prod of processedProducts) {
      const printifyId = String(prod.printifyId);
      await new Promise((resolve, reject) => {
        // Step 1: Match by printifyId first
        db.get(`SELECT id FROM products WHERE type = 'printify' AND printifyId = ?`, [printifyId], (err, existing) => {
          if (err) return reject(err);

          if (existing) {
            // UPDATE including title and printifyId
            db.run(`UPDATE products SET title = ?, price = ?, imageUrl = ?, description = ?, printifyId = ? WHERE id = ?`,
              [prod.title, prod.price, prod.imageUrl, prod.description, printifyId, existing.id], (updateErr) => {
                if (updateErr) return reject(updateErr);
                console.log(`  ♻️  Updated: ${prod.title}`);
                resolve();
              });
          } else {
            // Step 2: Fallback to title matching for legacy rows
            db.get(`SELECT id FROM products WHERE type = 'printify' AND title = ? AND (printifyId IS NULL OR printifyId = '')`, [prod.title], (err2, legacyMatch) => {
              if (err2) return reject(err2);

              if (legacyMatch) {
                // Backfill printifyId for legacy match
                db.run(`UPDATE products SET title = ?, price = ?, imageUrl = ?, description = ?, printifyId = ? WHERE id = ?`,
                  [prod.title, prod.price, prod.imageUrl, prod.description, printifyId, legacyMatch.id], (updateErr) => {
                    if (updateErr) return reject(updateErr);
                    console.log(`  ♻️  Updated (legacy backfill): ${prod.title}`);
                    resolve();
                  });
              } else {
                // INSERT new product with printifyId
                db.run(`INSERT INTO products (title, description, price, imageUrl, stock, type, printifyId) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [prod.title, prod.description, prod.price, prod.imageUrl, prod.stock, prod.type, printifyId], (insertErr) => {
                    if (insertErr) return reject(insertErr);
                    console.log(`  ✅ Inserted: ${prod.title}`);
                    resolve();
                  });
              }
            });
          }
        });
      });
    }

    db.close();

    console.log(`\n🎉 Sync complete! ${processedProducts.length} products are now in your store.`);
    
    // Step 4: Verify final state
    const db2 = new sqlite3.Database(dbPath);
    db2.all('SELECT id, title, price, type FROM products', [], (err, rows) => {
      console.log('\n📋 Full product catalog:');
      rows.forEach(r => {
        console.log(`  [${r.id}] ${r.title} | ₪${r.price.toFixed(2)} | ${r.type}`);
      });
      console.log(`\nTotal: ${rows.length} products`);
      db2.close();
    });

  } catch (e) {
    console.error('❌ Error:', e.response ? `${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message);
  }
}

main();
