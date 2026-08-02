/**
 * generate-catalog-fallback.cjs
 * Writes public/catalog-fallback.json from the live API.
 * Runs at build time. If the API is unreachable, keeps the existing file.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUT = path.join(__dirname, '../public/catalog-fallback.json');
const SLIM_FIELDS = ['id','title','price','priceUSD','imageUrl','backImageUrl','type','supplier_id','stock','category','tags'];

// Try local dev backend first, fall back to production
const ENDPOINTS = [
  'http://localhost:3001/api/products',
  'https://custom-ecommerce-qp30.onrender.com/api/products',
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  for (const url of ENDPOINTS) {
    try {
      const data = await fetchJSON(url);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.products) ? data.products : []);
      if (arr.length === 0) continue;
      const slim = arr.map(p => {
        const out = {};
        SLIM_FIELDS.forEach(k => { if (p[k] !== undefined) out[k] = p[k]; });
        return out;
      });
      fs.writeFileSync(OUT, JSON.stringify(slim, null, 2));
      console.log(`[catalog-fallback] wrote ${slim.length} products from ${url}`);
      return;
    } catch (e) {
      console.warn(`[catalog-fallback] ${url} → ${e.message}`);
    }
  }
  if (fs.existsSync(OUT)) {
    console.log('[catalog-fallback] all endpoints unreachable — keeping existing file');
  } else {
    console.warn('[catalog-fallback] no fallback file and no API — skipping');
  }
}

main();
