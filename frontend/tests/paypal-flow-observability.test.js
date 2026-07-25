// Hermetic, network-free node:test coverage for the PayPal silent-cancel
// observability patch (PR #11) AND the PayPal Standard card funding source
// (fundingSource="card") sharing a cross-button payment-flow lock with the
// existing PayPal wallet button (fundingSource="paypal").
//
// All helpers (`sanitizePayPalError`, `computePaypalForceRerenderKey`,
// `buildPaypalMarker`, `resolvePaypalClickLockOwner`,
// `paypalCreateOrderMayProceed`, `releasePaypalLockIfOwner`) are imported
// directly from the real, shared source module (paypalFlowHelpers.js) that
// App.jsx itself imports -- no duplicated logic, no drift risk.
//
// App.jsx's onClick/createOrder/onApprove/onCancel/onError callbacks are
// JSX closures over component state and can't be imported directly by a
// plain Node test runner. The "callback contract" tests below reconstruct
// the exact same call sequence (as it reads in App.jsx today, via
// buildPaypalFundingCallbacks) against injected spies, to verify the
// *behavioral contract* -- toast count, processing-flag resets,
// cart/navigation side effects, and the shared lock -- independent of
// React itself. No network call, no PayPal SDK, no production data is used
// anywhere in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePayPalError,
  computePaypalForceRerenderKey,
  buildPaypalMarker,
  resolvePaypalClickLockOwner,
  paypalCreateOrderMayProceed,
  releasePaypalLockIfOwner,
} from '../src/paypalFlowHelpers.js';

const helpersPromise = Promise.resolve({
  sanitizePayPalError,
  computePaypalForceRerenderKey,
  buildPaypalMarker,
  resolvePaypalClickLockOwner,
  paypalCreateOrderMayProceed,
  releasePaypalLockIfOwner,
});

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

test('buildPaypalMarker', async () => {
  const { buildPaypalMarker } = await helpersPromise;
  assert.equal(buildPaypalMarker('PAYPAL_BUTTON_CLICKED', 'paypal'), 'PAYPAL_BUTTON_CLICKED:paypal');
  assert.equal(buildPaypalMarker('PAYPAL_BUTTON_CLICKED', 'card'), 'PAYPAL_BUTTON_CLICKED:card');
});

test('shared cross-button lock: pure transition functions', async (t) => {
  const { resolvePaypalClickLockOwner, paypalCreateOrderMayProceed, releasePaypalLockIfOwner } = await helpersPromise;

  await t.test('resolvePaypalClickLockOwner: free lock -> this funding source acquires it', () => {
    assert.equal(resolvePaypalClickLockOwner(null, 'paypal'), 'paypal');
    assert.equal(resolvePaypalClickLockOwner(null, 'card'), 'card');
  });

  await t.test('resolvePaypalClickLockOwner: already owned by this same source -> unchanged (idempotent)', () => {
    assert.equal(resolvePaypalClickLockOwner('card', 'card'), 'card');
  });

  await t.test('resolvePaypalClickLockOwner: owned by the OTHER source -> stays with the other source (this click is a no-op)', () => {
    assert.equal(resolvePaypalClickLockOwner('paypal', 'card'), 'paypal');
    assert.equal(resolvePaypalClickLockOwner('card', 'paypal'), 'card');
  });

  await t.test('paypalCreateOrderMayProceed: true only when this funding source currently owns the lock', () => {
    assert.equal(paypalCreateOrderMayProceed('paypal', 'paypal'), true);
    assert.equal(paypalCreateOrderMayProceed('card', 'card'), true);
    assert.equal(paypalCreateOrderMayProceed('paypal', 'card'), false);
    assert.equal(paypalCreateOrderMayProceed(null, 'paypal'), false);
  });

  await t.test('releasePaypalLockIfOwner: clears only if this funding source is the current owner', () => {
    assert.equal(releasePaypalLockIfOwner('card', 'card'), null);
    assert.equal(releasePaypalLockIfOwner('paypal', 'card'), 'paypal', 'must never clear a lock owned by a different, still-active flow');
    assert.equal(releasePaypalLockIfOwner(null, 'card'), null);
  });
});

// --- Callback contract reconstruction -------------------------------------
// Mirrors App.jsx's buildPaypalFundingCallbacks factory (onClick / createOrder
// / onApprove / onCancel / onError) exactly as written, PLUS the render-time
// forceReRender sync line, with all component state/refs replaced by
// injected spies/plain objects. Two harnesses can share the same
// `sharedRefs` object to simulate the two <PayPalButtons> instances that
// exist under one PayPalScriptProvider in the real component.

function buildHarness({
  fundingSource = 'paypal',
  sharedRefs,
  createPayPalOrderImpl,
  capturePayPalOrderImpl,
  sanitizePayPalError,
  computePaypalForceRerenderKey,
  resolvePaypalClickLockOwner,
  paypalCreateOrderMayProceed,
  releasePaypalLockIfOwner,
  buildPaypalMarker,
}) {
  const calls = {
    toast: [],
    processing: [],
    cartCleared: false,
    navigated: [],
    consoleLog: [],
    consoleWarn: [],
    consoleError: [],
    createOrderInvocations: 0, // every call to the createOrder callback
    createOrderRealCalls: 0, // only those that pass the lock check
    forceRerenderKeyHistory: [],
  };

  const refs = sharedRefs || {
    state: { currency: 'USD', cartTotal: 5, paypalClientId: 'client-a' },
    paypalFlowActiveRef: { current: null },
    paypalForceRerenderKeyRef: { current: null },
  };
  const { state, paypalFlowActiveRef, paypalForceRerenderKeyRef } = refs;
  const currentKey = () => [state.currency, state.cartTotal, state.paypalClientId];
  if (paypalForceRerenderKeyRef.current === null) paypalForceRerenderKeyRef.current = currentKey();

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

  const rerender = () => {
    paypalForceRerenderKeyRef.current = computePaypalForceRerenderKey(
      paypalForceRerenderKeyRef.current,
      currentKey(),
      Boolean(paypalFlowActiveRef.current)
    );
    calls.forceRerenderKeyHistory.push([...paypalForceRerenderKeyRef.current]);
    return paypalForceRerenderKeyRef.current;
  };
  rerender();

  const simulateExternalUpdate = (patch) => {
    Object.assign(state, patch);
    return rerender();
  };

  const onClick = () => {
    const nextOwner = resolvePaypalClickLockOwner(paypalFlowActiveRef.current, fundingSource);
    if (nextOwner !== fundingSource) return;
    paypalFlowActiveRef.current = nextOwner;
    consoleSpy.log(buildPaypalMarker('PAYPAL_BUTTON_CLICKED', fundingSource));
  };

  const createOrder = async () => {
    calls.createOrderInvocations += 1;
    consoleSpy.log(buildPaypalMarker('PAYPAL_CREATE_ORDER_CALLBACK_STARTED', fundingSource));
    if (!paypalCreateOrderMayProceed(paypalFlowActiveRef.current, fundingSource)) {
      const lockErr = new Error('Another payment is already in progress. Please try again in a moment.');
      showToast(lockErr.message);
      throw lockErr;
    }
    calls.createOrderRealCalls += 1;
    setIsPayPalProcessing(true);
    try {
      const orderID = await createPayPalOrderImpl();
      return orderID;
    } catch (err) {
      paypalFlowActiveRef.current = releasePaypalLockIfOwner(paypalFlowActiveRef.current, fundingSource);
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
      paypalFlowActiveRef.current = releasePaypalLockIfOwner(paypalFlowActiveRef.current, fundingSource);
      setIsPayPalProcessing(false);
    }
  };

  const onCancel = () => {
    paypalFlowActiveRef.current = releasePaypalLockIfOwner(paypalFlowActiveRef.current, fundingSource);
    consoleSpy.warn(buildPaypalMarker('PAYPAL_FLOW_CANCELLED', fundingSource));
    showToast(locale === 'he'
      ? 'התשלום לא הושלם. לא בוצע חיוב. ניתן לנסות שוב.'
      : 'Payment was not completed. No charge was made. You can try again.');
    setIsPayPalProcessing(false);
  };

  const onError = (err) => {
    paypalFlowActiveRef.current = releasePaypalLockIfOwner(paypalFlowActiveRef.current, fundingSource);
    consoleSpy.error(buildPaypalMarker('PAYPAL_FLOW_ERROR', fundingSource), sanitizePayPalError(err));
    showToast(GLOBAL_ERROR_TOAST_HE);
    setIsPayPalProcessing(false);
  };

  return {
    calls, refs, fundingSource,
    paypalFlowActiveRef, paypalForceRerenderKeyRef,
    onClick, createOrder, onApprove, onCancel, onError,
    setCart, navigate, rerender, simulateExternalUpdate,
  };
}

async function makeHarness(overrides = {}) {
  const helpers = await helpersPromise;
  return buildHarness({
    createPayPalOrderImpl: async () => { throw new Error('unused'); },
    capturePayPalOrderImpl: async () => ({ success: true }),
    ...helpers,
    ...overrides,
  });
}

function sharedRefsFor(state = { currency: 'USD', cartTotal: 5, paypalClientId: 'client-a' }) {
  return { state, paypalFlowActiveRef: { current: null }, paypalForceRerenderKeyRef: { current: null } };
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
  assert.equal(h.calls.consoleWarn[0][0], 'PAYPAL_FLOW_CANCELLED:paypal');
  assert.equal(h.paypalFlowActiveRef.current, null, 'lock must be cleared so a later cart/coupon change is reflected again');
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
  assert.equal(marker, 'PAYPAL_FLOW_ERROR:paypal');
  assert.deepEqual(sanitized, { name: 'INSTRUMENT_DECLINED', message: 'card declined' });
  assert.ok(!('payer' in sanitized), 'raw payer/customer data must never reach the sanitized log payload');
  assert.equal(h.paypalFlowActiveRef.current, null);
});

test('createOrder: still invoked normally and returns the order id on success (breadcrumbs are additive only)', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'REAL-ORDER-ID' });

  h.onClick();
  const orderID = await h.createOrder();

  assert.equal(orderID, 'REAL-ORDER-ID');
  assert.equal(h.calls.createOrderInvocations, 1);
  assert.equal(h.calls.createOrderRealCalls, 1);
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.equal(h.calls.toast.length, 0, 'no toast on the success path');
  assert.equal(h.calls.consoleLog[h.calls.consoleLog.length - 1][0], 'PAYPAL_CREATE_ORDER_CALLBACK_STARTED:paypal');
  assert.equal(h.paypalFlowActiveRef.current, 'paypal', 'stays active through createOrder success -- onApprove still to come');
});

test('createOrder: a genuine failure still toasts and rethrows exactly as before, and clears flow-active', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => { throw new Error('Missing shipping details'); } });

  h.onClick();
  await assert.rejects(() => h.createOrder(), /Missing shipping details/);
  assert.deepEqual(h.calls.processing, [true, false]);
  assert.deepEqual(h.calls.toast, ['Missing shipping details']);
  assert.equal(h.paypalFlowActiveRef.current, null, 'a rejected createOrder is a terminal outcome -- no onApprove will follow');
});

test('onApprove: successful capture clears flow-active, clears cart, navigates, shows exactly one toast', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'ORDER-1', capturePayPalOrderImpl: async () => ({ success: true }) });

  h.onClick();
  await h.createOrder();
  await h.onApprove({ orderID: 'ORDER-1' });

  assert.equal(h.calls.toast.length, 1);
  assert.equal(h.calls.cartCleared, true);
  assert.deepEqual(h.calls.navigated, ['/success']);
  assert.equal(h.paypalFlowActiveRef.current, null);
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
  assert.equal(h.paypalFlowActiveRef.current, null);
});

test('onClick breadcrumb never touches toast, processing, cart, or navigation state', async () => {
  const h = await makeHarness();

  h.onClick();

  assert.equal(h.calls.toast.length, 0);
  assert.equal(h.calls.processing.length, 0);
  assert.equal(h.calls.cartCleared, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.deepEqual(h.calls.consoleLog[0], ['PAYPAL_BUTTON_CLICKED:paypal']);
});

test('card funding source: markers use the ":card" suffix', async () => {
  const h = await makeHarness({ fundingSource: 'card', createPayPalOrderImpl: async () => 'ORDER-1' });
  h.onClick();
  await h.createOrder();
  assert.deepEqual(h.calls.consoleLog.map((a) => a[0]), ['PAYPAL_BUTTON_CLICKED:card', 'PAYPAL_CREATE_ORDER_CALLBACK_STARTED:card']);
});

// --- The timing-gap regression (PR #11): onClick -> (late async update) -> createOrder ---

test('GAP FIX: a late currency/config update between onClick and createOrder does not change the forceReRender key', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => 'ORDER-1' });

  const keyBeforeClick = h.paypalForceRerenderKeyRef.current;

  h.onClick();
  h.simulateExternalUpdate({ currency: 'ILS', paypalClientId: 'client-b' });

  assert.deepEqual(
    h.paypalForceRerenderKeyRef.current,
    keyBeforeClick,
    'forceReRender key must stay frozen across the onClick -> createOrder gap'
  );

  await h.createOrder();
  assert.equal(h.calls.createOrderInvocations, 1, 'createOrder must still be invoked exactly once');
});

test('GAP FIX: invalid-form createOrder rejection does not leave the lock stuck (self-heals)', async () => {
  const h = await makeHarness({ createPayPalOrderImpl: async () => { throw new Error('Missing shipping details'); } });

  h.onClick();
  assert.equal(h.paypalFlowActiveRef.current, 'paypal', 'briefly active between click and the validation throw');
  await assert.rejects(() => h.createOrder());
  assert.equal(h.paypalFlowActiveRef.current, null, 'self-heals immediately -- does not stay stuck');

  const updated = h.simulateExternalUpdate({ cartTotal: 42 });
  assert.deepEqual(updated, ['USD', 42, 'client-a']);
});

// --- Two funding sources sharing one lock (PayPal Standard card button) ---

test('CONCURRENCY: clicking card while paypal is active is a no-op -- does not steal the lock', async () => {
  const shared = sharedRefsFor();
  const paypal = await makeHarness({ fundingSource: 'paypal', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-1' });
  const card = await makeHarness({ fundingSource: 'card', sharedRefs: shared });

  paypal.onClick();
  assert.equal(shared.paypalFlowActiveRef.current, 'paypal');

  card.onClick();
  assert.equal(shared.paypalFlowActiveRef.current, 'paypal', 'card click must not override the paypal flow already in progress');
  assert.equal(card.calls.consoleLog.length, 0, 'a blocked click is not even logged as a real click attempt');
});

test('CONCURRENCY: even if the SDK invokes the blocked button\'s createOrder anyway, it is refused before any real network call', async () => {
  const shared = sharedRefsFor();
  const paypal = await makeHarness({ fundingSource: 'paypal', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-1' });
  const card = await makeHarness({ fundingSource: 'card', sharedRefs: shared, createPayPalOrderImpl: async () => 'SHOULD-NEVER-BE-CALLED' });

  paypal.onClick(); // paypal owns the lock
  card.onClick(); // no-op, lock still 'paypal'

  await assert.rejects(() => card.createOrder(), /Another payment is already in progress/);
  assert.equal(card.calls.createOrderInvocations, 1, 'the callback was invoked...');
  assert.equal(card.calls.createOrderRealCalls, 0, '...but never reached the real createPayPalOrder network call');
  assert.equal(shared.paypalFlowActiveRef.current, 'paypal', 'the active paypal flow\'s lock must be completely untouched by the refused card attempt');

  // The active paypal flow proceeds completely normally, undisturbed.
  const orderID = await paypal.createOrder();
  assert.equal(orderID, 'ORDER-1');
  assert.equal(paypal.calls.createOrderRealCalls, 1);
});

test('CONCURRENCY: once paypal\'s flow ends (onCancel), card can then acquire the lock and create its own order', async () => {
  const shared = sharedRefsFor();
  const paypal = await makeHarness({ fundingSource: 'paypal', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-1' });
  const card = await makeHarness({ fundingSource: 'card', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-CARD' });

  paypal.onClick();
  card.onClick(); // blocked, no-op
  paypal.onCancel(); // paypal's flow ends
  assert.equal(shared.paypalFlowActiveRef.current, null);

  card.onClick(); // now succeeds
  assert.equal(shared.paypalFlowActiveRef.current, 'card');
  const orderID = await card.createOrder();
  assert.equal(orderID, 'ORDER-CARD');
  assert.equal(card.calls.createOrderRealCalls, 1);
});

test('CONCURRENCY: reverse direction -- card active first blocks paypal the same way', async () => {
  const shared = sharedRefsFor();
  const paypal = await makeHarness({ fundingSource: 'paypal', sharedRefs: shared });
  const card = await makeHarness({ fundingSource: 'card', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-CARD' });

  card.onClick();
  paypal.onClick(); // no-op

  assert.equal(shared.paypalFlowActiveRef.current, 'card');
  await assert.rejects(() => paypal.createOrder(), /Another payment is already in progress/);
  assert.equal(paypal.calls.createOrderRealCalls, 0);

  const orderID = await card.createOrder();
  assert.equal(orderID, 'ORDER-CARD');
});

test('CONCURRENCY: a rejected createOrder for one funding source never clears the other\'s active lock', async () => {
  // Defensive scenario: releasePaypalLockIfOwner must be a no-op when the
  // caller is not the current owner, even if somehow invoked.
  const shared = sharedRefsFor();
  shared.paypalFlowActiveRef.current = 'paypal'; // simulate paypal already active
  const { releasePaypalLockIfOwner } = await helpersPromise;
  const result = releasePaypalLockIfOwner(shared.paypalFlowActiveRef.current, 'card');
  assert.equal(result, 'paypal', 'attempting to release a lock this funding source does not own must be a no-op');
});

test('CONCURRENCY: the shared forceReRender key is frozen while EITHER funding source is active', async () => {
  const shared = sharedRefsFor();
  const paypal = await makeHarness({ fundingSource: 'paypal', sharedRefs: shared, createPayPalOrderImpl: async () => 'ORDER-1' });
  const card = await makeHarness({ fundingSource: 'card', sharedRefs: shared });

  const keyBefore = shared.paypalForceRerenderKeyRef.current;
  paypal.onClick();
  card.simulateExternalUpdate({ currency: 'ILS' }); // late update while paypal's flow is active
  assert.deepEqual(shared.paypalForceRerenderKeyRef.current, keyBefore, 'neither button remounts while the other funding source holds the lock');
});
