/**
 * db-init-harness.cjs
 * ──────────────────────────────────────────────────────────────────────────
 * Test-only harness used by backend/tests/legacy-schema-migration.test.js.
 *
 * Requires the real backend/db.js fresh (this process has never required
 * anything before -- a genuine fresh Node process, not a require-cache
 * trick) against whatever DB_PATH points at, waits for its async
 * column/table migration IIFE to settle, then exits. Used twice against
 * the same file by the parent test to prove repeated-startup migration is
 * safe without Node's module cache hiding what "requiring db.js again"
 * actually does inside one long-lived process.
 */

'use strict';

require('../db.js');

// db.js's own schema/column migration runs inside an unawaited async IIFE
// (see the comment in db.js above it) -- there is no exported "ready"
// promise to await, so this harness waits a fixed, generous margin the
// same way the existing test suite already does for the same reason.
setTimeout(() => {
  console.log('DB_INIT_HARNESS_DONE=true');
  process.exit(0);
}, 1200);
