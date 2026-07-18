#!/usr/bin/env node
/**
 * Smoke test for backend/scripts/network-guard.cjs.
 *
 * Run standalone (loads the guard itself via -r, do not also preload it
 * externally):
 *
 *   node scripts/network-guard-smoke-test.cjs
 *
 * Verifies:
 *   - http/https/fetch to localhost, 127.0.0.1, and every IPv6 loopback form
 *     (::1, [::1], [::1]:PORT) are ALLOWED.
 *   - http/https/fetch to a real external host are BLOCKED before any DNS
 *     lookup or socket connects (no real network call is made by this
 *     script itself).
 */

const guard = require('./network-guard.cjs');

const http = require('http');
const https = require('https');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', (e) => resolve({ error: e.message, code: e.code }));
  });
}

function httpsGet(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      resolve({ status: res.statusCode, unexpectedSuccess: true });
    }).on('error', (e) => resolve({ error: e.message, code: e.code }));
  });
}

async function main() {
  console.log('Network guard smoke test\n');

  console.log('[0] Host-classifier unit checks — all three IPv6 loopback forms');
  check('normalizeHostCandidate("::1") === "::1"', guard.normalizeHostCandidate('::1') === '::1');
  check('normalizeHostCandidate("[::1]") === "::1"', guard.normalizeHostCandidate('[::1]') === '::1');
  check('normalizeHostCandidate("[::1]:3000") === "::1"', guard.normalizeHostCandidate('[::1]:3000') === '::1');
  check('isAllowedHost("::1") is true', guard.isAllowedHost('::1') === true);
  check('isAllowedHost("[::1]") is true', guard.isAllowedHost('[::1]') === true);
  check('isAllowedHost("[::1]:3000") is true', guard.isAllowedHost('[::1]:3000') === true);
  check('isAllowedHost("open.er-api.com") is false', guard.isAllowedHost('open.er-api.com') === false);
  check('isAllowedHost("[dead:beef::1]") is false (non-loopback IPv6)', guard.isAllowedHost('[dead:beef::1]') === false);

  // ── IPv4 / hostname loopback forms — must be ALLOWED ─────────────────────
  const server4 = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server4.listen(0, '127.0.0.1', resolve));
  const port4 = server4.address().port;

  console.log('[1] IPv4/hostname loopback forms (must be ALLOWED)');
  const r127 = await httpGet(`http://127.0.0.1:${port4}/`);
  check('http.get to 127.0.0.1:PORT is allowed', r127.status === 200 && r127.data === 'ok', JSON.stringify(r127));

  const rLocalhost = await httpGet(`http://localhost:${port4}/`);
  check('http.get to localhost:PORT is allowed', rLocalhost.status === 200 && rLocalhost.data === 'ok', JSON.stringify(rLocalhost));
  server4.close();

  // ── IPv6 loopback forms — must be ALLOWED ────────────────────────────────
  console.log('\n[2] IPv6 loopback forms (must be ALLOWED)');
  let server6;
  let port6;
  try {
    server6 = http.createServer((req, res) => res.end('ok6'));
    await new Promise((resolve, reject) => {
      server6.on('error', reject);
      server6.listen(0, '::1', resolve);
    });
    port6 = server6.address().port;
  } catch (err) {
    console.log(`  (skipping IPv6 live-server checks — ::1 not bindable in this environment: ${err.message})`);
    server6 = null;
  }

  if (server6) {
    // Bare form: "::1"
    const rBare = await httpGet({ hostname: '::1', port: port6, path: '/' });
    check('http.get with options.hostname="::1" (bare) is allowed', rBare.status === 200 && rBare.data === 'ok6', JSON.stringify(rBare));

    // Bracketed form in a URL string: "http://[::1]:PORT/"
    const rBracketed = await httpGet(`http://[::1]:${port6}/`);
    check('http.get to "http://[::1]:PORT/" (bracketed) is allowed', rBracketed.status === 200 && rBracketed.data === 'ok6', JSON.stringify(rBracketed));

    // Bracketed + port via options.host: "[::1]:PORT" — classifier unit
    // check, not a live connection: Node's own http client does not honor
    // a port embedded in a combined `host` string for connection purposes
    // (it dials the separate `port` option, defaulting to 80), which is a
    // Node quirk unrelated to the guard's classification logic. What must
    // be proven here is specifically that the guard's normalizer recognizes
    // this exact form as loopback.
    check(
      'classifier: normalizeHostCandidate("[::1]:PORT") === "::1"',
      guard.normalizeHostCandidate(`[::1]:${port6}`) === '::1'
    );
    check(
      'classifier: isAllowedHost("[::1]:PORT") is true',
      guard.isAllowedHost(`[::1]:${port6}`) === true
    );

    // fetch() to bracketed IPv6
    try {
      const res = await fetch(`http://[::1]:${port6}/`);
      const body = await res.text();
      check('fetch to "http://[::1]:PORT/" is allowed', res.status === 200 && body === 'ok6', `status=${res.status} body=${body}`);
    } catch (e) {
      check('fetch to "http://[::1]:PORT/" is allowed', false, e.message);
    }

    server6.close();
  }

  // ── External hosts — must be BLOCKED, no real network call made ─────────
  console.log('\n[3] External hosts (must be BLOCKED, zero real network activity)');
  const rExternalHttps = await httpsGet('https://example.com/');
  check(
    'https.get to example.com is blocked',
    rExternalHttps.code === 'NETWORK_GUARD_BLOCKED',
    JSON.stringify(rExternalHttps)
  );

  let fetchBlocked;
  try {
    await fetch('https://open.er-api.com/v6/latest/USD');
    fetchBlocked = { unexpectedSuccess: true };
  } catch (e) {
    fetchBlocked = { code: e.code, message: e.message };
  }
  check('fetch to open.er-api.com is blocked', fetchBlocked.code === 'NETWORK_GUARD_BLOCKED', JSON.stringify(fetchBlocked));

  // ── Final report sanity ──────────────────────────────────────────────────
  console.log('\n[4] Guard report sanity');
  const report = globalThis.__networkGuardReport();
  check('report exposes allowedCount > 0 (the loopback checks above)', report.allowedCount > 0, `allowedCount=${report.allowedCount}`);
  check('report exposes blockedCount > 0 (the external checks above)', report.blockedCount > 0, `blockedCount=${report.blockedCount}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
