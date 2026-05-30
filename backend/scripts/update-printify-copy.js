#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  update-printify-copy.js  — Drip Street copy sync
//
//  Reads product-copy-updates.json, matches each entry by ID (or title),
//  and PUTs the new title + description to Printify.
//
//  Phase 4-Safe hardening (2026-05-30):
//    • Full per-product failure logs written immediately on each FAIL
//    • Rate-limit awareness: checks X-RateLimit-Remaining; backs off on 429
//    • GET-then-PUT fallback gated behind --enable-fallback (default: OFF)
//      Fallback only triggers when partial-PUT returns HTTP 500.
//
//  Usage:
//    node scripts/update-printify-copy.js [options]
//
//  Options:
//    --mapping <path>     Path to JSON mapping file
//                         (default: data/product-copy-updates.json)
//    --dry-run            Show what would be updated; no API writes
//    --enable-fallback    Enable GET-then-PUT fallback on HTTP 500
//                         (default: OFF — see safety note in Phase 4.1)
//    --ids <id1,id2>      Only process these product IDs
//    -h, --help           Show this help
//
//  Exit codes:
//    0   all updates succeeded (or dry-run completed)
//    1   config/IO/fatal error
//    2   one or more products FAILED (caller decides remediation)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PRINTIFY_API_BASE = 'https://api.printify.com/v1';

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    mappingPath: 'data/product-copy-updates.json',
    dryRun: false,
    enableFallback: false,   // Phase 4.1: OFF by default
    idFilter: null,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === '--dry-run')         { args.dryRun = true; continue; }
    if (cur === '--enable-fallback') { args.enableFallback = true; continue; }
    if (cur === '--help' || cur === '-h') { args.help = true; continue; }

    if (cur === '--mapping' && argv[i + 1]) {
      args.mappingPath = argv[i + 1]; i += 1; continue;
    }
    if (cur.startsWith('--mapping=')) {
      args.mappingPath = cur.slice('--mapping='.length); continue;
    }
    if (cur === '--ids' && argv[i + 1]) {
      args.idFilter = argv[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i += 1; continue;
    }
    if (cur.startsWith('--ids=')) {
      args.idFilter = cur.slice('--ids='.length).split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log('Usage: node scripts/update-printify-copy.js [--mapping <path>] [--dry-run] [--enable-fallback] [--ids id1,id2]');
  console.log('');
  console.log('Options:');
  console.log('  --mapping <path>     Path to JSON mapping file (default: data/product-copy-updates.json)');
  console.log('  --dry-run            Show what would be updated without calling PUT');
  console.log('  --enable-fallback    Enable GET-then-PUT fallback on HTTP 500 (default: OFF)');
  console.log('  --ids <id1,id2>      Only process these product IDs');
  console.log('  -h, --help           Show this help');
}

// ── Mapping loader ────────────────────────────────────────────────────────────

function loadMapping(mappingPath, idFilter) {
  const absolutePath = path.resolve(process.cwd(), mappingPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Mapping file not found: ${absolutePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

  let entries = Object.entries(parsed)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => ({
      key,
      title: String(value?.title || '').trim(),
      description: String(value?.description || '').trim(),
    }))
    .filter(e => e.title && e.description);

  if (idFilter && idFilter.length > 0) {
    const missing = idFilter.filter(id => !entries.find(e => e.key === id));
    if (missing.length) {
      throw new Error(`--ids contains IDs not in mapping: ${missing.join(', ')}`);
    }
    entries = entries.filter(e => idFilter.includes(e.key));
  }

  return { absolutePath, entries };
}

// ── Axios client ──────────────────────────────────────────────────────────────

function getClient(token) {
  return axios.create({
    baseURL: PRINTIFY_API_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

// ── Product fetch + index ─────────────────────────────────────────────────────

async function fetchAllProducts(client, shopId) {
  const products = [];
  let page = 1;
  const limit = 50;
  while (true) {
    const response = await client.get(`/shops/${shopId}/products.json`, { params: { page, limit } });
    const batch = Array.isArray(response.data?.data) ? response.data.data : [];
    if (batch.length === 0) break;
    products.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }
  return products;
}

function indexProducts(products) {
  const byId = new Map();
  const byExactTitle = new Map();
  for (const p of products) {
    byId.set(String(p.id), p);
    byExactTitle.set(String(p.title || ''), p);
  }
  return { byId, byExactTitle };
}

function resolveTarget(entry, index) {
  return index.byId.get(entry.key) ?? index.byExactTitle.get(entry.key) ?? null;
}

// ── Phase 4.2 — Rate-limit guard ─────────────────────────────────────────────
//
//  Called after every successful API response. Reads X-RateLimit-Remaining
//  from the response headers. If headroom is low, sleeps until the reset
//  window (or a safe minimum). On HTTP 429 the retry logic in
//  updateProductCopy handles the backoff.

async function rateLimitGuard(headers) {
  if (!headers) return;
  const remaining = Number(headers['x-ratelimit-remaining'] ?? 100);
  const resetEpoch = Number(headers['x-ratelimit-reset'] ?? 0);

  if (remaining < 10) {
    const nowSec = Math.floor(Date.now() / 1000);
    const waitSec = resetEpoch > nowSec ? (resetEpoch - nowSec) + 1 : 10;
    console.log(`[COPY_SYNC][RATE] Remaining quota: ${remaining}. Sleeping ${waitSec}s until reset...`);
    await new Promise(r => setTimeout(r, waitSec * 1000));
  }
}

// ── Phase 4.1 — PUT with optional GET-then-PUT fallback ───────────────────────
//
//  Default (--enable-fallback NOT set):
//    Partial PUT only: { title, description }.
//    On 500 → logs the error, does NOT retry with full object.
//
//  With --enable-fallback:
//    Partial PUT first. On HTTP 500 only: GET the full product, strip
//    read-only fields, PUT full object back with new title + description.
//    Logs which path succeeded.
//
//  Safety note: full-object PUT has triggered error 8150
//  (print_areas.placeholders.images field is required) on some products
//  in previous sessions. That is why the fallback is OFF by default.

async function partialPut(client, shopId, productId, title, description) {
  const res = await client.put(`/shops/${shopId}/products/${productId}.json`, { title, description });
  return { result: res, method: 'partial' };
}

async function fullPut(client, shopId, productId, title, description) {
  const get = await client.get(`/shops/${shopId}/products/${productId}.json`);
  const current = get.data;
  // Strip fields Printify rejects on PUT
  const { id, created_at, updated_at, user_id, shop_id, ...mutable } = current;
  const res = await client.put(`/shops/${shopId}/products/${productId}.json`, {
    ...mutable,
    title,
    description,
  });
  return { result: res, method: 'full' };
}

// Exponential backoff for 429 responses
async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.response?.status !== 429) throw err;
      const retryAfter = Number(err.response.headers?.['retry-after'] ?? 0);
      const backoffMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
      console.log(`[COPY_SYNC][RATE] 429 on attempt ${attempt}/${maxRetries}. Backing off ${backoffMs}ms...`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function updateProductCopy(client, shopId, productId, title, description, { enableFallback }) {
  return withRetry(async () => {
    if (!enableFallback) {
      return partialPut(client, shopId, productId, title, description);
    }
    // Fallback mode: try partial first; on 500 retry with full object
    try {
      return await partialPut(client, shopId, productId, title, description);
    } catch (err) {
      if (err.response?.status !== 500) throw err;
      console.log(`[COPY_SYNC][FALLBACK] Partial PUT returned 500 on ${productId}. Retrying with full object...`);
      return await fullPut(client, shopId, productId, title, description);
    }
  });
}

// ── Phase 4.3 + 4.4 — Per-product immediate fail log ─────────────────────────
//
//  Written immediately on each failure (not batched at the end).
//  File: logs/printify-fail-<productId>-<timestamp>.json
//  Contains: full request payload, full response body, full response headers.

function writePerProductFailLog(logsDir, productId, entry, status, axiosError) {
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDir, `printify-fail-${productId}-${ts}.json`);
  const payload = {
    logged_at: new Date().toISOString(),
    product_id: productId,
    key: entry.key,
    http_status: status,
    request: {
      title: entry.title,
      description: entry.description,
    },
    response: {
      status: axiosError.response?.status ?? null,
      headers: axiosError.response?.headers ?? {},
      data: axiosError.response?.data ?? null,
    },
    error_message: axiosError.message,
    stack: axiosError.stack ?? null,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

// Legacy: end-of-run combined fail log (kept for compatibility)
function writeCombinedFailureLog(logsDir, failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDir, `printify-fails-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ generated_at: new Date().toISOString(), failures }, null, 2));
  return filePath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) { printHelp(); return; }

  const token = process.env.PRINTIFY_API_TOKEN;
  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!token) throw new Error('Missing PRINTIFY_API_TOKEN environment variable.');
  if (!shopId) throw new Error('Missing PRINTIFY_SHOP_ID environment variable.');

  const { absolutePath, entries } = loadMapping(args.mappingPath, args.idFilter);

  if (entries.length === 0) {
    console.log(`[COPY_SYNC] No valid updates in mapping file: ${absolutePath}`);
    return;
  }

  const client = getClient(token);
  const logsDir = path.resolve(process.cwd(), 'logs');

  if (args.enableFallback) {
    console.log('[COPY_SYNC][WARN] --enable-fallback is ON. Full-object PUT will be used on HTTP 500.');
    console.log('[COPY_SYNC][WARN] This may trigger error 8150 on some products. Monitor logs carefully.');
  }

  console.log(`[COPY_SYNC] Loading products from Printify shop ${shopId}...`);
  const products = await fetchAllProducts(client, shopId);
  console.log(`[COPY_SYNC] Loaded ${products.length} products.`);

  const index = indexProducts(products);

  let success = 0, failed = 0, skipped = 0;
  const failureLogs = [];

  for (const entry of entries) {
    const target = resolveTarget(entry, index);

    if (!target) {
      skipped += 1;
      console.log(`[COPY_SYNC][SKIP] Key not matched: "${entry.key}"`);
      continue;
    }

    const productId = String(target.id);
    const beforeTitle = String(target.title || '');

    if (args.dryRun) {
      success += 1;
      console.log(`[COPY_SYNC][DRY-RUN][OK] ${productId} :: "${beforeTitle}" -> "${entry.title}"`);
      continue;
    }

    try {
      const { result, method } = await updateProductCopy(
        client, shopId, productId, entry.title, entry.description,
        { enableFallback: args.enableFallback }
      );
      success += 1;
      const methodTag = method === 'full' ? '[FALLBACK]' : '';
      console.log(`[COPY_SYNC][OK]${methodTag} Updated ${productId} :: "${beforeTitle}" -> "${entry.title}"`);

      // Phase 4.2: check rate limit headroom after each success
      await rateLimitGuard(result.headers);

    } catch (error) {
      failed += 1;
      const status = error.response?.status ?? 'NO_STATUS';
      const fullDetails = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? {});
      const shortDetails = fullDetails.length > 300 ? `${fullDetails.slice(0, 300)}...` : fullDetails;

      // Phase 4.3+4.4: write per-product fail log IMMEDIATELY
      const logPath = writePerProductFailLog(logsDir, productId, entry, status, error);

      failureLogs.push({
        key: entry.key,
        product_id: productId,
        status,
        request: { title: entry.title, description: entry.description },
        response: { headers: error.response?.headers ?? {}, data: error.response?.data ?? null },
        message: error.message,
        logged_at: new Date().toISOString(),
      });

      console.log(`[COPY_SYNC][FAIL] ${productId} (${status}) key="${entry.key}"`);
      console.log(`[COPY_SYNC][FAIL]   detail: ${shortDetails}`);
      console.log(`[COPY_SYNC][FAIL]   log written: ${logPath}`);
    }
  }

  console.log('');
  console.log('[COPY_SYNC] ─── Summary ───────────────────────────────────────');
  console.log(`[COPY_SYNC] Mapping file:       ${absolutePath}`);
  console.log(`[COPY_SYNC] Requested updates:  ${entries.length}`);
  console.log(`[COPY_SYNC] Success:            ${success}`);
  console.log(`[COPY_SYNC] Failed:             ${failed}`);
  console.log(`[COPY_SYNC] Skipped (no match): ${skipped}`);
  if (args.enableFallback) {
    console.log('[COPY_SYNC] Fallback mode:      ON');
  }

  // Legacy combined fail log
  const combinedLogPath = writeCombinedFailureLog(logsDir, failureLogs);
  if (combinedLogPath) {
    console.log(`[COPY_SYNC] Combined fail log:  ${combinedLogPath}`);
  }

  if (failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[COPY_SYNC][FATAL] ${error.message}`);
  process.exit(1);
});
