const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('Starting automated CJ hardware collection seeding...');

// ─── DASHBOARD-SOURCED IMAGES — DO NOT MODIFY WITHOUT USER APPROVAL ──────────
// All imageUrl values below were manually selected by the store owner from
// the CJ Dropshipping dashboard. Do not replace with API-resolved images.
// ─── Image URL shorthands for readability ────────────────────────────────────
const CJ  = 'https://cf.cjdropshipping.com';
const OSS = 'https://oss-cf.cjdropshipping.com/product';

const HARDWARE_ITEMS = [
  // ── ID 17: Stainless Steel Cuban Chain ────────────────────────────────────
  // CJ audit 2026-06-07: 43 variants (Steel, 6–16mm width, 21–75cm length).
  // Primary = multi-width lineup shot (7th/last in CJ gallery = comparison image).
  // Silver Mandate met — all steel/silver.
  {
    id: 17,
    spu: 'CJLX1574470',
    title: 'STAINLESS STEEL CUBAN CHAIN',
    price: 99,
    shippingCostUSD: 8.00,   // CJ → Israel, heavy steel chain
    minRetailPriceILS: 99,   // market anchor — formula floor is ~₪55
    imageUrl: `${CJ}/343007a8-81ed-411e-b60d-63f08b3183d4.jpg`,
    description: 'Heavy stainless steel cuban chain. Select chain width: 6mm to 16mm.',
    variants: [
      { color: 'Steel', colorHex: '#A8A9AD', size: '6mm',  cost: 3.24, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '8mm',  cost: 5.16, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '10mm', cost: 5.82, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '12mm', cost: 6.36, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '14mm', cost: 7.28, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '16mm', cost: 9.80, imageUrl: `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg` },
    ],
    images: [
      `${CJ}/343007a8-81ed-411e-b60d-63f08b3183d4.jpg`,
      `${CJ}/f737cb87-9e26-4215-af24-032cb5bb980e.jpg`,
      `${CJ}/927156b9-7607-4fdc-a468-9991b4f0d081.jpg`,
      `${CJ}/7ebbea07-4e8f-4a13-bd5c-b0d38fcc6674.jpg`,
      `${CJ}/397f6cfd-1283-42e8-819a-0247af66e194.jpg`,
      `${CJ}/70e4eda3-3dd7-4ffd-abef-f4c75ce97133.jpg`,
      `${CJ}/2ae7190d-7790-4fe5-9685-e0179d6f4cbf.jpg`,
    ],
  },

  // ── ID 18: Retro Minimalist Braided Necklace ──────────────────────────────
  // CJ audit 2026-06-07: 3 variants (50cm, 55cm, 60cm). New gallery image 979b7792.
  // Primary = lifestyle shot of pendant being worn (3rd in CJ gallery order).
  {
    id: 18,
    spu: 'CJLX2853160',
    title: 'RETRO MINIMALIST BRAIDED NECKLACE',
    price: 49,
    shippingCostUSD: 5.20,   // CJ → Israel, verified from CJ dashboard
    minRetailPriceILS: 49,   // market anchor — formula floor is ~₪3
    imageUrl: `${CJ}/quick/product/a6c57b04-3681-491f-b173-0c230ca0e33b.jpg`,
    description: 'Retro titanium steel pendant on braided hemp rope chain. Select chain length.',
    variants: [
      { color: 'Steel', colorHex: '#A8A9AD', size: '50cm', cost: 0.53, imageUrl: `${CJ}/quick/product/a6c57b04-3681-491f-b173-0c230ca0e33b.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '55cm', cost: 0.56, imageUrl: `${CJ}/quick/product/a6c57b04-3681-491f-b173-0c230ca0e33b.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '60cm', cost: 0.60, imageUrl: `${CJ}/quick/product/a6c57b04-3681-491f-b173-0c230ca0e33b.jpg` },
    ],
    images: [
      `${CJ}/quick/product/a6c57b04-3681-491f-b173-0c230ca0e33b.jpg`,
      `${CJ}/quick/product/88af505d-2f06-4dc1-a84b-6cc0530a5c89.jpg`,
      `${CJ}/quick/product/5dc781e8-dec2-41ba-9be8-a56030ed5e99.jpg`,
      `${CJ}/quick/product/979b7792-1844-4d86-b2c2-e21e403a4f15.jpg`,
      `${CJ}/quick/product/ab570464-be14-4c6f-aae7-dab9f6ba90c4.jpg`,
    ],
  },

  // ── ID 19: Cold Wind Titanium Steel Bracelet ──────────────────────────────
  // CJ audit 2026-06-08: verified via pixel inspection.
  //   4187ed51 = GOLD (dark bg glamour)  |  abdd9fb4 = GOLD (white bg multi-size)
  //   2054/4883... = SILVER flat-lay     |  oss/cf0fe005 = BLACK 3mm
  // Wrist lifestyle shot as primary (silver 3mm on wrist — no text overlay)
  {
    id: 19,
    spu: 'CJZBLXSL06697',
    title: 'COLD WIND TITANIUM STEEL BRACELET',
    price: 59,
    shippingCostUSD: 5.50,   // CJ → Israel, lightweight bracelet
    minRetailPriceILS: 59,   // market anchor — formula floor is ~₪8
    imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg`,
    description: 'Cold Wind titanium steel cuban bracelet. Choose color (Silver/Gold/Black) and width (3–11mm).',
    variants: [
      // Silver — verified silver flat-lay
      { color: 'Silver', colorHex: '#C0C0C0', size: '3mm',  cost: 0.40, imageUrl: `${CJ}/2054/4883093832835.jpg` },
      { color: 'Silver', colorHex: '#C0C0C0', size: '5mm',  cost: 0.50, imageUrl: `${CJ}/2054/4883093832835.jpg` },
      { color: 'Silver', colorHex: '#C0C0C0', size: '7mm',  cost: 0.48, imageUrl: `${CJ}/2054/4883093832835.jpg` },
      { color: 'Silver', colorHex: '#C0C0C0', size: '9mm',  cost: 0.69, imageUrl: `${CJ}/2054/4883093832835.jpg` },
      { color: 'Silver', colorHex: '#C0C0C0', size: '11mm', cost: 0.91, imageUrl: `${CJ}/2054/4883093832835.jpg` },
      // Gold — verified gold glamour shot (dark background)
      { color: 'Gold',   colorHex: '#C8A900', size: '3mm',  cost: 0.57, imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg` },
      { color: 'Gold',   colorHex: '#C8A900', size: '5mm',  cost: 0.64, imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg` },
      { color: 'Gold',   colorHex: '#C8A900', size: '7mm',  cost: 0.86, imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg` },
      { color: 'Gold',   colorHex: '#C8A900', size: '9mm',  cost: 1.12, imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg` },
      { color: 'Gold',   colorHex: '#C8A900', size: '11mm', cost: 1.56, imageUrl: `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg` },
    ],
    images: [
      `${CJ}/2054/4883093832835.jpg`,
      `${CJ}/4187ed51-dcee-488c-b5ac-b8c0ef366dc0.jpg`,
      `${OSS}/2024/03/03/03/cf0fe005-a846-424b-b3fb-24358c5b43c3.jpg`,
      `${CJ}/abdd9fb4-c597-4452-9836-6a16d70cfca0.jpg`,
      `${CJ}/2054/8263353655468.jpg`,
      `${CJ}/2054/3272995108089.jpg`,
      `${CJ}/2054/2352174826971.jpg`,
      `${CJ}/2054/204161648596.jpg`,
      `${OSS}/2024/03/03/03/642aa9cb-2ecf-41fd-a85c-ebd627a849f8.jpg`,
    ],
  },

  // ── ID 20: Stainless Steel Stud Earring Set ───────────────────────────────
  // CJ audit 2026-06-08: verified via pixel inspection.
  //   324 = Steel  |  361 = Gold  |  320 = Black  |  362 = Colorful  |  364 = size diagram (gallery only)
  {
    id: 20,
    spu: 'CJLX1022452',
    title: 'STAINLESS STEEL STUD EARRING SET',
    price: 49,
    shippingCostUSD: 4.00,   // CJ → Israel, very lightweight earrings
    minRetailPriceILS: 49,   // market anchor — formula floor is ~₪10
    imageUrl: `${CJ}/1614328451324.jpg`,
    description: 'Stainless steel stud earring set. Available in Steel, Gold, Black, and Colorful finishes.',
    variants: [
      { color: 'Steel',    colorHex: '#A8A9AD', size: 'One Size', cost: 1.80, imageUrl: `${CJ}/1614328451324.jpg` },
      { color: 'Gold',     colorHex: '#C8A900', size: 'One Size', cost: 2.00, imageUrl: `${CJ}/1614328451361.jpg` },
      { color: 'Black',    colorHex: '#1A1A1A', size: 'One Size', cost: 1.99, imageUrl: `${CJ}/1614328451320.jpg` },
      { color: 'Colorful', colorHex: '#FF6B6B', size: 'One Size', cost: 1.69, imageUrl: `${CJ}/1614328451362.jpg` },
    ],
    images: [
      `${CJ}/1614328451324.jpg`,
      `${CJ}/1614328451361.jpg`,
      `${CJ}/1614328451320.jpg`,
      `${CJ}/1614328451362.jpg`,
      `${CJ}/1614328451364.jpg`,
    ],
  },

  // ── ID 21: Titanium Steel Zircon Studs ───────────────────────────────────
  // CJ audit 2026-06-07: 9 variants (Steel, 2–10mm diameter). 2 new gallery images.
  // Primary = 12ea4987 (row-of-studs hero shot). All 9 sizes now seeded.
  {
    id: 21,
    spu: 'CJLX1552176',
    title: 'TITANIUM STEEL ZIRCON STUDS',
    price: 59,
    shippingCostUSD: 4.00,   // CJ → Israel, very lightweight studs
    minRetailPriceILS: 59,   // market anchor — formula floor is ~₪16
    imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg`,
    description: 'Titanium steel crystal zircon stud earrings. Select diameter: 2mm to 10mm.',
    variants: [
      { color: 'Steel', colorHex: '#A8A9AD', size: '2mm',  cost: 1.90, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '3mm',  cost: 1.99, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '4mm',  cost: 2.18, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '5mm',  cost: 2.37, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '6mm',  cost: 2.56, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '7mm',  cost: 2.75, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '8mm',  cost: 2.94, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '9mm',  cost: 3.13, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
      { color: 'Steel', colorHex: '#A8A9AD', size: '10mm', cost: 3.17, imageUrl: `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg` },
    ],
    images: [
      `${CJ}/12ea4987-ca57-4c6e-926a-30c78e2ec8a7.jpg`,
      `${CJ}/1f59d679-1f7f-4076-b331-82479c85d47f.jpg`,
      `${CJ}/041d1f61-cc82-4ba0-a4d3-2746d154d7c4.jpg`,
      `${CJ}/7fb713c9-7ea4-41c4-b8ea-76b801ae6972.jpg`,
      `${CJ}/1aaa6a98-0d4f-4030-a18a-77d04dcc8959.jpg`,
      `${CJ}/4a6b8632-68fd-4903-8d43-8d73c0b3bb32.jpg`,
      `${CJ}/2589292b-7808-42da-af6c-5815d5621013.jpg`,
    ],
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

async function resolvePrimaryImage(token, spu, configuredImage) {
  // Canonical override: if an explicit imageUrl is configured for this SPU,
  // pin it directly. Avoids drift caused by CJ catalog reshuffles and keeps
  // production aligned with the verified CDN URLs the brand vetted.
  if (configuredImage) {
    return configuredImage;
  }

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

  throw new Error(`No imageUrl configured and CJ lookup yielded nothing for SPU ${spu}`);
}

/**
 * Idempotently seed the CJ hardware catalog (IDs 17-21) into the SQLite DB.
 *
 * Safe to call repeatedly. On Render the DB is ephemeral, so this MUST run on
 * every startup (called from backend/index.js after seedDropshipProducts).
 *
 * If `imageUrl` is configured per item, it's pinned directly (no network call).
 * If missing, we lazily mint a CJ access token and resolve from the live API.
 */
async function seedHardwareCatalog({ verbose = false } = {}) {
  const needsToken = HARDWARE_ITEMS.some((item) => !item.imageUrl);
  let token = null;
  if (needsToken) {
    try {
      token = await getCJAccessToken();
    } catch (err) {
      console.warn(`[hardware-seed] CJ token unavailable (${err.message}); items without configured imageUrl will be skipped.`);
    }
  }

  for (const item of HARDWARE_ITEMS) {
    let imageUrl;
    try {
      imageUrl = await resolvePrimaryImage(token, item.spu, item.imageUrl);
    } catch (err) {
      console.warn(`[hardware-seed] Skipping ID ${item.id} (${item.spu}): ${err.message}`);
      continue;
    }

    const description = item.description || `${item.title} - curated hardware drop sourced from CJ catalog SPU ${item.spu}.`;

    // For hardware IDs 17-21, overwrite atomically. Product 16 lives in
    // backend/index.js seedDropshipProducts() and is intentionally not touched here.
    await dbRun('DELETE FROM product_variants WHERE productId = ?', [item.id]);
    await dbRun('DELETE FROM products WHERE id = ?', [item.id]);

    const allImages = item.images || [imageUrl];
    const imagesJson = JSON.stringify({ allImages, variantImageMap: {} });

    await dbRun(
      `INSERT INTO products (id, title, description, price, priceUSD, imageUrl, images, type, printifyId, supplier_id, stock, supplierShippingCostUSD, minRetailPriceILS)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.title, description, item.price, null, imageUrl, imagesJson, 'dropship', item.spu, 'dropship', 999,
       item.shippingCostUSD ?? 6.0, item.minRetailPriceILS ?? item.price]
    );

    // `variants` is the canonical field (supports color + size + cost).
    // `colorVariants` is the legacy fallback for Silver/Gold-only items.
    const allVariants = item.variants || item.colorVariants || [{ color: 'Default', colorHex: null, size: 'One Size', cost: 0, imageUrl }];
    for (const v of allVariants) {
      await dbRun(
        `INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
        [item.id, item.spu, v.color, v.colorHex || null, v.size || 'One Size', item.price, v.cost || 0, 999, v.imageUrl || imageUrl]
      );
    }

    if (verbose) {
      console.log(`[hardware-seed] Seeded ID ${item.id} (${item.spu})`);
    }
  }

  if (verbose) {
    const rows = await dbAll('SELECT id, title, price, imageUrl, printifyId FROM products WHERE id BETWEEN 17 AND 21 ORDER BY id');
    console.log('\n=== Seeded Hardware Products ===');
    console.table(rows);

    const variants = await dbAll('SELECT productId, printifyVariantId, price, imageUrl FROM product_variants WHERE productId BETWEEN 17 AND 21 ORDER BY productId');
    console.log('\n=== Seeded Hardware Variants ===');
    console.table(variants);
  }

  return HARDWARE_ITEMS.length;
}

module.exports = { seedHardwareCatalog, HARDWARE_ITEMS };

// CLI entrypoint — preserved so `node backend/seed_cj_product.cjs` still works.
if (require.main === module) {
  seedHardwareCatalog({ verbose: true })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Hardware seed failed:', error.message);
      process.exit(1);
    });
}
