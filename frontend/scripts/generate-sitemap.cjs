const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://dripstreetshop.com';
const API_BASE = 'https://custom-ecommerce-qp30.onrender.com';
const PUBLIC_DIR = path.join(__dirname, '../public');
const DIST_DIR = path.join(__dirname, '../dist');
const DB_PATH = path.resolve(__dirname, '../../backend/ecommerce.db');

// Static routes that should always be indexed.
const STATIC_ROUTES = [
  '/',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/refund',
  '/shipping',
];

function fetchProductIdsFromDb() {
  return new Promise((resolve) => {
    let sqlite3;
    try {
      // The sqlite3 binary lives under backend/node_modules so we resolve from there.
      sqlite3 = require(path.resolve(__dirname, '../../backend/node_modules/sqlite3'));
    } catch (err) {
      console.warn(`[sitemap] sqlite3 not available locally (${err.message}); will try API fallback.`);
      return resolve(null);
    }

    if (!fs.existsSync(DB_PATH)) {
      console.warn(`[sitemap] No local DB at ${DB_PATH}; will try API fallback.`);
      return resolve(null);
    }

    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) {
        console.warn(`[sitemap] Could not open SQLite DB (${openErr.message}); will try API fallback.`);
        return resolve(null);
      }

      db.all('SELECT id FROM products ORDER BY id ASC', [], (queryErr, rows) => {
        db.close();
        if (queryErr) {
          console.warn(`[sitemap] SQLite query failed (${queryErr.message}); will try API fallback.`);
          return resolve(null);
        }
        const ids = (rows || [])
          .map((row) => Number(row && row.id))
          .filter((id) => Number.isInteger(id) && id > 0);
        console.log(`[sitemap] Loaded ${ids.length} product IDs directly from SQLite.`);
        resolve(ids);
      });
    });
  });
}

function fetchProductIdsFromApi() {
  return new Promise((resolve, reject) => {
    https
      .get(`${API_BASE}/api/products/active-ids`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const payload = JSON.parse(data);
            if (Array.isArray(payload)) {
              return resolve(
                payload
                  .map((entry) => Number(entry && entry.id))
                  .filter((id) => Number.isInteger(id) && id > 0)
              );
            }
            if (payload && Array.isArray(payload.ids)) {
              return resolve(
                payload.ids
                  .map((id) => Number(id))
                  .filter((id) => Number.isInteger(id) && id > 0)
              );
            }
            resolve([]);
          } catch (e) {
            reject(new Error(`Failed to parse active product IDs: ${e.message}`));
          }
        });
      })
      .on('error', (err) => reject(err));
  });
}

async function resolveProductIds() {
  const fromDb = await fetchProductIdsFromDb();
  if (fromDb && fromDb.length) return fromDb;

  console.log('[sitemap] Falling back to live API for product IDs...');
  try {
    const fromApi = await fetchProductIdsFromApi();
    console.log(`[sitemap] Loaded ${fromApi.length} product IDs from live API.`);
    return fromApi;
  } catch (err) {
    console.warn(`[sitemap] API fallback failed (${err.message}); proceeding with static-only sitemap.`);
    return [];
  }
}

function buildSitemapXml(productIds) {
  const currentDate = new Date().toISOString().split('T')[0];
  const entries = [];

  for (const route of STATIC_ROUTES) {
    entries.push({
      loc: `${BASE_URL}${route === '/' ? '' : route}`,
      lastmod: currentDate,
      changefreq: route === '/' ? 'daily' : 'weekly',
      priority: route === '/' ? '1.0' : '0.8',
    });
  }

  for (const productId of productIds) {
    entries.push({
      loc: `${BASE_URL}/product/${productId}`,
      lastmod: currentDate,
      changefreq: 'weekly',
      priority: '0.9',
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
}

function writeIfExists(dir, filename, content) {
  if (!fs.existsSync(dir)) return false;
  const target = path.join(dir, filename);
  fs.writeFileSync(target, content, 'utf8');
  console.log(`[sitemap] Wrote ${target}`);
  return true;
}

(async () => {
  try {
    const productIds = await resolveProductIds();
    const xml = buildSitemapXml(productIds);

    // public/ is the canonical source — Vite copies it into dist on build.
    if (!fs.existsSync(PUBLIC_DIR)) {
      fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), xml, 'utf8');
    console.log(`[sitemap] Wrote ${path.join(PUBLIC_DIR, 'sitemap.xml')}`);

    // Also write to dist/ when it already exists (post-build runs).
    writeIfExists(DIST_DIR, 'sitemap.xml', xml);

    const total = STATIC_ROUTES.length + productIds.length;
    console.log(`[sitemap] Generated sitemap.xml with ${total} URLs (${STATIC_ROUTES.length} static + ${productIds.length} products).`);
  } catch (err) {
    console.error('[sitemap] FATAL:', err);
    process.exit(1);
  }
})();
