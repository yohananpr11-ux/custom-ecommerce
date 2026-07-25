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
// Mirrors App.jsx's onClick / createOrder / onApprove / onCancel / onError
// callbacks exactly as written (see frontend/src/App.jsx, PayPalButtons
// block) PLUS the render-time forceReRender sync line, with all component
// state/refs replaced by injected spies/plain objects so the full contract
// -- including the onClick-through-createOrder timing gap -- can be
// asserted without mounting React or the PayPal SDK.

function buildHarness({ createPayPalOrderImpl, capturePayPalOrderImpl, sanitizePayPalError, computePaypalForceRerenderKey }) {
  const calls = {
    toast: [],
    processing: [],
    cartCleared: false,
    navigated: [],
    consoleLog: [],
    consoleWarn: [],
    consoleError: [],
    createOrderInvocations: 0,
    forceRerenderKeyHistory: [],
  };

  // "Component state", mutable so tests can simulate a late async update.
  const state = { currency: 'USD', cartTotal: 5, paypalClientId: 'client-a' };
  const currentKey = () => [state.currency, state.cartTotal, state.paypalClientId];

  const paypalFlowActiveRef = { current: false };
  const paypalForceRerenderKeyRef = { current: currentKey() };

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

  // Mirrors App.jsx's render-body sync line (runs on every render).
  const rerender = () => {
    paypalForceRerenderKeyRef.current = computePaypalForceRerenderKey(
      paypalForceRerenderKeyRef.current,
      currentKey(),
      paypalFlowActiveRef.current
    );
    calls.forceRerenderKeyHistory.push([...paypalForceRerenderKeyRef.current]);
    return paypalForceRerenderKeyRef.current;
  };
  rerender(); // initial mount render

  // Simulates a late async update (geolocation/config fetch resolving) plus
  // the React re-render it triggers -- callable at any point in a test.
  const simulateExternalUpdate = (patch) => {
    Object.assign(state, patch);
    return rerender();
  };

  const onClick = () => {
    paypalFlowActiveRef.current = true;
    consoleSpy.log('[PAYPAL_BUTTON_CLICKED]');
  };

  const createOrder = async () => {
    calls.createOrderInvocations += 1;
    consoleSpy.log('[PAYPAL_CREATE_ORDER_CALLBACK_STARTED]');
    setIsPayPalProcessing(true);
    try {
      const orderID = await createPayPalOrderImpl();
      return orderID;
    } catch (err) {
      paypalFlowActiveRef.current = false;
      showToast(err.message || GLOBAL_ERROR_TOAST_HE);
      throw err;
    } finally {
      setIsPayPalProcessing(false);
    }
  };

  const onApprove = async (data) => {
    setIsPayPalProcessing(true);
    try {
      await capturePayPalOrderImpl(data.orderID);
      setCart();
      showToast(locale === 'he' ? 'התשלום בוצע בהצלחה! 🎉' : 'Payment Successful! 🎉');
      navigate('/success');
    } catch (err) {
      showToast(err.message || GLOBAL_ERROR_TOAST_HE);
    } finally {
      paypalFlowActiveRef.current = false;
      setIsPayPalProcessing(false);
    }
  };

  const onCancel = () => {
    paypalFlowActiveRef.current = false;
    consoleSpy.warn('[PAYPAL_FLOW_CANCELLED]');
    showToast(locale === 'he'
      ? 'התשלום לא הושלם. לא בוצע חיוב. ניתן לנסות שוב.'
      : 'Payment was not completed. No charge was made. You can try again.');
    setIsPayPalProcessing(false);
  };

  const onError = (err) => {
    paypalFlowActiveRef.current = false;
    consoleSpy.error('[PAYPAL_FLOW_ERROR]', sanitizePayPalError(err));
    showToast(GLOBAL_ERROR_TOAST_HE);
    setIsPayPalProcessing(false);
  };

  return {
    calls, state, paypalFlowActiveRef, paypalForceRerenderKeyRef,
    onClick, createOrder, onApprove, onCancel, onError,
    setCart, navigate, rerender, simulateExternalUpdate,
  };
}

async function makeHarness(overrides = {}) {
  const { sanitizePayPalError, computePaypalForceRerenderKey } = await helpersPromise;
  return buildHarness({
    createPayPalOrderImpl: async () => { throw new Error('unused'); },
    capturePayPalOrderImpl: async () => ({ success: true }),
    sanitizePayPalError,
    computePaypalForceRerenderKey,
    ...overrides,
  });
}

test('onCancel: exactly one toast, resets processing, no cart-clear, no navigation, clears flow-active', async () => {
  const h = await makeHarness();

  h.onClick();
  h.onCancel();

  assert.equal(h.calls.toast.length, 1);
  assert.equal(h.calls.toast[0], 'התשלום לא הושלם. לא בוצע חיוב. ניתן לנסות שוב.');
  assert.deepEqual(h.calls.processing, [false]);
  assert.equal(h.calls.cartCleared, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.equal(h.calls.consoleWarn.length, 1);
  assert.equal(h.calls.consoleWarn[0][0], '[PAYPAL_FLOW_CANCELLED]');
  assert.equal(h.paypalFlowActiveRef.current, false, 'flow-active ref must be cleared so a later cart/coupon change is reflected again');
});

test('onError: exactly one toast, sanitized console payload only, resets processing, clears flow-active', async () => {
  const h = await makeHarness();

  h.onClick();
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
  assert.equal(h.paypalFlowActiveRef.current, false);
});

test('createOrder: still invoked normally and returns the order id on success (breadcrumbs are additive only)', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'REAL-ORDER-ID' });

  h.onClick();
  const orderID = await h.createOrder();

  assert.equal(orderID, 'REAL-ORDER-ID');
  assert.equal(h.calls.createOrderInvocations, 1);
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.equal(h.calls.toast.length, 0, 'no toast on the success path');
  assert.equal(h.calls.consoleLog[h.calls.consoleLog.length - 1][0], '[PAYPAL_CREATE_ORDER_CALLBACK_STARTED]');
  assert.equal(h.paypalFlowActiveRef.current, true, 'stays active through createOrder success -- onApprove still to come');
});

test('createOrder: a genuine failure still toasts and rethrows exactly as before, and clears flow-active', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => { throw new Error('Missing shipping details'); } });

  h.onClick();
  await assert.rejects(() => h.createOrder(), /Missing shipping details/);
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.deepEqual(h.calls.toast, ['Missing shipping details']);
  assert.equal(h.paypalFlowActiveRef.current, false, 'a rejected createOrder is a terminal outcome -- no onApprove will follow');
});

test('onApprove: successful capture clears flow-active, clears cart, navigates, shows exactly one toast', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'ORDER-1', capturePayPalOrderImpl: async () => ({ success: true }) });

  h.onClick();
  await h.createOrder();
  await h.onApprove({ orderID: 'ORDER-1' });

  assert.equal(h.calls.toast.length, 1);
  assert.equal(h.calls.cartCleared, true);
  assert.deepEqual(h.calls.navigated, ['/success']);
  assert.equal(h.paypalFlowActiveRef.current, false);
});

test('onApprove: a capture failure toasts, does NOT clear cart or navigate, and clears flow-active', async () => {
  const h = await makeHarness({
    createPayPalOrderImpl: async () => 'ORDER-1',
    capturePayPalOrderImpl: async () => { throw new Error('Failed to capture PayPal order'); },
  });

  h.onClick();
  await h.createOrder();
  await h.onApprove({ orderID: 'ORDER-1' });

  assert.deepEqual(h.calls.toast, ['Failed to capture PayPal order']);
  assert.equal(h.calls.cartCleared, false, 'no false success on a capture failure');
  assert.equal(h.calls.navigated.length, 0, 'no navigation to /success on a capture failure');
  assert.equal(h.paypalFlowActiveRef.current, false);
});

test('onClick breadcrumb never touches toast, processing, cart, or navigation state', async () => {
  const h = await makeHarness();

  h.onClick();

  assert.equal(h.calls.toast.length, 0);
  assert.equal(h.calls.processing.length, 0);
  assert.equal(h.calls.cartCleared, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.deepEqual(h.calls.consoleLog[0], ['[PAYPAL_BUTTON_CLICKED]']);
});

// --- The timing-gap regression: onClick -> (late async update) -> createOrder ---

test('GAP FIX: a late currency/config update between onClick and createOrder does not change the forceReRender key', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'ORDER-1' });

  const keyBeforeClick = h.paypalForceRerenderKeyRef.current;

  h.onClick(); // SDK acknowledges the click synchronously
  // A pending geolocation/config fetch resolves *before* createOrder runs.
  h.simulateExternalUpdate({ currency: 'ILS', paypalClientId: 'client-b' });

  assert.deepEqual(
    h.paypalForceRerenderKeyRef.current,
    keyBeforeClick,
    'forceReRender key must stay frozen across the onClick -> createOrder gap'
  );

  await h.createOrder();
  assert.equal(h.calls.createOrderInvocations, 1, 'createOrder must still be invoked exactly once');
});

test('GAP FIX: without the flow-active ref, the same late update WOULD have changed the key (sanity control)', async () => {
  const { computePaypalForceRerenderKey } = await helpersPromise;
  const previousKey = ['USD', 5, 'client-a'];
  const lateKey = ['ILS', 5, 'client-a'];
  // isProcessing=false here mirrors the OLD (pre-fix) behavior, where
  // isPayPalProcessing only became true inside createOrder itself.
  const resultUnderOldBehavior = computePaypalForceRerenderKey(previousKey, lateKey, false);
  assert.notDeepEqual(resultUnderOldBehavior, previousKey, 'demonstrates the gap existed before onClick set any flag synchronously');
});

test('GAP FIX: the freeze remains active through a successful createOrder into onApprove, and only releases on completion', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'ORDER-1', capturePayPalOrderImpl: async () => ({ success: true }) });

  h.onClick();
  h.simulateExternalUpdate({ currency: 'ILS' }); // still frozen: onClick already set the ref
  await h.createOrder();
  h.simulateExternalUpdate({ cartTotal: 999 }); // still frozen: onApprove hasn't run yet
  assert.equal(h.paypalFlowActiveRef.current, true);
  const frozenKey = h.paypalForceRerenderKeyRef.current;
  assert.deepEqual(frozenKey, ['USD', 5, 'client-a'], 'every late update during the whole active flow was ignored');

  await h.onApprove({ orderID: 'ORDER-1' });
  assert.equal(h.paypalFlowActiveRef.current, false);

  const afterCompletion = h.simulateExternalUpdate({ currency: 'USD' }); // no-op value change, but re-render happens
  // Now idle again: the key tracks state.
  assert.deepEqual(afterCompletion, ['USD', 999, 'client-a']);
});

test('GAP FIX: idle cart/coupon changes (no active flow) still update the key normally, no gap-fix regression', async () => {
  const h = await makeHarness();

  const updated = h.simulateExternalUpdate({ cartTotal: 134.9 });
  assert.deepEqual(updated, ['USD', 134.9, 'client-a']);
});

test('GAP FIX: invalid-form createOrder rejection does not leave flow-active stuck true (self-heals)', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => { throw new Error('Missing shipping details'); } });

  h.onClick();
  assert.equal(h.paypalFlowActiveRef.current, true, 'briefly active between click and the validation throw');
  await assert.rejects(() => h.createOrder());
  assert.equal(h.paypalFlowActiveRef.current, false, 'self-heals immediately -- does not stay stuck true');

  // And a subsequent legitimate update is reflected again afterward.
  const updated = h.simulateExternalUpdate({ cartTotal: 42 });
  assert.deepEqual(updated, ['USD', 42, 'client-a']);
});
