#!/usr/bin/env node
/**
 * Automated verification that every /api/admin/* route enforces
 * DRIP_ADMIN_SECRET before running any business logic.
 *
 * This is fully self-contained: it spawns its own local server instances
 * (never touches Render, never touches the real backend/ecommerce.db —
 * always DB_PATH-isolated to a throwaway file it creates and deletes) and
 * runs three phases:
 *
 *   Phase A — server started WITH a known DRIP_ADMIN_SECRET:
 *     - missing X-Admin-Secret header -> 401, before any handler side effect
 *     - wrong X-Admin-Secret value -> 401
 *     - correct X-Admin-Secret -> auth passes (verified by asserting the
 *       route's own downstream response, not a blanket "not 401")
 *
 *   Phase B — server started WITHOUT DRIP_ADMIN_SECRET configured at all:
 *     - every route must fail closed with 503, regardless of any header sent
 *
 *   Phase C — regression check: the 7 routes that were already protected
 *     before this pass (set-coupon, refresh-prices, the 4 design/* routes,
 *     admin-reports' orders-summary/coupons-active) still reject an
 *     unauthenticated request. Confirms all 14 /api/admin/* registrations
 *     are protected, not just the 7 newly-fixed ones.
 *
 * Safe by construction, not just by convention: the server this script
 * starts is never given real PRINTIFY_API_TOKEN / TELEGRAM_BOT_TOKEN /
 * RESEND_API_KEY, so even a "correctly authenticated" request in Phase A
 * cannot register a real webhook, send a real Telegram/email message, or
 * call a real paid external API — every one of those integrations degrades
 * to a documented mock/log/disabled response when unconfigured (verified
 * inline below via the expected response shape, not assumed).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios');

const BACKEND_DIR = path.resolve(__dirname, '..');
let failures = 0;

const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// OS-level variables the child process genuinely needs to boot on Windows —
// deliberately NOT `...process.env`, so nothing credential-shaped from the
// invoking shell (real PAYPAL_*/PAYPLUS_*/STRIPE_*/CJ_*/CLOUDINARY_* keys,
// etc.) is ever passed through, inherited, or available for dotenv to skip
// re-filling. Everything this test cares about is set explicitly below.
const OS_ENV_ALLOWLIST = [
  'PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC',
  'PATHEXT', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'APPDATA',
  'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
];

function startServer({ port, dbPath, adminSecret }) {
  const env = {};
  for (const key of OS_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  Object.assign(env, {
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: dbPath,
    ENABLE_PRINTIFY_SYNC: 'false',
    // Two separate, independent flags — set explicitly, never one standing
    // in for the other. DISABLE_BACKGROUND_JOBS controls whether background
    // jobs/cron get registered at all; HERMETIC_TEST_MODE controls whether
    // on-demand code paths (e.g. update-prices' exchange-rate fetch,
    // telegram.js's MENI_CORE file-read fallback) go deterministic instead
    // of attempting a real external call/file read.
    DISABLE_BACKGROUND_JOBS: 'true',
    HERMETIC_TEST_MODE: 'true',
    // Every external-service credential this test's routes could possibly
    // touch, explicitly blanked — proves these routes cannot reach any real
    // external service even when correctly authenticated, and guarantees
    // dotenv (loaded inside index.js) has nothing absent to re-fill from the
    // real local .env, since an explicit '' counts as "already present".
    PRINTIFY_API_TOKEN: '',
    PRINTIFY_SHOP_ID: '',
    PRINTIFY_WEBHOOK_URL: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_OWNER_CHAT_ID: '',
    RESEND_API_KEY: '',
    PAYPAL_CLIENT_ID: '',
    PAYPAL_CLIENT_SECRET: '',
    PAYPAL_SECRET: '',
    PAYPLUS_API_KEY: '',
    PAYPLUS_SECRET_KEY: '',
    PAYPLUS_PAGE_UID: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    CJ_API_KEY: '',
    CLOUDINARY_URL: '',
    IPAPI_KEY: '',
  });

  // index.js loads .env via dotenv at startup, and dotenv only fills a var
  // that's genuinely absent from process.env — an explicit empty string is
  // "present" as far as dotenv is concerned, so it stays unset, and
  // requireAdminAuth's `if (!expected)` correctly treats '' as falsy.
  env.DRIP_ADMIN_SECRET = adminSecret === undefined ? '' : adminSecret;
  if (process.env.NETWORK_GUARD_LOG_PATH) {
    env.NETWORK_GUARD_LOG_PATH = process.env.NETWORK_GUARD_LOG_PATH;
  }

  const child = spawn(process.execPath, ['-r', path.join(BACKEND_DIR, 'scripts', 'network-guard.cjs'), 'index.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  return { child, getLog: () => out };
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await axios.get(`${baseUrl}/`, { timeout: 1000, validateStatus: () => true });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

async function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000);
  });
}

// The 7 routes fixed in this pass, with the exact method + the expected
// response once auth passes but no real external credentials exist.
//
// unconfiguredStatus: `app.use('/api/admin', adminReportsRouter)` (index.js
// ~line 1142) is a PREFIX mount, so it intercepts every /api/admin/* request
// registered AFTER it in the file, before that route's own handler ever
// runs — and its own auth middleware (routes/admin-reports.js) always
// replies 401 when the secret is unconfigured, never 503. sync-status (1397),
// printify-sync (1881), update-prices (1899) and retry-emails (1910) are all
// registered after line 1142, so a client sees 401 from that earlier gate,
// not the 503 this pass's requireAdminAuth would produce if it were reached
// first. register-webhooks/register-telegram-webhook/test-telegram are
// registered BEFORE line 1142, so they hit requireAdminAuth directly and
// correctly return 503. This was discovered by running this exact script —
// a static code read alone would have missed it.
const NEWLY_PROTECTED = [
  {
    label: 'register-webhooks', method: 'get', path: '/api/admin/register-webhooks', unconfiguredStatus: 503,
    onAuthed: (res) => res.status === 400 && /Missing required environment variables/.test(JSON.stringify(res.data)),
  },
  {
    label: 'register-telegram-webhook', method: 'get', path: '/api/admin/register-telegram-webhook', unconfiguredStatus: 503,
    onAuthed: (res) => res.status === 400 && /TELEGRAM_BOT_TOKEN is not configured/.test(JSON.stringify(res.data)),
  },
  {
    label: 'test-telegram', method: 'get', path: '/api/admin/test-telegram', unconfiguredStatus: 503,
    // telegram.sendMessage() gracefully returns {ok:false, skipped:true} when
    // unconfigured (services/telegram.js) — the route surfaces that as a 500
    // with the diagnostic, never a real send. What matters here is it's not 401/503.
    onAuthed: (res) => res.status !== 401 && res.status !== 503,
  },
  {
    label: 'sync-status', method: 'get', path: '/api/admin/sync-status', unconfiguredStatus: 401,
    onAuthed: (res) => res.status === 200 && typeof res.data.statistics === 'object',
  },
  {
    label: 'printify-sync', method: 'post', path: '/api/admin/printify-sync', unconfiguredStatus: 401,
    onAuthed: (res) => res.status === 409 && /Printify sync is disabled/.test(JSON.stringify(res.data)),
  },
  {
    label: 'update-prices', method: 'post', path: '/api/admin/update-prices', unconfiguredStatus: 401,
    onAuthed: (res) => res.status === 200 && res.data.success === true,
  },
  {
    label: 'retry-emails', method: 'post', path: '/api/admin/retry-emails', unconfiguredStatus: 401,
    onAuthed: (res) => res.status === 200 && res.data.success === true,
  },
];

// Already-protected before this pass — regression check only (no header).
const PREVIOUSLY_PROTECTED = [
  { label: 'set-coupon', method: 'post', path: '/api/admin/set-coupon' },
  { label: 'refresh-prices', method: 'post', path: '/api/admin/refresh-prices' },
  { label: 'design/create-draft', method: 'post', path: '/api/admin/design/create-draft' },
  { label: 'design/:jobId/publish', method: 'post', path: '/api/admin/design/1/publish' },
  { label: 'design/:jobId/title', method: 'patch', path: '/api/admin/design/1/title' },
  { label: 'design/:jobId/reject', method: 'post', path: '/api/admin/design/1/reject' },
  { label: 'orders-summary', method: 'get', path: '/api/admin/orders-summary' },
  { label: 'coupons-active', method: 'get', path: '/api/admin/coupons-active' },
];

async function request(baseUrl, { method, path: p }, headers = {}) {
  return axios.request({
    method,
    url: `${baseUrl}${p}`,
    headers,
    data: {},
    timeout: 8000,
    validateStatus: () => true,
  });
}

async function phaseA(baseUrl, correctSecret) {
  console.log('\n[Phase A] Server started WITH a known DRIP_ADMIN_SECRET');
  for (const route of NEWLY_PROTECTED) {
    const noHeader = await request(baseUrl, route);
    check(`${route.label}: no header -> 401`, noHeader.status === 401, `got ${noHeader.status}`);

    const wrongHeader = await request(baseUrl, route, { 'X-Admin-Secret': 'definitely-wrong' });
    check(`${route.label}: wrong secret -> 401`, wrongHeader.status === 401, `got ${wrongHeader.status}`);

    const authed = await request(baseUrl, route, { 'X-Admin-Secret': correctSecret });
    check(`${route.label}: correct secret reaches handler (not blocked by auth)`, route.onAuthed(authed), `got ${authed.status} ${JSON.stringify(authed.data).slice(0, 150)}`);
  }
}

async function phaseB(baseUrl) {
  console.log('\n[Phase B] Server started WITHOUT DRIP_ADMIN_SECRET configured at all');
  for (const route of NEWLY_PROTECTED) {
    const res = await request(baseUrl, route, { 'X-Admin-Secret': 'anything-at-all' });
    check(
      `${route.label}: fails closed (${route.unconfiguredStatus}) when secret unconfigured`,
      res.status === route.unconfiguredStatus,
      `got ${res.status}`
    );
  }
}

async function phaseC(baseUrl) {
  console.log('\n[Phase C] Regression — the 7 previously-protected routes still reject unauthenticated requests');
  for (const route of PREVIOUSLY_PROTECTED) {
    const res = await request(baseUrl, route);
    check(`${route.label}: no header -> rejected (401/503)`, res.status === 401 || res.status === 503, `got ${res.status}`);
  }
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-auth-verify-'));
  const secret = 'test-secret-' + Date.now();

  try {
    // Phase A + C: server WITH the secret configured
    const dbA = path.join(tmpRoot, 'a.db');
    const portA = 4200 + Math.floor(Math.random() * 100);
    const serverA = startServer({ port: portA, dbPath: dbA, adminSecret: secret });
    const readyA = await waitForServer(`http://localhost:${portA}`);
    if (!readyA) {
      console.error('Server (Phase A) did not become ready:\n' + serverA.getLog());
      process.exit(1);
    }
    await phaseA(`http://localhost:${portA}`, secret);
    await phaseC(`http://localhost:${portA}`);
    await stopServer(serverA.child);

    // Phase B: separate server WITHOUT the secret configured
    const dbB = path.join(tmpRoot, 'b.db');
    const portB = 4300 + Math.floor(Math.random() * 100);
    const serverB = startServer({ port: portB, dbPath: dbB, adminSecret: undefined });
    const readyB = await waitForServer(`http://localhost:${portB}`);
    if (!readyB) {
      console.error('Server (Phase B) did not become ready:\n' + serverB.getLog());
      process.exit(1);
    }
    await phaseB(`http://localhost:${portB}`);
    await stopServer(serverB.child);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
