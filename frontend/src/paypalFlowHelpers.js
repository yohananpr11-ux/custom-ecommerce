// Small, pure, dependency-free helpers extracted out of the PayPalButtons
// integration in App.jsx so their logic is directly unit-testable with
// node:test (App.jsx itself contains JSX and can't be `require`/`import`-ed
// by a plain Node test runner).

// Reduces a raw PayPal SDK error (onError callback argument) to only a safe
// name/message pair. The raw object is never returned/logged as-is -- it can
// carry order or customer-shaped data depending on what stage of the flow
// produced it.
export const sanitizePayPalError = (err) => {
  const name = err && typeof err === 'object' && typeof err.name === 'string'
    ? err.name
    : 'UnknownError';
  const message = err && typeof err === 'object' && typeof err.message === 'string'
    ? err.message.slice(0, 200)
    : '';
  return { name, message };
};

// Decides the next PayPalButtons `forceReRender` key. While a flow is
// in-flight (isProcessing === true), the previous key is kept so a
// late-arriving async update (geolocation-driven currency change,
// paypalClientId) can't destroy-and-remount the button underneath an
// already-open popup. Outside an active flow, it always tracks the latest
// values, so a genuine cart/coupon change still updates the button normally.
export const computePaypalForceRerenderKey = (previousKey, currentKey, isProcessing) => (
  isProcessing ? previousKey : currentKey
);

// Builds a funding-source-suffixed diagnostic marker, e.g.
// "[PAYPAL_BUTTON_CLICKED:card]" -- lets the same console markers used by
// the single PayPal-wallet button distinguish which of the two
// PayPalButtons instances (fundingSource="paypal" vs "card") produced them.
export const buildPaypalMarker = (base, fundingSource) => `${base}:${fundingSource}`;

// --- Shared cross-button payment-flow lock -------------------------------
// PayPal wallet and PayPal card are two independent <PayPalButtons>
// instances under one PayPalScriptProvider. Only one of them may have an
// active flow (click -> createOrder -> onApprove) at a time; these three
// pure functions decide the lock transitions given the ref's *current*
// owner (null, "paypal", or "card") and the funding source asking. The
// caller (App.jsx) does nothing but read/write the ref with these.

// Called from onClick. Returns the lock owner that should result: this
// funding source, if the lock is free or already owned by it; otherwise
// the unchanged current owner (the click is a no-op -- another flow is
// already active).
export const resolvePaypalClickLockOwner = (currentOwner, fundingSource) => (
  currentOwner && currentOwner !== fundingSource ? currentOwner : fundingSource
);

// Called at the very start of createOrder. True only when this funding
// source currently holds the lock -- i.e. it's safe to proceed to the real
// network call. False covers both "the other funding source holds it" and
// "this one's own onClick never acquired it" (defense in depth).
export const paypalCreateOrderMayProceed = (currentOwner, fundingSource) => (
  currentOwner === fundingSource
);

// Called from every terminal-outcome handler (createOrder's catch,
// onCancel, onError, onApprove's finally). Clears the lock only if this
// funding source is still the current owner -- never releases a lock that
// (in some edge case) is already held by a different, still-active flow.
export const releasePaypalLockIfOwner = (currentOwner, fundingSource) => (
  currentOwner === fundingSource ? null : currentOwner
);
