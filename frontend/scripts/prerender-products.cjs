/**
 * prerender-products.cjs
 * ──────────────────────
 * Post-build step that turns each product into a real static HTML file
 * containing product-specific <title>, meta, OG/Twitter cards, and a full
 * Product JSON-LD block — all baked into the source HTML so it is visible
 * to social-share bots and JS-disabled crawlers, not only to Googlebot.
 *
 * How it works:
 *   1. Reads the freshly built dist/index.html as a template (already has
 *      the React bundle <script> tags + the favicons + the homepage meta).
 *   2. Fetches the live product catalog from the storefront API.
 *   3. For each product, surgically rewrites the head meta tags and injects
 *      a JSON-LD <script> block, then writes to dist/product/{id}/index.html.
 *   4. Vercel serves static files before rewrites, so requests to
 *      /product/{id} naturally land on the prerendered file. Everything
 *      else still falls through the SPA fallback.
 *
 * Run via: `node scripts/prerender-products.cjs` — automatically wired into
 * `npm run build` so deploys always include the latest product set.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const DIST_DIR     = path.join(__dirname, '..', 'dist');
const TEMPLATE     = path.join(DIST_DIR, 'index.html');
const API_BASE     = process.env.PRERENDER_API_BASE || 'https://custom-ecommerce-qp30.onrender.com';
const SITE_BASE    = process.env.PRERENDER_SITE_BASE || 'https://dripstreetshop.com';
const FALLBACK_OG  = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=80';
const FETCH_TIMEOUT_MS = 15000;

function fetchProducts() {
  return new Promise((resolve, reject) => {
    const req = https.get(`${API_BASE}/api/products`, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`API returned HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          reject(new Error(`Bad JSON from API: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`API call timed out after ${FETCH_TIMEOUT_MS}ms`));
    });
  });
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function buildMeta(product) {
  const id     = product.id;
  const url    = `${SITE_BASE}/product/${id}`;
  const name   = String(product.title || '').trim() || `Drip Street item #${id}`;
  const title  = `${name} | Drip Street`;
  // Description: prefer description, then truncated title, never empty.
  const rawDesc = (product.description || '').trim();
  const description = (rawDesc.length > 0 ? rawDesc.slice(0, 200) :
    `Shop ${name} at Drip Street. Premium minimal streetwear, worldwide shipping.`);

  // Image: prefer first product image, absolute-ize if needed, fallback to OG.
  let image = product.imageUrl || product.backImageUrl || FALLBACK_OG;
  image = image.startsWith('http') ? image : `${SITE_BASE}${image}`;

  const price = Number(product.price);
  const hasPrice = Number.isFinite(price) && price > 0;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    'name': name,
    'image': image,
    'description': description,
    'sku': String(id),
    'brand': { '@type': 'Brand', 'name': 'Drip Street' },
    'offers': {
      '@type': 'Offer',
      'url': url,
      'priceCurrency': 'USD',
      'price': hasPrice ? price.toFixed(2) : undefined,
      'availability': 'https://schema.org/InStock',
    },
  };

  return { id, url, title, description, image, jsonLd };
}

/** Replace a tag whose opening pattern matches `re`. If no match, append before </head>. */
function replaceOrInject(html, re, replacement) {
  if (re.test(html)) return html.replace(re, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
}

function rewriteHead(template, m) {
  let out = template;
  out = replaceOrInject(out, /<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);
  out = replaceOrInject(out, /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${esc(m.description)}" />`);
  out = replaceOrInject(out, /<link\s+rel="canonical"[^>]*\/?>/i,
    `<link rel="canonical" href="${m.url}" />`);
  out = replaceOrInject(out, /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${esc(m.title)}" />`);
  out = replaceOrInject(out, /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${esc(m.description)}" />`);
  out = replaceOrInject(out, /<meta\s+property="og:url"[^>]*\/?>/i,
    `<meta property="og:url" content="${m.url}" />`);
  out = replaceOrInject(out, /<meta\s+property="og:type"[^>]*\/?>/i,
    `<meta property="og:type" content="product" />`);
  out = replaceOrInject(out, /<meta\s+property="og:image"\s+content="[^"]*"[^>]*\/?>/i,
    `<meta property="og:image" content="${m.image}" />`);
  out = replaceOrInject(out, /<meta\s+name="twitter:image"[^>]*\/?>/i,
    `<meta name="twitter:image" content="${m.image}" />`);

  // Always inject JSON-LD fresh before </head>.
  const jsonLdScript =
    `    <script type="application/ld+json">${JSON.stringify(m.jsonLd)}</script>\n  </head>`;
  out = out.replace('</head>', jsonLdScript);

  return out;
}

async function main() {
  console.log('\n[prerender-products] starting...');
  if (!fs.existsSync(TEMPLATE)) {
    console.error(`  ✗ Template missing: ${TEMPLATE}`);
    console.error(`  Did you run 'vite build' first?`);
    process.exit(1);
  }
  const template = fs.readFileSync(TEMPLATE, 'utf8');

  let products = [];
  try {
    products = await fetchProducts();
  } catch (err) {
    console.warn(`  ⚠ Could not fetch products (${err.message}). Trying fallback file...`);
  }

  if (!products || !products.length) {
    console.log('  🔄 Fetch empty or failed. Loading local products fallback...');
    const fallbackPath = path.join(__dirname, 'products_fallback.json');
    if (fs.existsSync(fallbackPath)) {
      try {
        products = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        console.log(`  ✓ Loaded ${products.length} products from products_fallback.json.`);
      } catch (err) {
        console.error(`  ✗ Failed to parse products_fallback.json: ${err.message}`);
      }
    } else {
      console.warn('  ⚠ products_fallback.json not found. Nothing to prerender.');
      return;
    }
  }

  console.log(`  Fetched ${products.length} products. Writing prerendered pages...`);

  let written = 0;
  for (const product of products) {
    if (!product || !product.id) continue;
    const meta = buildMeta(product);
    const html = rewriteHead(template, meta);
    const outDir = path.join(DIST_DIR, 'product', String(meta.id));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    written += 1;
    console.log(`  ✓ /product/${meta.id} → ${meta.title.slice(0, 64)}`);
  }

  console.log(`\n[prerender-products] wrote ${written} pages to dist/product/\n`);
}

main().catch((err) => {
  console.error('[prerender-products] failed:', err.message);
  process.exit(1);
});
