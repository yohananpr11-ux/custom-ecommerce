'use strict';

// ──────────────────────────────────────────────────────────────────────
//  READ-ONLY audit of Printify products whose title starts with one of
//  the known test prefixes (SMOKE TEST, DRIP STREET DROP). Prints a
//  table of candidates so a human can decide which IDs to delete in a
//  separate, explicit step. This script does NOT modify anything in
//  Printify — no DELETE, no PUT, no POST.
//
//  Usage (the token is intentionally NOT read from .env; you must pass
//  it inline so it never gets committed by accident):
//
//      PRINTIFY_API_TOKEN=<your-token> node scripts/printify-list-test-drafts.js
//
//  Where to find the token:
//    - Printify dashboard → My Account → Connections → "Generate New
//      Personal Access Token" (read access is enough for this script).
//    - OR copy from Render's environment for the custom-ecommerce
//      service if it's already configured there.
//
//  PRINTIFY_SHOP_ID defaults to the Drip Street shop (27495153) and
//  can be overridden via env if you ever audit a different shop.
// ──────────────────────────────────────────────────────────────────────

const SHOP_ID = process.env.PRINTIFY_SHOP_ID || '27495153';
const TOKEN = process.env.PRINTIFY_API_TOKEN;

// Anchored at the START of the title — substring matches like '%test%'
// are deliberately avoided. Anything that doesn't begin with one of
// these phrases is treated as a real product and ignored.
const TEST_TITLE_PATTERNS = [
  /^SMOKE TEST\b/i,
  /^DRIP STREET DROP\b/i,
];

if (!TOKEN || TOKEN.startsWith('YOUR_')) {
  console.error('Missing PRINTIFY_API_TOKEN. Run with:');
  console.error('  PRINTIFY_API_TOKEN=<token> node scripts/printify-list-test-drafts.js');
  process.exit(1);
}

async function fetchPage(page) {
  const url = `https://api.printify.com/v1/shops/${SHOP_ID}/products.json?page=${page}&limit=50`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Printify HTTP ${resp.status} on page ${page}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

(async () => {
  console.log(`Auditing Printify shop ${SHOP_ID} (READ-ONLY — no deletions)...`);

  let page = 1;
  let totalPages = 1;
  const all = [];

  do {
    process.stdout.write(`  fetching page ${page}/${totalPages}... `);
    const data = await fetchPage(page);
    const products = Array.isArray(data?.data) ? data.data : [];
    all.push(...products);
    totalPages = Number(data?.last_page) || 1;
    console.log(`${products.length} products`);
    page++;
  } while (page <= totalPages);

  console.log(`\nTotal products in shop: ${all.length}`);

  const matches = all.filter((p) =>
    TEST_TITLE_PATTERNS.some((rx) => rx.test(p.title || ''))
  );

  if (matches.length === 0) {
    console.log('\nNo test-prefixed products found. Shop is clean.');
    return;
  }

  console.log(`\nFound ${matches.length} product(s) matching test prefixes:\n`);
  console.log('  Product ID                | Created             | Visible | Title');
  console.log('  --------------------------+---------------------+---------+----------------------------------------');
  for (const p of matches) {
    const created = String(p.created_at || '').slice(0, 19).replace('T', ' ');
    const title = String(p.title || '').slice(0, 60);
    const visible = p.visible === false ? 'no ' : 'yes';
    console.log(`  ${String(p.id || '').padEnd(26)}| ${created.padEnd(19)} | ${visible}     | ${title}`);
  }

  console.log('\n──');
  console.log('Nothing has been deleted. Review the list above and tell Claude');
  console.log('which IDs to remove — deletion will go through a separate explicit step.');
})().catch((err) => {
  console.error('\nAudit failed:', err.message);
  process.exit(2);
});
