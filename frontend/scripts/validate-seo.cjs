const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  indexHtml: path.join(root, 'index.html'),
  appJsx: path.join(root, 'src', 'App.jsx'),
  robots: path.join(root, 'public', 'robots.txt'),
  sitemap: path.join(root, 'public', 'sitemap.xml')
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateIndexHtml(content) {
  assert(content.includes('name="google-site-verification"'), 'index.html is missing google-site-verification meta tag.');
  assert(content.includes('rel="canonical" href="https://dripstreetshop.com/"'), 'index.html is missing canonical homepage URL.');
  assert(content.includes('property="og:url" content="https://dripstreetshop.com/"'), 'index.html OG URL must be absolute.');
  assert(content.includes('property="og:image" content="https://dripstreetshop.com/brand/hero-full.png"'), 'index.html OG image must be absolute.');
}

function validateAppJsx(content) {
  assert(content.includes('type="application/ld+json"'), 'App.jsx is missing Product JSON-LD injection.');
  assert(content.includes('link rel="canonical"'), 'App.jsx is missing dynamic canonical tags.');
  assert(content.includes('https://schema.org/InStock') && content.includes('https://schema.org/OutOfStock'), 'App.jsx JSON-LD availability fields are incomplete.');
}

function validateRobots(content) {
  assert(content.includes('Sitemap: https://dripstreetshop.com/sitemap.xml'), 'robots.txt is missing absolute sitemap line.');
}

function validateSitemap(content) {
  assert(content.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap.xml is malformed: missing urlset root.');
  const locMatches = content.match(/<loc>(.*?)<\/loc>/g) || [];
  assert(locMatches.length > 0, 'sitemap.xml has no URL entries.');

  const nonAbsolute = locMatches
    .map((entry) => entry.replace('<loc>', '').replace('</loc>', '').trim())
    .filter((url) => !url.startsWith('https://dripstreetshop.com'));

  assert(nonAbsolute.length === 0, `sitemap.xml contains non-absolute URLs: ${nonAbsolute.join(', ')}`);
}

function run() {
  const indexHtml = read(files.indexHtml);
  const appJsx = read(files.appJsx);
  const robots = read(files.robots);
  const sitemap = read(files.sitemap);

  validateIndexHtml(indexHtml);
  validateAppJsx(appJsx);
  validateRobots(robots);
  validateSitemap(sitemap);

  console.log('SEO validation passed.');
}

try {
  run();
} catch (error) {
  console.error(`SEO validation failed: ${error.message}`);
  process.exit(1);
}
