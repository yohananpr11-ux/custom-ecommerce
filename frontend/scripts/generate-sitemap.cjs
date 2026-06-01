const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://custom-ecommerce-qp30.onrender.com';
const BASE_URL = 'https://dripstreetshop.com';
const PUBLIC_DIR = path.join(__dirname, '../public');

// Static routes
const STATIC_ROUTES = [
  '/',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/refund',
  '/shipping'
];

function fetchActiveProductIds() {
  return new Promise((resolve, reject) => {
    https.get(`${API_BASE}/api/products/active-ids`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (Array.isArray(payload)) {
            resolve(payload.map((entry) => Number(entry && entry.id)).filter((id) => Number.isInteger(id) && id > 0));
            return;
          }
          if (payload && Array.isArray(payload.ids)) {
            resolve(payload.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
            return;
          }
          resolve([]);
        } catch (e) {
          reject(new Error(`Failed to parse active product IDs: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  console.log('Fetching active product IDs from DB to generate sitemap...');
  let productIds = [];
  try {
    productIds = await fetchActiveProductIds();
    console.log(`Fetched ${productIds.length} active product IDs successfully.`);
  } catch (error) {
    console.warn(`Could not fetch active product IDs from API (${error.message}). Falling back to static routes only.`);
  }

  const currentDate = new Date().toISOString().split('T')[0];

  const sitemapUrls = [];

  // Add static routes
  for (const route of STATIC_ROUTES) {
    sitemapUrls.push({
      loc: `${BASE_URL}${route === '/' ? '' : route}`,
      lastmod: currentDate,
      changefreq: route === '/' ? 'daily' : 'weekly',
      priority: route === '/' ? '1.0' : '0.8'
    });
  }

  // Add dynamic product routes
  for (const productId of productIds) {
    if (productId) {
      sitemapUrls.push({
        loc: `${BASE_URL}/product/${productId}`,
        lastmod: currentDate,
        changefreq: 'weekly',
        priority: '0.9'
      });
    }
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(url => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  const sitemapPath = path.join(PUBLIC_DIR, 'sitemap.xml');
  fs.writeFileSync(sitemapPath, sitemapXml, 'utf8');
  console.log(`Successfully generated sitemap.xml with ${sitemapUrls.length} links at ${sitemapPath}`);
}

run().catch((err) => {
  console.error('Error generating sitemap:', err);
  process.exit(1);
});
