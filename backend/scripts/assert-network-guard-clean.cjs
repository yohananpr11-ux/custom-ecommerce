#!/usr/bin/env node
/**
 * Fail-closed verification gate for network-guard.cjs's JSONL log.
 *
 * A blocked entry proves the guard did its job (nothing actually reached
 * the real network), but it also proves some code path attempted an
 * external call that a genuinely hermetic run should never attempt in the
 * first place. Checkpoint 2C treated "blocked" as equivalent to "safe" and
 * let the run pass anyway — this closes that gap: ANY blocked entry fails
 * the checkpoint, loudly, with the exact offending host(s) named.
 *
 * Checkpoint 2E.1 review hardening (see assert-network-guard-clean.selftest.cjs):
 *   - Every record's key SET is checked exactly — missing fields fail, and
 *     so do EXTRA fields (a record with an unexpected extra key is exactly
 *     as untrustworthy as one missing a required key: something wrote this
 *     log entry that doesn't match either known writer).
 *   - "pid" must be a positive integer, not just "a number" (0, -1, 1.5,
 *     NaN, Infinity are all rejected).
 *   - "timestamp" must be a well-formed ISO 8601 UTC string matching
 *     exactly what `new Date().toISOString()` produces (the only thing
 *     network-guard.cjs ever writes) — not just "parseable by Date.parse",
 *     which accepts a much looser set of strings than the writer emits.
 *   - No "summary" record type exists any more (see network-guard.cjs's
 *     own comment on this): a record aggregating other records invites a
 *     "does the aggregate agree with the details" reconciliation problem,
 *     worse when multiple processes share one log file. allowed/blocked
 *     counts are derived here directly from the atomic per-request
 *     records — there is nothing else to trust or recompute. A record
 *     shaped like the old summary type is now simply unrecognized and
 *     rejected like any other unknown schema.
 *   - The final line of the file is validated exactly like every other
 *     line — a truncated/malformed last write (e.g. a process killed
 *     mid-append) fails the same way a malformed line anywhere else would.
 *
 * Usage:
 *   node scripts/assert-network-guard-clean.cjs <path-to-network-guard.jsonl> [<path2> ...]
 *
 * verifyLog(path) and validateEntry(entry) are also exported for the
 * self-test suite.
 */

const fs = require('fs');

const ACTIVATION_KEYS = ['activated', 'pid', 'timestamp'];
const NETWORK_KEYS = ['moduleName', 'method', 'hostname', 'allowed', 'timestamp'];

// Matches exactly what `new Date().toISOString()` produces, e.g.
// "2026-07-18T01:24:23.877Z" — network-guard.cjs never writes any other
// timestamp shape, so nothing looser needs to be accepted.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isValidIsoTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP_RE.test(value);
}

function keySetMatches(entry, expectedKeys) {
  const actualKeys = Object.keys(entry);
  if (actualKeys.length !== expectedKeys.length) return false;
  const expectedSet = new Set(expectedKeys);
  return actualKeys.every((k) => expectedSet.has(k));
}

/**
 * Classifies and field/type-validates a single parsed JSON value against
 * the two record shapes network-guard.cjs writes. Returns
 * { valid: true, type, ... } or { valid: false, reason }.
 */
function validateEntry(entry) {
  if (!isPlainObject(entry)) {
    return { valid: false, reason: `record is not a JSON object (got ${Array.isArray(entry) ? 'array' : typeof entry}: ${JSON.stringify(entry)})` };
  }

  if (entry.activated === true) {
    if (!keySetMatches(entry, ACTIVATION_KEYS)) {
      return {
        valid: false,
        reason: `activation record has the wrong key set — got [${Object.keys(entry).join(', ')}], expected exactly [${ACTIVATION_KEYS.join(', ')}]`,
      };
    }
    if (!isPositiveInteger(entry.pid)) {
      return { valid: false, reason: `activation record has invalid "pid" (must be a positive integer): ${JSON.stringify(entry.pid)}` };
    }
    if (!isValidIsoTimestamp(entry.timestamp)) {
      return { valid: false, reason: `activation record has invalid "timestamp" (must be ISO 8601 UTC, e.g. 2026-01-01T00:00:00.000Z): ${JSON.stringify(entry.timestamp)}` };
    }
    return { valid: true, type: 'activation' };
  }

  if ('allowed' in entry) {
    if (!keySetMatches(entry, NETWORK_KEYS)) {
      return {
        valid: false,
        reason: `network record has the wrong key set — got [${Object.keys(entry).join(', ')}], expected exactly [${NETWORK_KEYS.join(', ')}]`,
      };
    }
    if (typeof entry.allowed !== 'boolean') {
      return { valid: false, reason: `network record has non-boolean "allowed": ${JSON.stringify(entry.allowed)}` };
    }
    if (!isNonEmptyString(entry.moduleName)) {
      return { valid: false, reason: `network record has invalid "moduleName": ${JSON.stringify(entry.moduleName)}` };
    }
    if (!isNonEmptyString(entry.method)) {
      return { valid: false, reason: `network record has invalid "method": ${JSON.stringify(entry.method)}` };
    }
    if (entry.hostname !== null && typeof entry.hostname !== 'string') {
      return { valid: false, reason: `network record has invalid "hostname" (must be string or null): ${JSON.stringify(entry.hostname)}` };
    }
    if (!isValidIsoTimestamp(entry.timestamp)) {
      return { valid: false, reason: `network record has invalid "timestamp" (must be ISO 8601 UTC, e.g. 2026-01-01T00:00:00.000Z): ${JSON.stringify(entry.timestamp)}` };
    }
    return { valid: true, type: 'network', allowed: entry.allowed };
  }

  return { valid: false, reason: `unrecognized record shape — matches no known schema (activation/network): ${JSON.stringify(entry)}` };
}

function verifyLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return { ok: false, reason: 'log file does not exist (guard was never loaded for this phase)' };
  }

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { ok: false, reason: 'log file is empty — no activation marker, no request outcomes (guard was never loaded, or never wrote anything)' };
  }

  let hasActivationMarker = false;
  let allowedCount = 0;
  const blockedEntries = [];

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return { ok: false, reason: `malformed JSON line (possibly a truncated final write): ${JSON.stringify(line)} (${err.message})` };
    }

    const result = validateEntry(parsed);
    if (!result.valid) {
      return { ok: false, reason: `invalid log record — ${result.reason}` };
    }

    if (result.type === 'activation') {
      hasActivationMarker = true;
    } else if (result.type === 'network') {
      if (result.allowed === false) blockedEntries.push(parsed);
      else allowedCount += 1;
    }
  }

  if (!hasActivationMarker) {
    return { ok: false, reason: 'no guard-activation marker found — cannot prove the guard was genuinely loaded for this phase, not just that the log happens to be non-empty' };
  }

  if (blockedEntries.length > 0) {
    return {
      ok: false,
      reason: `${blockedEntries.length} blocked external attempt(s)`,
      blockedEntries,
      allowedCount,
    };
  }

  return { ok: true, allowedCount, blockedEntries: [] };
}

module.exports = { verifyLog, validateEntry, isPlainObject, isPositiveInteger, isValidIsoTimestamp };

if (require.main === module) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: node assert-network-guard-clean.cjs <path-to-network-guard.jsonl> [<path2> ...]');
    process.exit(1);
  }

  let totalAllowed = 0;
  let totalBlocked = 0;
  let failures = 0;

  for (const p of paths) {
    const result = verifyLog(p);
    totalAllowed += result.allowedCount || 0;
    totalBlocked += (result.blockedEntries || []).length;

    if (!result.ok) {
      failures += 1;
      console.log(`  FAIL  ${p} — ${result.reason}`);
      if (result.blockedEntries) {
        for (const entry of result.blockedEntries) {
          console.log(`          ${entry.moduleName}.${entry.method} -> "${entry.hostname}" at ${entry.timestamp}`);
        }
      }
      continue;
    }
    console.log(`  PASS  ${p} — activation marker present, 0 blocked attempts (${result.allowedCount} allowed/loopback)`);
  }

  console.log(`\nTotals across ${paths.length} log(s): ${totalAllowed} allowed, ${totalBlocked} blocked.`);
  console.log(
    failures === 0
      ? 'NETWORK GUARD: CLEAN — zero external HTTP(S) egress anywhere, activation proven for every phase, every record schema-valid (exact key sets, positive-integer pid, ISO timestamps).'
      : `NETWORK GUARD: ${failures} LOG(S) FAILED — see above.`
  );
  process.exit(failures === 0 ? 0 : 1);
}
