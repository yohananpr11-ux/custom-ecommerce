/**
 * validate-seo.cjs
 * ────────────────
 * Post-build SEO validation. Run via `npm run seo:validate`.
 *
 * Checks performed:
 *   1. index.html  — google-site-verification, canonical, og:url, og:image
 *   2. App.jsx     — JSON-LD injection, canonical tags, InStock/OutOfStock, no deprecated assets
 *   3. robots.txt  — absolute Sitemap line
 *   4. sitemap.xml — urlset root, ≥1 <loc>, all URLs absolute
 *   5. dist/product/{id}/index.html (up to 3 pages) — DEEP CHECK:
 *        og:title, og:description, og:image, og:url, og:type=product
 *        JSON-LD @type=Product, price, priceCurrency, availability
 *
 * Exit 0 = all checks passed. Exit 1 = at least one check failed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const root  = path.join(__dirname, '..');
const files = {
  indexHtml : path.join(root, 'index.html'),
  appJsx    : path.join(root, 'src', 'App.jsx'),
  robots    : path.join(root, 'public', 'robots.txt'),
  sitemap   : path.join(root, 'public', 'sitemap.xml'),
};

// Phase 11.1: canonical OG image is now the new metallic D brand logo.
const OG_IMAGE_URL = 'https://dripstreetshop.com/logo-new.png';

// ── helpers ──────────────────────────────────────────────────────────────────

const read   = (p) => fs.readFileSync(p, 'utf8');
let   errors = 0;

function pass(msg)  { console.log(`  ✅  ${msg}`); }
function fail(msg)  { console.error(`  ❌  ${msg}`); errors++; }
function check(cond, passMsg, failMsg) { cond ? pass(passMsg) : fail(failMsg); }
function section(label) { console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`); }

// ── 1. index.html ─────────────────────────────────────────────────────────────

function validateIndexHtml(content) {
  section('index.html');
  check(
    content.includes('name="google-site-verification"'),
    'google-site-verification present',
    'MISSING google-site-verification meta tag'
  );
  check(
    content.includes('rel="canonical" href="https://dripstreetshop.com/"'),
    'canonical homepage URL present',
    'MISSING canonical homepage URL'
  );
  check(
    content.includes('property="og:url" content="https://dripstreetshop.com/"'),
    'og:url is absolute',
    'og:url is missing or not absolute'
  );
  check(
    content.includes(`property="og:image" content="${OG_IMAGE_URL}"`),
    `og:image → ${OG_IMAGE_URL}`,
    `og:image must point to ${OG_IMAGE_URL}`
  );
}

// ── 2. App.jsx ────────────────────────────────────────────────────────────────

function validateAppJsx(content) {
  section('App.jsx (source)');
  check(
    content.includes('type="application/ld+json"'),
    'Product JSON-LD injection found',
    'MISSING application/ld+json script in App.jsx'
  );
  check(
    content.includes('rel="canonical"'),
    'Dynamic canonical tags found',
    'MISSING dynamic canonical tags in App.jsx'
  );
  check(
    content.includes('https://schema.org/InStock') && content.includes('https://schema.org/OutOfStock'),
    'InStock + OutOfStock availability both declared',
    'JSON-LD availability fields incomplete (need both InStock and OutOfStock)'
  );
  check(
    !content.includes('hero-full.png'),
    'No deprecated hero-full.png reference',
    'DEPRECATED: App.jsx still references /brand/hero-full.png'
  );
  check(
    content.includes('og:title') && content.includes('og:description') && content.includes('og:image'),
    'OG tags (title/description/image) all present in App.jsx',
    'One or more OG tags missing in App.jsx (og:title / og:description / og:image)'
  );
  check(
    content.includes('handleEmailBlur') && content.includes('onBlur={handleEmailBlur}'),
    'Abandoned-cart email blur handler wired',
    'MISSING handleEmailBlur / onBlur on checkout email input'
  );
}

// ── 3. robots.txt ─────────────────────────────────────────────────────────────

function validateRobots(content) {
  section('robots.txt');
  check(
    content.includes('Sitemap: https://dripstreetshop.com/sitemap.xml'),
    'Absolute sitemap directive present',
    'MISSING absolute Sitemap directive'
  );
}

// ── 4. sitemap.xml ────────────────────────────────────────────────────────────

function validateSitemap(content) {
  section('sitemap.xml');
  check(
    content.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
    'urlset root well-formed',
    'sitemap.xml malformed: missing urlset root'
  );
  const locs = (content.match(/<loc>(.*?)<\/loc>/g) || [])
    .map((e) => e.replace('<loc>', '').replace('</loc>', '').trim());
  check(locs.length > 0, `${locs.length} <loc> entries found`, 'sitemap.xml has no <loc> entries');
  const bad = locs.filter((u) => !u.startsWith('https://dripstreetshop.com'));
  check(bad.length === 0, 'All <loc> URLs are absolute', `Non-absolute URLs: ${bad.join(', ')}`);
}

// ── 5. Prerendered product pages (DEEP CHECK) ─────────────────────────────────

function validatePrerenderedPage(htmlPath, label) {
  const html = read(htmlPath);

  // Parse JSON-LD block(s)
  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  let productLd = null;
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed['@type'] === 'Product') { productLd = parsed; break; }
    } catch (_) { /* ignore malformed */ }
  }

  // OG checks
  check(/<meta\s+property="og:title"\s+content="[^"]+"/i.test(html),
    `[${label}] og:title present`, `[${label}] MISSING og:title`);
  check(/<meta\s+property="og:description"\s+content="[^"]+"/i.test(html),
    `[${label}] og:description present`, `[${label}] MISSING og:description`);
  check(/<meta\s+property="og:image"\s+content="https?:\/\/[^"]+"/i.test(html),
    `[${label}] og:image is absolute URL`, `[${label}] og:image MISSING or not absolute`);
  check(/<meta\s+property="og:url"\s+content="https?:\/\/[^"]+"/i.test(html),
    `[${label}] og:url is absolute URL`, `[${label}] og:url MISSING or not absolute`);
  check(/<meta\s+property="og:type"\s+content="product"/i.test(html),
    `[${label}] og:type=product`, `[${label}] og:type MISSING or not "product"`);

  // JSON-LD checks
  check(productLd !== null,
    `[${label}] JSON-LD @type=Product found`, `[${label}] MISSING JSON-LD @type=Product`);
  if (productLd) {
    const offers = productLd.offers || {};
    check(
      offers.price !== undefined && offers.price !== null,
      `[${label}] JSON-LD price=${offers.price}`,
      `[${label}] JSON-LD offers.price MISSING`
    );
    check(
      typeof offers.priceCurrency === 'string' && offers.priceCurrency.length === 3,
      `[${label}] JSON-LD priceCurrency=${offers.priceCurrency}`,
      `[${label}] JSON-LD offers.priceCurrency MISSING or invalid`
    );
    check(
      typeof offers.availability === 'string' && offers.availability.includes('schema.org'),
      `[${label}] JSON-LD availability=${offers.availability}`,
      `[${label}] JSON-LD offers.availability MISSING or invalid`
    );
  }
}

function validatePrerender() {
  section('Prerendered product pages (dist/product/)');
  const distProductDir = path.join(root, 'dist', 'product');
  if (!fs.existsSync(distProductDir)) {
    console.warn('  ⚠  dist/product/ not found — run `npm run build` first (skipping deep check)');
    return;
  }
  const subdirs = fs.readdirSync(distProductDir)
    .filter((d) => fs.statSync(path.join(distProductDir, d)).isDirectory());

  if (subdirs.length === 0) {
    fail('dist/product/ is empty — prerender step produced no pages');
    return;
  }
  console.log(`  Found ${subdirs.length} prerendered product page(s). Deep-checking first 3...\n`);

  // Deep-check up to 3 product pages
  const sample = subdirs.slice(0, 3);
  for (const id of sample) {
    const htmlPath = path.join(distProductDir, id, 'index.html');
    if (!fs.existsSync(htmlPath)) {
      fail(`dist/product/${id}/index.html not found`);
      continue;
    }
    validatePrerenderedPage(htmlPath, `product/${id}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Drip Street — SEO Build-Time Validation             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  validateIndexHtml(read(files.indexHtml));
  validateAppJsx(read(files.appJsx));
  validateRobots(read(files.robots));
  validateSitemap(read(files.sitemap));
  validatePrerender();

  section('Result');
  if (errors === 0) {
    console.log('\n  🎉  All SEO checks passed — ready for deploy.\n');
  } else {
    console.error(`\n  ✗  ${errors} check(s) failed. Fix the above before deploying.\n`);
    process.exit(1);
  }
}

try { run(); } catch (err) {
  console.error(`\nFatal error in validate-seo: ${err.message}`);
  process.exit(1);
}
