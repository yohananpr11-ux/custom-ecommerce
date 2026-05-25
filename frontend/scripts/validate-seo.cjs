/**
 * validate-seo.cjs
 * ────────────────
 * Static SEO precondition checks. Run via `npm run seo:validate`.
 * Fails (non-zero exit) if index.html / App.jsx / robots.txt / sitemap.xml
 * are missing required tags or contain non-absolute URLs.
 *
 * Adjustments from the original Antigravity-generated version:
 *   - OG image is asserted against /brand/generated/og-image.png (the real
 *     Drip Street D mark on black). The original script asserted against
 *     /brand/hero-full.png which was a foreign OBSIDIAN poster — never
 *     deployed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  indexHtml: path.join(root, 'index.html'),
  appJsx:    path.join(root, 'src', 'App.jsx'),
  robots:    path.join(root, 'public', 'robots.txt'),
  sitemap:   path.join(root, 'public', 'sitemap.xml'),
};

const read = (filePath) => fs.readFileSync(filePath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const OG_IMAGE_URL = 'https://dripstreetshop.com/brand/generated/og-image.png';

function validateIndexHtml(content) {
  assert(content.includes('name="google-site-verification"'),
    'index.html is missing google-site-verification meta tag.');
  assert(content.includes('rel="canonical" href="https://dripstreetshop.com/"'),
    'index.html is missing canonical homepage URL.');
  assert(content.includes('property="og:url" content="https://dripstreetshop.com/"'),
    'index.html OG URL must be absolute.');
  assert(content.includes(`property="og:image" content="${OG_IMAGE_URL}"`),
    `index.html OG image must point to ${OG_IMAGE_URL}.`);
}

function validateAppJsx(content) {
  assert(content.includes('type="application/ld+json"'),
    'App.jsx is missing Product JSON-LD injection.');
  assert(content.includes('link rel="canonical"') || content.includes('rel="canonical"'),
    'App.jsx is missing dynamic canonical tags.');
  assert(content.includes('https://schema.org/InStock') && content.includes('https://schema.org/OutOfStock'),
    'App.jsx JSON-LD availability fields are incomplete.');
  assert(!content.includes('hero-full.png'),
    'App.jsx still references the deprecated /brand/hero-full.png (OBSIDIAN poster). Replace with /brand/generated/og-image.png.');
}

function validateRobots(content) {
  assert(content.includes('Sitemap: https://dripstreetshop.com/sitemap.xml'),
    'robots.txt is missing absolute sitemap line.');
}

function validateSitemap(content) {
  assert(content.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
    'sitemap.xml is malformed: missing urlset root.');
  const locMatches = content.match(/<loc>(.*?)<\/loc>/g) || [];
  assert(locMatches.length > 0, 'sitemap.xml has no URL entries.');
  const nonAbsolute = locMatches
    .map((entry) => entry.replace('<loc>', '').replace('</loc>', '').trim())
    .filter((url) => !url.startsWith('https://dripstreetshop.com'));
  assert(nonAbsolute.length === 0,
    `sitemap.xml contains non-absolute URLs: ${nonAbsolute.join(', ')}`);
}

function validatePrerender() {
  const distProductDir = path.join(root, 'dist', 'product');
  if (!fs.existsSync(distProductDir)) {
    console.warn('  (prerender check skipped — dist/product/ not built yet; run npm run build first)');
    return;
  }
  const subdirs = fs.readdirSync(distProductDir)
    .filter((d) => fs.statSync(path.join(distProductDir, d)).isDirectory());
  assert(subdirs.length > 0,
    'dist/product/ exists but is empty. The prerender step did not produce any pages.');
  // Sanity-check the first prerendered page.
  const sampleDir = path.join(distProductDir, subdirs[0], 'index.html');
  assert(fs.existsSync(sampleDir),
    `Expected ${sampleDir} to exist but it does not.`);
  const sampleHtml = fs.readFileSync(sampleDir, 'utf8');
  assert(sampleHtml.includes('application/ld+json'),
    `dist/product/${subdirs[0]}/index.html is missing JSON-LD <script>.`);
  assert(sampleHtml.includes('"@type":"Product"') || sampleHtml.includes('"@type": "Product"'),
    `dist/product/${subdirs[0]}/index.html JSON-LD does not declare @type=Product.`);
  assert(/<meta\s+property="og:type"\s+content="product"/i.test(sampleHtml),
    `dist/product/${subdirs[0]}/index.html is missing og:type=product.`);
  console.log(`  prerender check: ${subdirs.length} product page(s) prerendered.`);
}

function run() {
  validateIndexHtml(read(files.indexHtml));
  validateAppJsx(read(files.appJsx));
  validateRobots(read(files.robots));
  validateSitemap(read(files.sitemap));
  validatePrerender();
  console.log('SEO validation passed.');
}

try { run(); } catch (error) {
  console.error(`SEO validation failed: ${error.message}`);
  process.exit(1);
}
