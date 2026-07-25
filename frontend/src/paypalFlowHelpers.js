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
