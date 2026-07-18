/**
 * Hermetic-test network guard.
 *
 * Preload via `node -r ./scripts/network-guard.cjs index.js` (or
 * `NODE_OPTIONS='-r ./scripts/network-guard.cjs'`). Patches every
 * outbound-request entry point Node exposes — http.request, http.get,
 * https.request, https.get, and globalThis.fetch (Node's built-in,
 * Undici-backed fetch) — so that during a verification run, any attempt to
 * reach a host other than localhost/127.0.0.1/::1 is hard-blocked *before*
 * a socket or DNS lookup ever happens, and recorded, even if the calling
 * code swallows the resulting error internally (e.g. pricing.js's
 * fetchExchangeRate try/catch, or telegram.js's sendMessage try/catch).
 *
 * Set NETWORK_GUARD_LOG_PATH to an absolute file path to get a live JSONL
 * append-log: one activation record on load, then one record per request
 * attempt (allowed or blocked). No end-of-process summary record — see the
 * comment above the (removed) exit handler for why. Without a log path, the
 * report is only available in-process via globalThis.__networkGuardReport().
 */

const http = require('http');
const https = require('https');
const fs = require('fs');

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const logPath = process.env.NETWORK_GUARD_LOG_PATH || null;

const attempts = [];
let blockedCount = 0;
let allowedCount = 0;

function appendLog(record) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  } catch {
    // Never let logging itself break the guard.
  }
}

// Normalizes any of the host forms Node's http/https/URL APIs can hand us
// down to a bare, bracket-free, port-free lowercase host:
//   "::1"          -> "::1"   (bare IPv6 — 3+ colon-separated groups)
//   "[::1]"        -> "::1"   (bracketed IPv6, as WHATWG URL#hostname returns it)
//   "[::1]:3000"   -> "::1"   (bracketed IPv6 + port, as options.host commonly is)
//   "127.0.0.1"    -> "127.0.0.1"
//   "127.0.0.1:80" -> "127.0.0.1"
//   "localhost:80" -> "localhost"
// A naive `.split(':')[0]` breaks on every bracketed-IPv6 form (it would
// return just "[" for "[::1]:3000"), which is the exact bug this replaces.
function normalizeHostCandidate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const bracketMatch = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) return bracketMatch[1].toLowerCase();

  // Bare IPv6 has at least two colons (e.g. "::1"); a host:port pair has
  // exactly one. This distinguishes "::1" from "127.0.0.1:80"/"localhost:80".
  if (s.split(':').length > 2) return s.toLowerCase();

  const colonIdx = s.indexOf(':');
  return (colonIdx === -1 ? s : s.slice(0, colonIdx)).toLowerCase();
}

function isAllowedHost(hostname) {
  const normalized = normalizeHostCandidate(hostname);
  if (!normalized) return false;
  return ALLOWED_HOSTS.has(normalized);
}

function extractHostFromArgs(args) {
  const first = args[0];
  if (typeof first === 'string') {
    try { return normalizeHostCandidate(new URL(first).hostname); } catch { return normalizeHostCandidate(first); }
  }
  if (first instanceof URL) return normalizeHostCandidate(first.hostname);
  if (first && typeof first === 'object') {
    if (first.hostname) return normalizeHostCandidate(first.hostname);
    if (first.host) return normalizeHostCandidate(first.host);
  }
  const second = args[1];
  if (second && typeof second === 'object' && !Buffer.isBuffer(second)) {
    if (second.hostname) return normalizeHostCandidate(second.hostname);
    if (second.host) return normalizeHostCandidate(second.host);
  }
  return null;
}

function record(moduleName, method, hostname, allowed) {
  const entry = { moduleName, method, hostname, allowed, timestamp: new Date().toISOString() };
  attempts.push(entry);
  if (allowed) allowedCount += 1; else blockedCount += 1;
  appendLog(entry);
  return entry;
}

function guardModule(mod, moduleName) {
  ['request', 'get'].forEach((method) => {
    const original = mod[method].bind(mod);
    mod[method] = function guarded(...args) {
      const hostname = extractHostFromArgs(args);

      if (isAllowedHost(hostname)) {
        record(moduleName, method, hostname, true);
        return original(...args);
      }

      record(moduleName, method, hostname, false);
      const err = new Error(
        `[network-guard] BLOCKED outbound ${moduleName}.${method} to host "${hostname}" — `
        + 'hermetic test run only allows localhost/127.0.0.1/::1.'
      );
      err.code = 'NETWORK_GUARD_BLOCKED';
      console.error(err.message);

      // Return a request-like EventEmitter that fails the same way calling
      // code would see a real connection failure, without ever touching DNS
      // or a real socket.
      const { EventEmitter } = require('events');
      const fakeReq = new EventEmitter();
      fakeReq.write = () => {};
      fakeReq.end = () => { setImmediate(() => fakeReq.emit('error', err)); };
      fakeReq.destroy = () => {};
      fakeReq.setTimeout = () => fakeReq;
      fakeReq.abort = () => {};
      setImmediate(() => fakeReq.emit('error', err));
      return fakeReq;
    };
  });
}

guardModule(http, 'http');
guardModule(https, 'https');

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function guardedFetch(input, init) {
    let hostname = null;
    try {
      const urlStr = typeof input === 'string' ? input : (input && input.url) || String(input);
      hostname = normalizeHostCandidate(new URL(urlStr, 'http://localhost').hostname);
    } catch {
      // leave hostname null — extraction failure is treated as blocked below
    }

    if (isAllowedHost(hostname)) {
      record('fetch', 'fetch', hostname, true);
      return originalFetch(input, init);
    }

    record('fetch', 'fetch', hostname, false);
    const err = new Error(
      `[network-guard] BLOCKED outbound fetch() to host "${hostname}" — `
      + 'hermetic test run only allows localhost/127.0.0.1/::1.'
    );
    err.code = 'NETWORK_GUARD_BLOCKED';
    console.error(err.message);
    throw err;
  };
}

globalThis.__networkGuardReport = () => ({
  allowedCount,
  blockedCount,
  attempts: attempts.slice(),
  hermetic: blockedCount === 0,
});

// Exposed for the smoke test to unit-check host classification directly,
// independent of Node's own (occasionally quirky) connection-establishment
// behavior for a given options shape.
module.exports.normalizeHostCandidate = normalizeHostCandidate;
module.exports.isAllowedHost = isAllowedHost;

// No end-of-process summary record is written (Checkpoint 2E.1 review: a
// summary line duplicating per-record data invites a "does the summary
// agree with the details" reconciliation problem, worse when several
// processes append to the same shared log file — each would need its own
// pid-scoped summary, correctly matched back to its own records). The
// verifier derives allowed/blocked counts itself, directly from the atomic
// activation/network records — there is nothing else to trust or recompute.

// Written unconditionally on load, even if zero requests are ever attempted
// during this process's lifetime. Without this, a log file's mere absence
// is ambiguous between "the guard was never loaded" (a real gap) and "the
// guard loaded but nothing ever tried to make a network call" (the best
// possible outcome) — a verification runner asserting on the log must be
// able to tell those two apart.
appendLog({ activated: true, pid: process.pid, timestamp: new Date().toISOString() });

console.log(`[network-guard] active — only localhost/127.0.0.1/::1 permitted for http/https/fetch.${logPath ? ` Logging to ${logPath}` : ''}`);
