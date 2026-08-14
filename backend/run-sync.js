// Manual Printify sync trigger -- a thin, authenticated HTTP client for the
// running backend's own admin endpoint. Deliberately contains NO product
// matching, NO variant reconciliation, and NO direct Printify API or
// database access of any kind.
//
// This used to be a second, standalone implementation of the sync itself:
// its own axios call to Printify, its own product/variant matching logic,
// its own direct writes to a locally-opened SQLite file. That duplicated
// (and silently drifted from) services/printify-sync-helpers.js, the
// actual production matching logic -- and because it wrote to the database
// directly from a separate OS process, it never shared the live server's
// services/printify.js `_syncTail` serialization, so running this script
// while the app's own scheduled/webhook-triggered sync was mid-run could
// race and create exactly the kind of duplicate-printifyId corruption this
// hardening PR exists to fix.
//
// Making this a pure HTTP client instead closes that gap structurally:
// every sync -- scheduled, webhook-triggered, or manually kicked off via
// this script -- now goes through POST /api/admin/printify-sync inside the
// one running server process, so it always shares that same `_syncTail`
// queue. There is only ever one sync implementation.
//
// Usage:
//   SYNC_BACKEND_URL=https://custom-ecommerce-qp30.onrender.com \
//   DRIP_ADMIN_SECRET=*** \
//     node run-sync.js
//
// Hard safety properties, all enforced below, not just documented:
//   - SYNC_BACKEND_URL and DRIP_ADMIN_SECRET must both be set explicitly --
//     there is no fallback to any default host, so a missing env var can
//     never silently target the wrong environment;
//   - performs exactly one POST, never retries, never loops;
//   - the admin secret is read from the environment and used only in the
//     request header -- it is never logged, printed, or included in any
//     error message;
//   - exits non-zero on any HTTP error status, network failure, or a
//     response body indicating the sync itself failed;
//   - prints only a safe summary (item count) on success -- never raw
//     product/customer data, never response headers.

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const backendBaseUrl = process.env.SYNC_BACKEND_URL;
if (!backendBaseUrl) {
  fail('SYNC_BACKEND_URL must be set explicitly (e.g. https://custom-ecommerce-qp30.onrender.com). Refusing to guess a target.');
}

const adminSecret = process.env.DRIP_ADMIN_SECRET;
if (!adminSecret) {
  fail('DRIP_ADMIN_SECRET must be set explicitly. Refusing to call an unauthenticated request.');
}

let syncUrl;
try {
  syncUrl = new URL('/api/admin/printify-sync', backendBaseUrl);
} catch (err) {
  fail(`SYNC_BACKEND_URL is not a valid URL: ${err.message}`);
}

const transport = syncUrl.protocol === 'http:' ? http : https;

console.log(`🔄 Triggering Printify sync via ${syncUrl.origin}${syncUrl.pathname} ...`);

const req = transport.request(
  syncUrl,
  {
    method: 'POST',
    headers: {
      'X-Admin-Secret': adminSecret,
      'Content-Length': 0,
    },
    timeout: 120000,
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { /* non-JSON response, handled below */ }

      if (res.statusCode >= 200 && res.statusCode < 300 && parsed && parsed.success) {
        console.log(`✅ Printify sync completed. products synced: ${parsed.count}`);
        process.exit(0);
      }

      const safeError = (parsed && typeof parsed.error === 'string') ? parsed.error : `HTTP ${res.statusCode}`;
      fail(`Printify sync failed: ${safeError}`);
    });
  },
);

req.on('error', (err) => {
  fail(`Request to backend failed: ${err.message}`);
});
req.on('timeout', () => {
  req.destroy();
  fail('Request to backend timed out after 120s.');
});

req.end();
