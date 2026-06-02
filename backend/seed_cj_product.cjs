const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('Starting automated CJ hardware collection seeding...');

const HARDWARE_ITEMS = [
  {
    id: 17,
    spu: 'CJLX1574470',
    title: 'HEAVYWEIGHT CUBAN CHAIN',
    price: 149,
    fallbackImage: 'https://cf.cjdropshipping.com/f737cb87-9e26-4215-af24-032cb5bb980e.jpg',
  },
  {
    id: 18,
    spu: 'CJLX2653180',
    title: 'TITANIUM BRAIDED PENDANT',
    price: 139,
    fallbackImage: 'https://cf.cjdropshipping.com/quick/product/08ae3ced-40ba-4a40-a822-aac14cf926d2.jpg',
  },
  {
    id: 19,
    spu: 'CJZBLXSL06697',
    title: 'COLD WIND CUBAN BRACELET',
    price: 119,
    fallbackImage: 'https://cf.cjdropshipping.com/2054/4883093832835.jpg',
  },
  {
    id: 20,
    spu: 'CJLX1022452',
    title: 'ESSENTIAL STEEL STUDS',
    price: 79,
    fallbackImage: 'https://cf.cjdropshipping.com/1614328451320.jpg',
  },
  {
    id: 21,
    spu: 'CJLX1552176',
    title: 'ONYX ZIRCON STUDS',
    price: 89,
    fallbackImage: 'https://cf.cjdropshipping.com/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function runCallback(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const parseImageList = (rawProductImage) => {
  if (Array.isArray(rawProductImage)) return rawProductImage.filter(Boolean);
  if (typeof rawProductImage !== 'string') return [];
  const trimmed = rawProductImage.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  return [trimmed];
};

async function getCJAccessToken() {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error('CJ_API_KEY is missing from backend/.env');

  const response = await axios.post(
    'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
    { apiKey },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const json = response.data || {};
  const token = (json.data && json.data.accessToken) || json.accessToken;
  if (!token) throw new Error(`Failed to extract CJ access token: ${JSON.stringify(json)}`);
  return token;
}

async function resolvePrimaryImage(token, spu, fallbackImage) {
  await sleep(1200); // Respect CJ QPS limits.

  try {
    const response = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/query', {
      headers: { 'CJ-Access-Token': token },
      params: { productSku: spu },
    });

    const payload = response.data || {};
    const productData = payload.data || {};
    const imageList = parseImageList(productData.productImage);
    const primaryImage = productData.bigImage || imageList[0] || productData.productImage;

    if (primaryImage) {
      return String(primaryImage);
    }
  } catch (error) {
    const detail = error.response ? JSON.stringify(error.response.data) : error.message;
    console.warn(`CJ image query failed for ${spu}: ${detail}`);
  }

  console.warn(`Falling back to static CJ CDN image for ${spu}`);
  return fallbackImage;
}

(async () => {
  try {
    const token = await getCJAccessToken();

    for (const item of HARDWARE_ITEMS) {
      const imageUrl = await resolvePrimaryImage(token, item.spu, item.fallbackImage);
      const description = `${item.title} - curated hardware drop sourced from CJ catalog SPU ${item.spu}.`;

      // Keep Product 16 untouched. For hardware IDs 17-21, overwrite atomically.
      await dbRun('DELETE FROM product_variants WHERE productId = ?', [item.id]);
      await dbRun('DELETE FROM products WHERE id = ?', [item.id]);

      await dbRun(
        `INSERT INTO products (id, title, description, price, priceUSD, imageUrl, images, type, printifyId, supplier_id, stock)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [item.id, item.title, description, item.price, null, imageUrl, 'dropship', item.spu, 'dropship', 999]
      );

      await dbRun(
        `INSERT INTO product_variants (productId, printifyVariantId, color, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
        [item.id, item.spu, 'Default', 'One Size', item.price, 0, 999, imageUrl]
      );

      console.log(`Seeded hardware product ID ${item.id} (${item.spu})`);
    }

    const rows = await dbAll('SELECT id, title, price, imageUrl, printifyId FROM products WHERE id BETWEEN 17 AND 21 ORDER BY id');
    console.log('\n=== Seeded Hardware Products ===');
    console.table(rows);

    const variants = await dbAll('SELECT productId, printifyVariantId, price, imageUrl FROM product_variants WHERE productId BETWEEN 17 AND 21 ORDER BY productId');
    console.log('\n=== Seeded Hardware Variants ===');
    console.table(variants);

    process.exit(0);
  } catch (error) {
    console.error('Hardware seed failed:', error.message);
    process.exit(1);
  }
})();
