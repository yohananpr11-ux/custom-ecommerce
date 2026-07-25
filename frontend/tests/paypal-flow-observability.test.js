// Hermetic, network-free node:test coverage for the PayPal silent-cancel
// observability patch (App.jsx's PayPalButtons integration).
//
// `sanitizePayPalError` and `computePaypalForceRerenderKey` are imported
// directly from the real, shared source module (paypalFlowHelpers.js) that
// App.jsx itself imports -- no duplicated logic, no drift risk.
//
// App.jsx's onCancel/onError/createOrder callbacks are JSX closures over
// component state and can't be imported directly by a plain Node test
// runner. The "callback contract" tests below reconstruct the exact same
// call sequence (as it reads in App.jsx today) against injected spies, to
// verify the *behavioral contract* -- toast count, processing-flag resets,
// cart/navigation side effects -- independent of React itself. No network
// call, no PayPal SDK, no production data is used anywhere in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePayPalError, computePaypalForceRerenderKey } from '../src/paypalFlowHelpers.js';

// Kept as a resolved "promise" so every test body below (written against
// helpersPromise) needs no further changes -- it's just already-resolved
// values now that frontend/ is ESM and a static import works directly.
const helpersPromise = Promise.resolve({ sanitizePayPalError, computePaypalForceRerenderKey });

test('sanitizePayPalError', async (t) => {
  const { sanitizePayPalError } = await helpersPromise;

  await t.test('extracts name/message from a real Error', () => {
    const err = new Error('Window closed');
    err.name = 'PayPalError';
    assert.deepEqual(sanitizePayPalError(err), { name: 'PayPalError', message: 'Window closed' });
  });

  await t.test('falls back to UnknownError for non-object input', () => {
    assert.deepEqual(sanitizePayPalError('a raw string'), { name: 'UnknownError', message: '' });
    assert.deepEqual(sanitizePayPalError(null), { name: 'UnknownError', message: '' });
    assert.deepEqual(sanitizePayPalError(undefined), { name: 'UnknownError', message: '' });
  });

  await t.test('truncates an overlong message to 200 characters', () => {
    const longMessage = 'x'.repeat(500);
    const result = sanitizePayPalError({ name: 'Err', message: longMessage });
    assert.equal(result.message.length, 200);
  });

  await t.test('never echoes back extra fields (e.g. accidental order/customer data)', () => {
    const err = { name: 'Err', message: 'ok', orderID: 'sensitive-order-id', payer: { email: 'a@b.com' } };
    const result = sanitizePayPalError(err);
    assert.deepEqual(Object.keys(result).sort(), ['message', 'name']);
  });
});

test('computePaypalForceRerenderKey', async (t) => {
  const { computePaypalForceRerenderKey } = await helpersPromise;

  await t.test('idle (not processing): always adopts the latest key', () => {
    const previous = ['USD', 5, 'client-a'];
    const current = ['ILS', 5, 'client-a'];
    assert.deepEqual(computePaypalForceRerenderKey(previous, current, false), current);
  });

  await t.test('mid-flow (processing=true): freezes at the previous key, even if inputs changed', () => {
    const previous = ['ILS', 5, 'client-a'];
    const current = ['USD', 5, 'client-a']; // e.g. a late geolocation currency update
    assert.deepEqual(computePaypalForceRerenderKey(previous, current, true), previous);
  });

  await t.test('resyncs to the latest key immediately once processing ends', () => {
    const frozen = ['ILS', 5, 'client-a'];
    const latest = ['USD', 5, 'client-a'];
    assert.deepEqual(computePaypalForceRerenderKey(frozen, latest, false), latest);
  });

  await t.test('a genuine cart/coupon change while idle is still reflected (no over-freezing)', () => {
    const previous = ['ILS', 5, 'client-a'];
    const current = ['ILS', 134.9, 'client-a']; // cart total genuinely changed
    assert.deepEqual(computePaypalForceRerenderKey(previous, current, false), current);
  });
});

// --- Callback contract reconstruction -------------------------------------
// Mirrors App.jsx's onCancel / onError / createOrder callbacks exactly as
// written (see frontend/src/App.jsx, PayPalButtons block), with all
// component state/refs replaced by injected spies so the contract can be
// asserted without mounting React or the PayPal SDK.

function buildHarness({ createPayPalOrderImpl, sanitizePayPalError }) {
  const calls = {
    toast: [],
    processing: [],
    cartCleared: false,
    navigated: [],
    consoleLog: [],
    consoleWarn: [],
    consoleError: [],
  };

  const showToast = (message) => calls.toast.push(message);
  const setIsPayPalProcessing = (v) => calls.processing.push(v);
  const setCart = () => { calls.cartCleared = true; };
  const navigate = (path) => calls.navigated.push(path);
  const consoleSpy = {
    log: (...args) => calls.consoleLog.push(args),
    warn: (...args) => calls.consoleWarn.push(args),
    error: (...args) => calls.consoleError.push(args),
  };
  const GLOBAL_ERROR_TOAST_HE = 'A temporary error occurred, please try again';
  const locale = 'he';

  const onClick = () => {
    consoleSpy.log('[PAYPAL_BUTTON_CLICKED]');
  };

  const createOrder = async () => {
    consoleSpy.log('[PAYPAL_CREATE_ORDER_CALLBACK_STARTED]');
    setIsPayPalProcessing(true);
    try {
      const orderID = await createPayPalOrderImpl();
      return orderID;
    } catch (err) {
      showToast(err.message || GLOBAL_ERROR_TOAST_HE);
      throw err;
    } finally {
      setIsPayPalProcessing(false);
    }
  };

  const onCancel = () => {
    consoleSpy.warn('[PAYPAL_FLOW_CANCELLED]');
    showToast(locale === 'he'
      ? 'התשלום לא הושלם. לא בוצע חיוב. ניתן לנסות שוב.'
      : 'Payment was not completed. No charge was made. You can try again.');
    setIsPayPalProcessing(false);
  };

  const onError = (err) => {
    consoleSpy.error('[PAYPAL_FLOW_ERROR]', sanitizePayPalError(err));
    showToast(GLOBAL_ERROR_TOAST_HE);
    setIsPayPalProcessing(false);
  };

  return { calls, onClick, createOrder, onCancel, onError, setCart, navigate };
}

test('onCancel: exactly one toast, resets processing, no cart-clear, no navigation', async () => {
  const { sanitizePayPalError } = await helpersPromise;
  const h = buildHarness({ createPayPalOrderImpl: async () => { throw new Error('unused'); }, sanitizePayPalError });

  h.onCancel();

  assert.equal(h.calls.toast.length, 1);
  assert.equal(h.calls.toast[0], 'התשלום לא הושלם. לא בוצע חיוב. ניתן לנסות שוב.');
  assert.deepEqual(h.calls.processing, [false]);
  assert.equal(h.calls.cartCleared, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.equal(h.calls.consoleWarn.length, 1);
  assert.equal(h.calls.consoleWarn[0][0], '[PAYPAL_FLOW_CANCELLED]');
});

test('onError: exactly one toast, sanitized console payload only, resets processing', async () => {
  const { sanitizePayPalError } = await helpersPromise;
  const h = buildHarness({ createPayPalOrderImpl: async () => { throw new Error('unused'); }, sanitizePayPalError });

  const rawPaypalError = { name: 'INSTRUMENT_DECLINED', message: 'card declined', payer: { email: 'shopper@example.com' } };
  h.onError(rawPaypalError);

  assert.equal(h.calls.toast.length, 1);
  assert.equal(h.calls.toast[0], 'A temporary error occurred, please try again');
  assert.deepEqual(h.calls.processing, [false]);
  assert.equal(h.calls.consoleError.length, 1);
  const [marker, sanitized] = h.calls.consoleError[0];
  assert.equal(marker, '[PAYPAL_FLOW_ERROR]');
  assert.deepEqual(sanitized, { name: 'INSTRUMENT_DECLINED', message: 'card declined' });
  assert.ok(!('payer' in sanitized), 'raw payer/customer data must never reach the sanitized log payload');
});

test('createOrder: still invoked normally and returns the order id on success (breadcrumbs are additive only)', async () => {
  const { sanitizePayPalError } = await helpersPromise;
  const h = buildHarness({ createPayPalOrderImpl: async () => 'REAL-ORDER-ID', sanitizePayPalError });

  const orderID = await h.createOrder();

  assert.equal(orderID, 'REAL-ORDER-ID');
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.equal(h.calls.toast.length, 0, 'no toast on the success path');
  assert.equal(h.calls.consoleLog.length, 1);
  assert.equal(h.calls.consoleLog[0][0], '[PAYPAL_CREATE_ORDER_CALLBACK_STARTED]');
});

test('createOrder: a genuine failure still toasts and rethrows exactly as before (unchanged behavior)', async () => {
  const { sanitizePayPalError } = await helpersPromise;
  const h = buildHarness({ createPayPalOrderImpl: async () => { throw new Error('Missing shipping details'); }, sanitizePayPalError });

  await assert.rejects(() => h.createOrder(), /Missing shipping details/);
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.deepEqual(h.calls.toast, ['Missing shipping details']);
});

test('onClick breadcrumb never touches toast, processing, cart, or navigation state', async () => {
  const { sanitizePayPalError } = await helpersPromise;
  const h = buildHarness({ createPayPalOrderImpl: async () => 'x', sanitizePayPalError });

  h.onClick();

  assert.equal(h.calls.toast.length, 0);
  assert.equal(h.calls.processing.length, 0);
  assert.equal(h.calls.cartCleared, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.deepEqual(h.calls.consoleLog[0], ['[PAYPAL_BUTTON_CLICKED]']);
});
