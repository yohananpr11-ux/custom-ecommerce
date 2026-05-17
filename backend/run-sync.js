const axios = require('axios');
const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIzN2Q0YmQzMDM1ZmUxMWU5YTgwM2FiN2VlYjNjY2M5NyIsImp0aSI6Ijk4YjMwOTNkZjY1ZTA5MTc1ZTYwMjEzMzcwODMwYTBkYmI1NDlhYTI5OWZlOTE2N2QyZTRjNDAzNzE1ODJmYzQyNzhlYTU0NjdhN2UwMTNmIiwiaWF0IjoxNzc4OTUxODA3LjI3ODM2LCJuYmYiOjE3Nzg5NTE4MDcuMjc4MzYzLCJleHAiOjE4MTA0ODc4MDcuMjY3Mjg1LCJzdWIiOiIyNzI0MTc2OCIsInNjb3BlcyI6WyJzaG9wcy5tYW5hZ2UiLCJzaG9wcy5yZWFkIiwiY2F0YWxvZy5yZWFkIiwib3JkZXJzLnJlYWQiLCJvcmRlcnMud3JpdGUiLCJwcm9kdWN0cy5yZWFkIiwicHJvZHVjdHMud3JpdGUiLCJ3ZWJob29rcy5yZWFkIiwid2ViaG9va3Mud3JpdGUiLCJ1cGxvYWRzLnJlYWQiLCJ1cGxvYWRzLndyaXRlIiwicHJpbnRfcHJvdmlkZXJzLnJlYWQiLCJ1c2VyLmluZm8iXX0.VIysEdT7272dMFNxls_CXjq8G1SL2sABTuMH9bGAbNqPVyHYZ-mSuEZK31edcxPAtIsKqhPj9jl6n6Uqh_mtUNvyyRdRmbppzakMvjjrPxFxGP6hObH8NJA4Qt_WYXwW5_60d348Fl5JP57b2Sbn4gUdK1xsd9dCnBinZLg58zYOIQfS7mysCX4YHKdQZdjk2dhwZ2sJ5-j1ccgvl9OZPtqK6MCxLL1PbGFBXFa5WXrqLpNTyP_dcBXKSuHYRR8lDAnaEEPlHA0CRo94ZHI3kIR9CEiuOZjkJq1Q3X6sOJYvg6v32G9YmF1eBICkeOd4pncwLPCc_uDFYaGDQOFT1rGPpGcLSP1aAGa5_6R_2EQHgFLk_-gxV6sFVONVuiCx3vg9ZiQ4VNheJvW1UDOrq7ECTvZNMz7traY0Qsq2P0hVyUUZ6K_-3hWus1EmBsyH4WQHshoBTTqZyvccoVAKgs09RLKIitvCF_UVlLvyMhDT4-WnGaL7-glZwF2XkDOcoH2CwLaM7MO1q418V2ladNlKPtTEeBpBM6hqh89ivg4LFFKg-ntRgQdt2T13dm0FTG4jbUt7MQy-lUhZDZ02kITUIKskpnOqka1ElRZwJ81j3a7bDfhEE7APA_c6QJM5ZVlz1JmFMcVTP0k7kHiSZL4qa79ccSh8GbNopPw_CtY';
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
      await new Promise((resolve, reject) => {
        db.get(`SELECT id FROM products WHERE title = ? AND type = 'printify'`, [prod.title], (err, existing) => {
          if (err) return reject(err);
          if (existing) {
            db.run(`UPDATE products SET price = ?, imageUrl = ?, description = ? WHERE id = ?`,
              [prod.price, prod.imageUrl, prod.description, existing.id], resolve);
            console.log(`  ♻️  Updated: ${prod.title}`);
          } else {
            db.run(`INSERT INTO products (title, description, price, imageUrl, stock, type) VALUES (?, ?, ?, ?, ?, ?)`,
              [prod.title, prod.description, prod.price, prod.imageUrl, prod.stock, prod.type], resolve);
            console.log(`  ✅ Inserted: ${prod.title}`);
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
