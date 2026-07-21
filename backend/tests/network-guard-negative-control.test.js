// ─────────────────────────────────────────────────────────────────────────
// NETWORK GUARD NEGATIVE CONTROL — deliberately intentional, out-of-band
// ─────────────────────────────────────────────────────────────────────────
// Every other test file in this suite proves "no test made a network call."
// That alone does not prove the guard would actually STOP one if a test (or
// a future change) tried. This file's entire purpose is to try — on
// purpose, against a hostname that can never resolve to anything real
// (RFC 2606 reserves the .invalid TLD specifically for this) — and prove
// the attempt is intercepted before any DNS lookup or socket is opened.
//
// This file must be run with backend/scripts/network-guard.cjs preloaded
// (`node -r ./scripts/network-guard.cjs --test ...`), exactly like the rest
// of the P0 suite. It is intentionally NOT mixed into the same `node --test`
// invocation as the real suites in .github/workflows/p0-verify.yml — it
// runs as its own separate CI step, so its output is never confused with
// normal application-test results.
//
// Uses no real service, no real credential, no real hostname.

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');

const NEGATIVE_CONTROL_HOST = 'network-guard-negative-control.invalid'; // RFC 2606 .invalid — never resolvable

console.log('=== NETWORK GUARD NEGATIVE CONTROL (intentional, expected to be blocked) ===');

test('NEGATIVE CONTROL: https.request to a non-localhost host is intercepted before any DNS/TCP attempt', () => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = https.request({ hostname: NEGATIVE_CONTROL_HOST, path: '/', method: 'GET', timeout: 5000 }, () => {
      reject(new Error('NEGATIVE CONTROL FAILED: a real response was received — the guard did not intercept this request.'));
    });
    req.on('error', (err) => {
      const elapsedMs = Date.now() - startedAt;
      try {
        assert.equal(err.code, 'NETWORK_GUARD_BLOCKED', 'the error must be the guard\'s own synthetic block, not a real DNS/connection failure');
        // A real DNS lookup against a genuinely non-resolvable host still
        // takes measurable time (resolver timeout); the guard's synthetic
        // rejection fires on setImmediate with no lookup at all. A few ms
        // is conclusive evidence no real network stack was ever touched.
        assert.ok(elapsedMs < 500, `blocked far too slowly (${elapsedMs}ms) to be a pre-DNS synthetic rejection`);
        console.log(`NETWORK_BLOCKED=true (elapsed=${elapsedMs}ms, code=${err.code})`);
        resolve();
      } catch (assertionErr) {
        reject(assertionErr);
      }
    });
    req.end();
  });
});

test('NEGATIVE CONTROL: fetch() to a non-localhost host is intercepted before any DNS/TCP attempt', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => fetch(`https://${NEGATIVE_CONTROL_HOST}/`),
    (err) => {
      assert.equal(err.code, 'NETWORK_GUARD_BLOCKED');
      return true;
    }
  );
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 500, `blocked far too slowly (${elapsedMs}ms) to be a pre-DNS synthetic rejection`);
  console.log(`NETWORK_BLOCKED=true (elapsed=${elapsedMs}ms)`);
});

test('NEGATIVE CONTROL: the guard\'s own report confirms exactly these two blocked attempts, zero allowed', () => {
  const report = globalThis.__networkGuardReport();
  assert.equal(report.hermetic, false, 'this file deliberately makes the report non-hermetic — that IS the proof the guard saw and recorded the attempts');
  const blockedForThisHost = report.attempts.filter((a) => a.hostname === NEGATIVE_CONTROL_HOST && a.allowed === false);
  assert.ok(blockedForThisHost.length >= 2, 'expected at least the https.request and fetch attempts to be recorded as blocked');
  const allowedForThisHost = report.attempts.filter((a) => a.hostname === NEGATIVE_CONTROL_HOST && a.allowed === true);
  assert.equal(allowedForThisHost.length, 0, 'the negative-control host must never have been recorded as allowed');
  console.log(`UNEXPECTED_NETWORK_ATTEMPTS=0 (the ${blockedForThisHost.length} attempt(s) above were EXPECTED and INTENTIONAL, not unexpected)`);
});

console.log('=== END NETWORK GUARD NEGATIVE CONTROL ===');
