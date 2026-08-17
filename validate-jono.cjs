/**
 * Phase 3 Validation — JONO Production Readiness
 * Checks:
 * 1. Backend /api/products returns 17+ products
 * 2. Products 16-21 have distinct, non-duplicate image URLs
 * 3. All CJ dropship image URLs return HTTP 200
 * 4. No two products share the same imageUrl
 */
const http = require('http');
const https = require('https');

const BACKEND = 'http://localhost:3001';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function head(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'HEAD', timeout: 8000 };
    const req = lib.request(opts, (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function run() {
  console.log('=== JONO Phase 3 Validation ===\n');
  let passed = 0, failed = 0;

  // 1. Backend connectivity
  let products;
  try {
    const resp = await fetch(`${BACKEND}/api/products`);
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const data = JSON.parse(resp.body);
    products = data.products || data;
    if (!Array.isArray(products)) throw new Error('products is not array');
    console.log(`[PASS] Backend /api/products → ${products.length} products`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] Backend /api/products: ${e.message}`);
    failed++;
    process.exit(1);
  }

  // 2. Total product count
  if (products.length >= 17) {
    console.log(`[PASS] Total products ≥ 17: ${products.length}`);
    passed++;
  } else {
    console.log(`[FAIL] Total products < 17: ${products.length}`);
    failed++;
  }

  // 3. Products 16-21 exist and have distinct images
  console.log('\n--- Dropship products 16-21 ---');
  const dropshipIds = [16, 17, 18, 19, 20, 21];
  const dropshipImages = {};
  let allDistinct = true;
  for (const id of dropshipIds) {
    const p = products.find(x => Number(x.id) === id);
    if (!p) {
      console.log(`[FAIL] Product ID ${id} NOT FOUND`);
      failed++;
      continue;
    }
    const img = p.imageUrl || '';
    dropshipImages[id] = img;
    console.log(`  ID ${id} (${p.title?.substring(0, 30)}): ${img.substring(0, 70)}`);
    passed++;
  }

  // Check for duplicates among 16-21
  const imageValues = Object.values(dropshipImages);
  const uniqueImages = new Set(imageValues);
  if (uniqueImages.size === imageValues.length) {
    console.log(`\n[PASS] All ${dropshipIds.length} dropship images are distinct`);
    passed++;
  } else {
    const dupes = imageValues.filter((v, i) => imageValues.indexOf(v) !== i);
    console.log(`\n[FAIL] Duplicate images detected: ${dupes.join(', ')}`);
    failed++;
    allDistinct = false;
  }

  // Check ID 16 and 17 are not the same
  if (dropshipImages[16] && dropshipImages[17] && dropshipImages[16] !== dropshipImages[17]) {
    console.log(`[PASS] ID 16 and 17 have distinct images`);
    passed++;
  } else {
    console.log(`[FAIL] ID 16 and 17 share the same image URL`);
    failed++;
  }

  // 4. Verify CJ CDN image URLs return HTTP 200
  console.log('\n--- CJ CDN URL reachability ---');
  const cjImages = Object.values(dropshipImages).filter(u => u && u.includes('cjdropshipping'));
  for (const url of cjImages) {
    try {
      const status = await head(url);
      if (status === 200) {
        console.log(`[PASS] ${status} ${url.substring(0, 75)}`);
        passed++;
      } else {
        console.log(`[FAIL] ${status} ${url.substring(0, 75)}`);
        failed++;
      }
    } catch (e) {
      console.log(`[FAIL] ERR ${url.substring(0, 75)} — ${e.message}`);
      failed++;
    }
  }

  // 5. No two products in the FULL catalog share imageUrl (spot check top 21)
  console.log('\n--- Global image uniqueness (first 21 products) ---');
  const first21 = products.filter(p => Number(p.id) <= 21);
  const seen = {};
  let globalDupes = 0;
  for (const p of first21) {
    const url = p.imageUrl;
    if (!url) continue;
    if (seen[url] !== undefined) {
      console.log(`[FAIL] ID ${p.id} shares imageUrl with ID ${seen[url]}: ${url.substring(0, 60)}`);
      failed++;
      globalDupes++;
    } else {
      seen[url] = p.id;
    }
  }
  if (globalDupes === 0) {
    console.log(`[PASS] No duplicate imageUrls in products 1-21`);
    passed++;
  }

  console.log(`\n=== Results: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
