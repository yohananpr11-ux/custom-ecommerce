#!/usr/bin/env node

const axios = require('axios');

const DEFAULT_ADMIN_SECRET = 'dummy-admin-secret';
const DEFAULT_MARKETING_SECRET = 'dummy-marketing-secret';

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const [rawKey, inlineValue] = token.split('=');
    const key = rawKey.replace(/^--/, '');

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const args = parseArgs(process.argv.slice(2));

const baseUrl = normalizeBaseUrl(
  args.baseUrl || args.base_url || process.env.SMOKE_BASE_URL || process.env.API_BASE_URL
);

const adminSecret = String(
  args.adminSecret || args.admin_secret || process.env.SMOKE_ADMIN_SECRET || process.env.DRIP_ADMIN_SECRET || DEFAULT_ADMIN_SECRET
).trim();

const marketingSecret = String(
  args.marketingSecret || args.marketing_secret || process.env.SMOKE_MARKETING_SECRET || process.env.MARKETING_SECRET || DEFAULT_MARKETING_SECRET
).trim();

const sinceHours = Math.max(1, Math.round(toNumber(args.sinceHours || args.since_hours || process.env.SMOKE_SINCE_HOURS, 24)));
const timeoutMs = Math.max(1000, Math.round(toNumber(args.timeoutMs || args.timeout_ms || process.env.SMOKE_TIMEOUT_MS, 12000)));

if (!baseUrl) {
  console.error('Missing base URL. Provide --baseUrl or SMOKE_BASE_URL.');
  process.exit(1);
}

const isDummyAdminSecret = adminSecret === DEFAULT_ADMIN_SECRET;
const isDummyMarketingSecret = marketingSecret === DEFAULT_MARKETING_SECRET;

const expectedAdminStatus = isDummyAdminSecret ? 401 : 200;
const expectedMarketingStatus = isDummyMarketingSecret ? 401 : 202;

const printConfig = () => {
  console.log('--- Smoke Test Config ---');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Admin secret mode: ${isDummyAdminSecret ? 'dummy (expect 401)' : 'provided (expect 200)'}`);
  console.log(`Marketing secret mode: ${isDummyMarketingSecret ? 'dummy (expect 401)' : 'provided (expect 202)'}`);
  console.log(`since_hours: ${sinceHours}`);
  console.log(`timeout_ms: ${timeoutMs}`);
  console.log('-------------------------');
};

const run = async () => {
  printConfig();

  const client = axios.create({
    timeout: timeoutMs,
    validateStatus: () => true,
  });

  const adminUrl = `${baseUrl}/api/admin/orders-summary?since_hours=${sinceHours}`;
  const marketingUrl = `${baseUrl}/api/marketing/abandoned-cart`;

  const adminResponse = await client.get(adminUrl, {
    headers: {
      'X-Admin-Secret': adminSecret,
      Accept: 'application/json',
    },
  });

  console.log(`\n[1/2] GET ${adminUrl}`);
  console.log(`Status: ${adminResponse.status} (expected ${expectedAdminStatus})`);
  console.log('Body:', JSON.stringify(adminResponse.data, null, 2));

  const marketingPayload = {
    sessionId: `smoke-${Date.now()}`,
    customerEmail: 'smoke@example.com',
    customerPhone: '+15550001111',
    currency: 'USD',
    items: [
      { id: 101, title: 'Smoke Test Tee', quantity: 2, price: 29.0 },
      { id: 102, title: 'Smoke Test Hoodie', quantity: 1, price: 59.0 },
    ],
    totalValue: 117.0,
  };

  const marketingResponse = await client.post(marketingUrl, marketingPayload, {
    headers: {
      'X-Marketing-Secret': marketingSecret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  console.log(`\n[2/2] POST ${marketingUrl}`);
  console.log(`Status: ${marketingResponse.status} (expected ${expectedMarketingStatus})`);
  console.log('Body:', JSON.stringify(marketingResponse.data, null, 2));

  const adminOk = adminResponse.status === expectedAdminStatus;
  const marketingOk = marketingResponse.status === expectedMarketingStatus;

  if (!adminOk || !marketingOk) {
    console.error('\nSmoke test FAILED.');
    if (!adminOk) {
      console.error(`- Admin endpoint mismatch: expected ${expectedAdminStatus}, got ${adminResponse.status}`);
    }
    if (!marketingOk) {
      console.error(`- Marketing endpoint mismatch: expected ${expectedMarketingStatus}, got ${marketingResponse.status}`);
    }
    process.exit(1);
  }

  console.log('\nSmoke test PASSED. Endpoints are reachable and security behavior matches expectations.');
};

run().catch((err) => {
  const status = err.response && err.response.status;
  const body = err.response && err.response.data;
  console.error('Smoke test crashed:', err.message);
  if (status) console.error('HTTP Status:', status);
  if (body) console.error('Response Body:', JSON.stringify(body, null, 2));
  process.exit(1);
});
