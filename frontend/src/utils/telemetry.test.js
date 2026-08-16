// Visitor/session id persistence + reuse (PR #34, section 11 Q/R/S).
// Plain node:test against the real module -- no Vite, no jsdom. Only
// localStorage/sessionStorage are stubbed (module-level import.meta.env
// access is already guarded to no-op safely without Vite -- see
// telemetry.js). initTelemetry()/reportFrontendError() themselves are
// gated behind isProd (always false outside a real Vite prod build, so not
// exercised end-to-end here); this focuses on the exported id-management
// helpers they both depend on, including their own storage-failure
// fallbacks.

import test from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

function makeThrowingStorage() {
  return {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
    removeItem: () => { throw new Error('storage unavailable'); },
  };
}

test.beforeEach(() => {
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
  globalThis.window = { location: { pathname: '/', search: '' } };
  globalThis.document = { referrer: '' };
  globalThis.fetch = async () => ({ ok: true });
});

test('Q: getOrCreateVisitorId returns the same id on repeated calls (persisted, not regenerated)', async () => {
  const { getOrCreateVisitorId } = await import('./telemetry.js?q1');
  const first = getOrCreateVisitorId();
  const second = getOrCreateVisitorId();
  assert.equal(first, second);
  assert.match(first, /^[a-z0-9]+$/i);
});

test('Q: getOrCreateSessionId returns the same id on repeated calls within the same session', async () => {
  const { getOrCreateSessionId } = await import('./telemetry.js?q2');
  const first = getOrCreateSessionId();
  const second = getOrCreateSessionId();
  const third = getOrCreateSessionId();
  assert.equal(first, second);
  assert.equal(second, third);
});

test('Q: visitor id and session id are independent identifiers', async () => {
  const { getOrCreateVisitorId, getOrCreateSessionId } = await import('./telemetry.js?q3');
  const visitorId = getOrCreateVisitorId();
  const sessionId = getOrCreateSessionId();
  assert.notEqual(visitorId, sessionId, 'visitor_id and session_id must not collide/coincide');
});

// ── R. Refresh does not create a new session ────────────────────────────
//
// sessionStorage (unlike localStorage) is what a real browser preserves
// across a reload/refresh of the same tab and clears on tab close -- this
// is exactly why getOrCreateSessionId uses sessionStorage. Simulating a
// reload here means calling it again against the SAME (unc leared)
// sessionStorage instance, which is what actually happens in a browser.

test('R: a simulated reload (same sessionStorage instance, function called again) reuses the existing session_id', async () => {
  const { getOrCreateSessionId } = await import('./telemetry.js?r1');
  const beforeReload = getOrCreateSessionId();

  // "Reload": nothing clears sessionStorage (that's the whole point) --
  // call the exact same function again as the app would on next bootstrap.
  const afterReload = getOrCreateSessionId();

  assert.equal(beforeReload, afterReload, 'reload must never produce a new session_id');
  assert.equal(globalThis.sessionStorage.getItem('jono_session_id'), beforeReload);
});

test('R: a NEW tab/session (fresh sessionStorage) legitimately gets a different session_id, same visitor_id', async () => {
  const { getOrCreateVisitorId, getOrCreateSessionId } = await import('./telemetry.js?r2');
  const visitorIdBefore = getOrCreateVisitorId();
  const sessionIdBefore = getOrCreateSessionId();

  // Simulate closing the tab: sessionStorage resets, localStorage (visitor_id) survives.
  globalThis.sessionStorage = makeStorage();

  const visitorIdAfter = getOrCreateVisitorId();
  const sessionIdAfter = getOrCreateSessionId();

  assert.equal(visitorIdAfter, visitorIdBefore, 'visitor_id must survive across sessions on the same browser');
  assert.notEqual(sessionIdAfter, sessionIdBefore, 'a genuinely new session must get its own session_id');
});

// ── S. Storage failure cannot break initialization ──────────────────────

test('S: getOrCreateVisitorId never throws even when storage is completely unavailable', async () => {
  globalThis.localStorage = makeThrowingStorage();
  const { getOrCreateVisitorId } = await import('./telemetry.js?s1');
  let id;
  assert.doesNotThrow(() => { id = getOrCreateVisitorId(); });
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
});

test('S: getOrCreateSessionId never throws even when storage is completely unavailable', async () => {
  globalThis.sessionStorage = makeThrowingStorage();
  const { getOrCreateSessionId } = await import('./telemetry.js?s2');
  let id;
  assert.doesNotThrow(() => { id = getOrCreateSessionId(); });
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
});

test('S: reportFrontendError never throws even with no window/document/fetch available', async () => {
  const { reportFrontendError } = await import('./telemetry.js?s3');
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
  assert.doesNotThrow(() => reportFrontendError({ message: 'boom', source: 'window.error' }));
});

test('S: initTelemetry never throws even with no storage/window/fetch available', async () => {
  const { initTelemetry } = await import('./telemetry.js?s4');
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
  assert.doesNotThrow(() => initTelemetry());
});
