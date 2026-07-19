'use strict';

// Pure, side-effect-free check: does a PayPal capture response satisfy the
// expectation snapshotted server-side at order-creation time? Extracted so
// it can be unit-tested with zero network/DB calls, and so the real capture
// route (backend/index.js) and the test suite are provably running the same
// logic.
const validatePaypalCaptureAgainstExpectation = ({
  captureStatus,
  captureCurrency,
  captureValue,
  expectedCurrency,
  expectedAmount,
  tolerance = 0.02,
}) => {
  if (captureStatus !== 'COMPLETED') {
    return { ok: false, reason: 'not_completed' };
  }
  // expectedAmount == null catches both null and undefined explicitly —
  // Number(null) coerces to 0, which is a finite number, so checking
  // Number.isFinite(Number(expectedAmount)) alone would treat a genuinely
  // missing expectation as "expected amount is zero" and let a $0 capture
  // pass. A stored 0 (if that's ever legitimate) still passes correctly.
  if (!expectedCurrency || expectedAmount == null || !Number.isFinite(Number(expectedAmount))) {
    return { ok: false, reason: 'missing_expectation' };
  }
  if (String(captureCurrency || '').toUpperCase() !== String(expectedCurrency).toUpperCase()) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  const numericCaptureValue = Number(captureValue);
  if (!Number.isFinite(numericCaptureValue) || Math.abs(numericCaptureValue - Number(expectedAmount)) > tolerance) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  return { ok: true };
};

module.exports = { validatePaypalCaptureAgainstExpectation };
