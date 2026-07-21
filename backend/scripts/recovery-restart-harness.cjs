/**
 * recovery-restart-harness.cjs
 * ──────────────────────────────────────────────────────────────────────────
 * Test-only harness used by backend/tests/fulfillment-recovery.test.js to
 * prove restart recovery in a genuinely fresh Node process, not merely by
 * calling the same in-memory function twice.
 *
 * Reads DB_PATH from the environment (a synthetic temp SQLite file the
 * parent test already seeded and closed its own handle to), requires the
 * real backend/index.js and backend/services/fulfillment-recovery.js fresh
 * (this process has never required anything before), runs exactly one
 * recovery pass against whatever durable state is already persisted in
 * that file, prints a single JSON result line, and exits.
 *
 * Safety: PRINTIFY_API_TOKEN is deliberately left unset by the parent test.
 * services/printify.js's own existing guard
 * (`if (!this.token || this.token === 'YOUR_PRINTIFY_TOKEN')`) makes every
 * one of its four fulfillment operations return a structurally mocked
 * result with zero HTTP calls in that case -- no test-only network mocking
 * is needed or used here; this relies on the same production code path a
 * genuinely misconfigured deployment would take, which is the strongest
 * available proof that no live request occurs.
 *
 * require.main !== module when index.js is require()'d (not run directly),
 * so app.listen()/cron registration never happens here -- this harness
 * calls recoverStalePaidFulfillments() directly, once, rather than waiting
 * on a real timer/cron schedule.
 */

'use strict';

(async () => {
  const { processPaidOrderFulfillment } = require('../index.js');
  const { recoverStalePaidFulfillments } = require('../services/fulfillment-recovery.js');

  const result = await recoverStalePaidFulfillments({ processPaidOrderFulfillment });
  console.log('RECOVERY_HARNESS_RESULT=' + JSON.stringify(result));
  process.exit(0);
})().catch((err) => {
  console.log('RECOVERY_HARNESS_ERROR=' + JSON.stringify({ message: err.message }));
  process.exit(1);
});
