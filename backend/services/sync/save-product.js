const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('../../db');
const telegramBot = require('../ingest/telegram-bot');

// Helper to run query as promise
const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const COLOR_HEX_MAP = {
  black: '#000000',
  white: '#ffffff',
  grey: '#808080',
  gray: '#808080',
  natural: '#eed9c4',
  tan: '#d2b48c',
  sand: '#e5d3b3',
  navy: '#000080',
  blue: '#0000ff',
  red: '#ff0000',
  green: '#008000',
  autumn: '#ff7f50',
  mauve: '#e0b0ff'
};

function getColorHex(colorName) {
  const normalized = String(colorName || '').toLowerCase().trim();
  return COLOR_HEX_MAP[normalized] || '#000000';
}

async function syncProductToStorefront(job) {
  const jobId = job.id;
  const printifyId = job.printifyProductId;
  const title = job.productTitle;
  const description = job.productDescription;
  const telegramUserId = job.telegramUserId;

  let mockupUrls = [];
  try {
    mockupUrls = JSON.parse(job.mockupUrls || '[]');
  } catch {
    mockupUrls = [];
  }

  let colors = [];
  try {
    colors = JSON.parse(job.colors || '[]');
  } catch {
    colors = ['Black', 'White', 'Natural'];
  }

  console.log(`🔄 [DB Sync] Synchronizing Product #${printifyId} ("${title}") to local Storefront database...`);

  try {
    // 1. Apply STRICT Drip Street pricing rules
    const isHoodie = String(title).toLowerCase().includes('hoodie') ||
                     String(title).toLowerCase().includes('hooded') ||
                     String(title).toLowerCase().includes('sweatshirt') ||
                     String(description).toLowerCase().includes('hoodie') ||
                     String(description).toLowerCase().includes('sweatshirt');

    const targetPrice = isHoodie ? 229.90 : 149.90; // STRICT pricing: Hoodies = 229.90 ILS, T-Shirts = 149.90 ILS
    const priceUSD = targetPrice / 3.75; // Map standard exchange-rate
    
    console.log(`💰 [DB Sync] STRICT Pricing Applied: Product type is ${isHoodie ? 'HOODIE' : 'TEE'}. Price: ${targetPrice} ILS (${priceUSD.toFixed(2)} USD)`);

    const frontImageUrl = mockupUrls[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80';
    const backImageUrl = mockupUrls[1] || '';

    // Structure mock images object matching storefront schema
    const allImages = mockupUrls.map((url, index) => ({
      src: url,
      position: index === 0 ? 'front' : (index === 1 ? 'back' : 'other'),
      variantId: `mock_variant_${index}`
    }));

    const variantImageMap = {};
    colors.forEach((color, cIdx) => {
      variantImageMap[color] = allImages;
    });

    const imagesSchema = JSON.stringify({ allImages, variantImageMap });

    const fabric = isHoodie 
      ? '50% Cotton / 50% Polyester, 8.0 oz Heavy Blend™ Fleece. Double-lined hood.'
      : '100% Airlume Combed & Ring-Spun Cotton, 4.2 oz. Side-seamed. Retail fit.';
    const careInstructions = 'Machine wash cold inside out. Tumble dry low. Do not iron directly on print.';
    const deliveryInfo = 'Print-on-demand: 3-5 business days production + 7-14 days international shipping.';

    // 2. Upsert product into 'products' table
    let productId = null;
    const existingProduct = await dbGetAsync(`SELECT id FROM products WHERE printifyId = ?`, [printifyId]);

    if (existingProduct) {
      productId = existingProduct.id;
      console.log(`[DB Sync] Product already exists in local DB (ID: ${productId}). Updating record...`);
      await dbRunAsync(
        `UPDATE products SET title = ?, description = ?, price = ?, priceUSD = ?, imageUrl = ?, backImageUrl = ?, images = ?, fabric = ?, careInstructions = ?, deliveryInfo = ? WHERE id = ?`,
        [title, description, targetPrice, priceUSD, frontImageUrl, backImageUrl, imagesSchema, fabric, careInstructions, deliveryInfo, productId]
      );
    } else {
      console.log(`[DB Sync] Product does not exist. Creating new local DB record...`);
      const insertResult = await dbRunAsync(
        `INSERT INTO products (title, description, price, priceUSD, imageUrl, backImageUrl, images, stock, type, printifyId, fabric, careInstructions, deliveryInfo) VALUES (?, ?, ?, ?, ?, ?, ?, 999, 'printify', ?, ?, ?, ?)`,
        [title, description, targetPrice, priceUSD, frontImageUrl, backImageUrl, imagesSchema, printifyId, fabric, careInstructions, deliveryInfo]
      );
      productId = insertResult.lastID;
    }

    // 3. Populate product variants matching standard sizes and Vision-selected colors
    console.log(`[DB Sync] Syncing sizes S-3XL and colors [${colors.join(', ')}] variants...`);
    
    // Clear any pre-existing variants for this product
    await dbRunAsync(`DELETE FROM product_variants WHERE productId = ?`, [productId]);

    const standardSizes = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

    for (const color of colors) {
      const colorHex = getColorHex(color);
      for (const size of standardSizes) {
        const mockPrintifyVariantId = `var_${productId}_${color.substring(0,3)}_${size}`;
        
        await dbRunAsync(
          `INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, 999, 1, 1, ?)`,
          [productId, mockPrintifyVariantId, color, colorHex, size, targetPrice, targetPrice * 0.45, frontImageUrl]
        );
      }
    }

    console.log(`✅ [DB Sync] Inserted ${colors.length * standardSizes.length} variant options inside product_variants table.`);

    // 4. Update job status to 'completed'
    await dbRunAsync(
      `UPDATE automation_jobs SET status = 'completed', price = ?, category = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [targetPrice, isHoodie ? 'Hoodies' : 'Shirts', jobId]
    );

    console.log(`✅ [DB Sync] Job #${jobId} marked as 'completed' successfully!`);

    // 5. Trigger Frontend Sitemap Rebuild
    console.log(`📡 [DB Sync] Launching frontend sitemap generator rebuild script...`);
    const frontendScriptsDir = path.resolve(__dirname, '../../../frontend/scripts');
    const sitemapScriptPath = [
      path.join(frontendScriptsDir, 'generate-sitemap.js'),
      path.join(frontendScriptsDir, 'generate-sitemap.cjs')
    ].find((candidate) => fs.existsSync(candidate));

    if (sitemapScriptPath) {
      exec(`node "${sitemapScriptPath}"`, (error, stdout) => {
        if (error) {
          console.error(`⚠️ [DB Sync] Sitemap rebuild command failed:`, error.message);
        } else {
          console.log(`✅ [DB Sync] Sitemap successfully rebuilt:\n`, stdout);
        }
      });
    } else {
      console.warn('⚠️ [DB Sync] No sitemap generator script found (expected generate-sitemap.js or generate-sitemap.cjs).');
    }

    // 6. Alert User on Telegram
    if (telegramUserId) {
      await telegramBot.replyTelegram(
        telegramUserId,
        `🎉 <b>CONGRATULATIONS! Pipeline Complete!</b>\n` +
        `Your product is 100% LIVE on the storefront!\n\n` +
        `🛍️ <b>Title:</b> ${title}\n` +
        `🏷️ <b>Price:</b> ₪${targetPrice.toFixed(2)}\n` +
        `🔗 <b>Link:</b> <a href="https://dripstreetshop.com/product/${productId}">dripstreetshop.com/product/${productId}</a>\n\n` +
        `<i>It is now fully indexed and ready for purchases using PayPal!</i>`
      );
    }

    return true;
  } catch (err) {
    console.error(`❌ [DB Sync] Sync failed for Job #${jobId}:`, err.message);

    await dbRunAsync(
      `UPDATE automation_jobs SET status = 'failed', errorMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [err.message, jobId]
    );

    if (telegramUserId) {
      await telegramBot.replyTelegram(
        telegramUserId,
        `🚨 <b>Database Sync Failed</b>\n` +
        `Job ID: <code>#${jobId}</code>\n` +
        `Reason: <code>${err.message}</code>`
      );
    }
    return false;
  }
}

module.exports = {
  syncProductToStorefront
};
