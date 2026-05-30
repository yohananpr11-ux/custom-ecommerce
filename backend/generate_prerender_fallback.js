const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'ecommerce.db');
const copyUpdatesPath = path.resolve(__dirname, 'data', 'product-copy-updates.json');
const outputPath = path.resolve(__dirname, '..', 'frontend', 'scripts', 'products_fallback.json');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to DB:', err.message);
    process.exit(1);
  } else {
    db.all("SELECT id, title, description, price, priceUSD, imageUrl, backImageUrl, stock, type, printifyId FROM products", [], (err, rows) => {
      if (err) {
        console.error('Error reading products:', err.message);
        process.exit(1);
      } else {
        console.log(`Read ${rows.length} products from local database.`);
        
        let copyUpdates = {};
        if (fs.existsSync(copyUpdatesPath)) {
          try {
            copyUpdates = JSON.parse(fs.readFileSync(copyUpdatesPath, 'utf8'));
            console.log('Loaded canonical copy updates from product-copy-updates.json.');
          } catch (e) {
            console.warn('Warning: Could not parse product-copy-updates.json:', e.message);
          }
        }

        let mergedCount = 0;
        const mergedRows = rows.map(row => {
          const printifyId = row.printifyId;
          if (printifyId && copyUpdates[printifyId]) {
            const update = copyUpdates[printifyId];
            console.log(`  ✓ Merging premium copy for ID ${row.id} (${printifyId}):`);
            console.log(`    Title: "${row.title}" -> "${update.title}"`);
            mergedCount++;
            return {
              ...row,
              title: update.title,
              description: update.description
            };
          }
          return row;
        });

        console.log(`Merged premium copy updates for ${mergedCount} of ${rows.length} products.`);
        fs.writeFileSync(outputPath, JSON.stringify(mergedRows, null, 2), 'utf8');
        console.log(`Successfully wrote canonical fallback data to: ${outputPath}`);
      }
      db.close();
    });
  }
});
