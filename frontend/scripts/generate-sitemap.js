import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function fetchProducts() {
  return new Promise((resolve, reject) => {
    https.get(`${API_BASE}/api/products`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const products = JSON.parse(data);
          resolve(Array.isArray(products) ? products : []);
        } catch (e) {
          reject(new Error(`Failed to parse product data: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  console.log('Fetching products to generate sitemap...');
  let products = [];
  try {
    products = await fetchProducts();
    console.log(`Fetched ${products.length} products successfully.`);
  } catch (error) {
    console.warn(`Could not fetch products from API (${error.message}). Falling back to static routes only.`);
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
  for (const product of products) {
    if (product && product.id) {
      sitemapUrls.push({
        loc: `${BASE_URL}/product/${product.id}`,
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
