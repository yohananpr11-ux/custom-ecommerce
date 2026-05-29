#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PRINTIFY_API_BASE = 'https://api.printify.com/v1';

function parseArgs(argv) {
  const args = {
    mappingPath: 'data/product-copy-updates.json',
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--mapping' && argv[i + 1]) {
      args.mappingPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log('Usage: node scripts/update-printify-copy.js [--mapping <path>] [--dry-run]');
  console.log('');
  console.log('Options:');
  console.log('  --mapping <path>   Path to JSON mapping file (default: data/product-copy-updates.json)');
  console.log('  --dry-run          Show what would be updated without calling PUT');
  console.log('  -h, --help         Show this help');
}

function loadMapping(mappingPath) {
  const absolutePath = path.resolve(process.cwd(), mappingPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Mapping file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);

  const entries = Object.entries(parsed)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => ({
      key,
      title: String(value?.title || '').trim(),
      description: String(value?.description || '').trim(),
    }))
    .filter((entry) => entry.title && entry.description);

  return { absolutePath, entries };
}

function getClient(token) {
  return axios.create({
    baseURL: PRINTIFY_API_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

async function fetchAllProducts(client, shopId) {
  const products = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const response = await client.get(`/shops/${shopId}/products.json`, {
      params: { page, limit },
    });

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

  for (const product of products) {
    const id = String(product.id);
    const title = String(product.title || '');
    byId.set(id, product);
    byExactTitle.set(title, product);
  }

  return { byId, byExactTitle };
}

function resolveTarget(entry, index) {
  if (index.byId.has(entry.key)) {
    return index.byId.get(entry.key);
  }

  if (index.byExactTitle.has(entry.key)) {
    return index.byExactTitle.get(entry.key);
  }

  return null;
}

async function updateProductCopy(client, shopId, productId, title, description) {
  return client.put(`/shops/${shopId}/products/${productId}.json`, {
    title,
    description,
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const token = process.env.PRINTIFY_API_TOKEN;
  const shopId = process.env.PRINTIFY_SHOP_ID;

  if (!token) {
    throw new Error('Missing PRINTIFY_API_TOKEN environment variable.');
  }

  if (!shopId) {
    throw new Error('Missing PRINTIFY_SHOP_ID environment variable.');
  }

  const { absolutePath, entries } = loadMapping(args.mappingPath);

  if (entries.length === 0) {
    console.log(`[COPY_SYNC] No valid updates in mapping file: ${absolutePath}`);
    return;
  }

  const client = getClient(token);

  console.log(`[COPY_SYNC] Loading products from Printify shop ${shopId}...`);
  const products = await fetchAllProducts(client, shopId);
  console.log(`[COPY_SYNC] Loaded ${products.length} products.`);

  const index = indexProducts(products);

  let success = 0;
  let failed = 0;
  let skipped = 0;

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
      await updateProductCopy(client, shopId, productId, entry.title, entry.description);
      success += 1;
      console.log(`[COPY_SYNC][OK] Updated ${productId} :: "${beforeTitle}" -> "${entry.title}"`);
    } catch (error) {
      failed += 1;
      const status = error.response?.status || 'NO_STATUS';
      const details = typeof error.response?.data === 'string'
        ? error.response.data.slice(0, 300)
        : JSON.stringify(error.response?.data || {}).slice(0, 300);

      console.log(`[COPY_SYNC][FAIL] ${productId} (${status}) key="${entry.key}" :: ${details}`);
    }
  }

  console.log('');
  console.log('[COPY_SYNC] Summary');
  console.log(`[COPY_SYNC] Mapping file: ${absolutePath}`);
  console.log(`[COPY_SYNC] Requested updates: ${entries.length}`);
  console.log(`[COPY_SYNC] Success: ${success}`);
  console.log(`[COPY_SYNC] Failed: ${failed}`);
  console.log(`[COPY_SYNC] Skipped (no match): ${skipped}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[COPY_SYNC][FATAL] ${error.message}`);
  process.exit(1);
});
