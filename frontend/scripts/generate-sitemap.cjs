const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://dripstreetshop.com';
const PUBLIC_DIR = path.join(__dirname, '../public');
const DIST_DIR = path.join(__dirname, '../dist');
const DB_PATH = path.resolve(__dirname, '../../backend/ecommerce.db');

// SITEMAP_REQUIRE_API=true is a strict, all-or-nothing mode for hermetic
// CI/test runs: the API (redirected via SITEMAP_API_BASE, see below) is the
// ONLY source of truth. No local-SQLite fallback, no falling back to an
// empty/static product list, no silently-successful sitemap missing the
// seeded fixture — any failure (missing API base, unreachable API, timeout,
// non-2xx, invalid JSON, unexpected payload shape, or zero product IDs)
// exits non-zero. Default (unset) behavior is completely unchanged: try the
// local DB first, then the API, degrading gracefully to a static-only
// sitemap if both are unavailable — matching this script's original,
// production-safe design.
const REQUIRE_API = process.env.SITEMAP_REQUIRE_API === 'true';

if (REQUIRE_API && !(process.env.SITEMAP_API_BASE && process.env.SITEMAP_API_BASE.trim())) {
  console.error('[sitemap] FATAL: SITEMAP_REQUIRE_API=true requires SITEMAP_API_BASE to be explicitly set.');
  process.exit(1);
}

/**
 * Validates and normalizes an API base URL via the URL parser (rejects
 * anything that isn't a well-formed http:/https: origin) and strips any
 * trailing slash, so `${API_BASE}/api/...` call sites can never produce an
 * accidental "//".
 */
function normalizeApiBase(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error(`invalid API base URL "${raw}": ${e.message}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`invalid API base URL "${raw}": protocol must be http: or https:, got "${parsed.protocol}"`);
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

// SAFETY: the hardcoded production URL below must only ever be reached
// during a REAL platform deployment build -- Vercel sets VERCEL=1 and
// Render sets RENDER=true automatically in every build/runtime environment
// they control, so their presence is a reliable, allow-list-based signal
// that this script is genuinely running inside that platform's own build,
// not on a developer machine or in an offline/local verification run. A
// prior incident found that running `npm run build` locally with neither a
// local DB nor SITEMAP_API_BASE set silently made a real, unauthenticated
// GET request to the live production backend -- the previous design was
// deny-list-based (anything not explicitly hermetic fell through to
// production); this is now allow-list-based (only a recognized deploy
// platform, or an explicit override, may ever use the production URL).
// Local/offline runs still degrade gracefully to a static-only sitemap
// (see resolveProductIds() below) -- they simply never attempt the network
// call that would otherwise silently reach production.
const ON_KNOWN_DEPLOY_PLATFORM = process.env.VERCEL === '1' || process.env.RENDER === 'true';
const HAS_EXPLICIT_API_BASE = Boolean(process.env.SITEMAP_API_BASE && process.env.SITEMAP_API_BASE.trim());

if (REQUIRE_API && !HAS_EXPLICIT_API_BASE) {
  // Already fatal above (line ~21) for the strict/CI path -- unreachable in
  // practice, kept only so API_BASE resolution below never has to consider
  // "REQUIRE_API but no base and not on a platform" as a live case.
  console.error('[sitemap] FATAL: SITEMAP_REQUIRE_API=true requires SITEMAP_API_BASE to be explicitly set.');
  process.exit(1);
}

const CAN_USE_PRODUCTION_FALLBACK = HAS_EXPLICIT_API_BASE || ON_KNOWN_DEPLOY_PLATFORM || REQUIRE_API;

let API_BASE = null;
if (CAN_USE_PRODUCTION_FALLBACK) {
  const RAW_API_BASE = process.env.SITEMAP_API_BASE || 'https://custom-ecommerce-qp30.onrender.com';
  try {
    API_BASE = normalizeApiBase(RAW_API_BASE);
  } catch (err) {
    console.error(`[sitemap] FATAL: ${err.message}`);
    process.exit(1);
  }
}

/** Validated, bounded fetch timeout — never hangs CI indefinitely. */
function parseTimeoutMs(raw) {
  if (raw === undefined || raw === '') return 10000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid SITEMAP_API_TIMEOUT_MS "${raw}" (must be a positive number of milliseconds)`);
  }
  return n;
}

let API_TIMEOUT_MS;
try {
  API_TIMEOUT_MS = parseTimeoutMs(process.env.SITEMAP_API_TIMEOUT_MS);
} catch (err) {
  console.error(`[sitemap] FATAL: ${err.message}`);
  process.exit(1);
}

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

/**
 * Always throws on any failure (network error, timeout, non-2xx, invalid
 * JSON, or an unexpected payload shape) rather than ever silently resolving
 * an empty list — callers decide whether to catch-and-degrade (default
 * mode) or let it propagate (strict mode).
 */
async function fetchProductIdsFromApi() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/products/active-ids`, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`API request to ${API_BASE} timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw new Error(`API request to ${API_BASE} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`API request failed: HTTP ${res.status}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    throw new Error(`API response was not valid JSON: ${e.message}`);
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => Number(entry && entry.id))
      .filter((id) => Number.isInteger(id) && id > 0);
  }
  if (payload && Array.isArray(payload.ids)) {
    return payload.ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  throw new Error(
    `API response had an unexpected shape (expected an array or {ids: [...]}): ${JSON.stringify(payload).slice(0, 200)}`
  );
}

async function resolveProductIds() {
  if (REQUIRE_API) {
    // Strict mode: the API is the only source of truth. No local-DB
    // fallback (fetchProductIdsFromDb is never even called), no catching
    // fetchProductIdsFromApi's errors, no accepting an empty result.
    const ids = await fetchProductIdsFromApi();
    if (!ids.length) {
      throw new Error(
        'SITEMAP_REQUIRE_API=true but the API returned zero product IDs — refusing to produce a sitemap without the expected fixture.'
      );
    }
    console.log(`[sitemap] Loaded ${ids.length} product ID(s) from API (strict mode).`);
    return ids;
  }

  const fromDb = await fetchProductIdsFromDb();
  if (fromDb && fromDb.length) return fromDb;

  if (!API_BASE) {
    console.warn('[sitemap] No local DB and no usable API base (not on a recognized deploy platform, and SITEMAP_API_BASE not set) -- refusing to fall back to any hardcoded production URL. Proceeding with static-only sitemap.');
    return [];
  }

  console.log('[sitemap] Falling back to API for product IDs...');
  try {
    const fromApi = await fetchProductIdsFromApi();
    console.log(`[sitemap] Loaded ${fromApi.length} product ID(s) from API.`);
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
