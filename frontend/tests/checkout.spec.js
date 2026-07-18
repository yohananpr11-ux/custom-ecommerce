// @ts-check
import { test as base, expect } from '@playwright/test';

/**
 * Payment-surface regression check, written after removing Braintree and
 * Meshulam from the live checkout (see the P0 payment-security pass).
 *
 * This intentionally does NOT attempt a full purchase — that would require
 * either live PayPal sandbox credentials or hitting the production backend,
 * neither of which belongs in an automated test run. Instead it verifies the
 * UI-level guarantees the removal was supposed to produce:
 *
 *   - No Braintree or Meshulam markup/copy exists anywhere on the checkout page.
 *   - When no payment method is configured, checkout fails CLOSED: an explicit
 *     "unavailable" message is shown, no dead/selectable provider is offered,
 *     and there is no active-but-inert generic submit button left standing in
 *     — a button that renders but can never successfully submit is exactly the
 *     silent failure mode this test exists to catch.
 *   - When PayPal *is* configured, its live Express Checkout surface renders
 *     and actually mounts a button (verified via backend response mocking +
 *     a browser-level network guard, never real sandbox credentials or a
 *     real external call).
 *   - The secondary "OR PAY WITH CREDIT CARD" section (PayPlus/Stripe) does
 *     not render while both remain unconfigured/hidden.
 *
 * Browser network isolation (Checkpoint 2D/2E/2E.1/2E.1-review): Node's
 * network-guard.cjs only protects Node processes — it has no visibility
 * into what Chromium itself requests.
 *
 * Route-before-navigate is a STRUCTURAL guarantee, not a timing race: this
 * file overrides Playwright's built-in `page` fixture (via `test.extend()`)
 * so the browser-context route is installed and awaited *inside the fixture
 * that creates the page*, before `context.newPage()` runs. Destructuring
 * `{ page }` in a test body — even one that awaits route installation as
 * its very first statement — only guarantees ordering relative to that
 * test's OWN code; it says nothing about what the `page` fixture itself may
 * have already done (or requested) before the test body started. Forcing
 * the dependency the other way (page depends on netGuard, not netGuard
 * running "first" by convention) makes the ordering enforced by Playwright's
 * fixture graph rather than by every test remembering to call things in the
 * right order.
 *
 * The allowlist is now the EXACT frontend origin (Playwright's configured
 * baseURL) and EXACT backend origin (VITE_API_BASE_URL, required — see the
 * throw below) — not "any loopback host on any port". A request to a
 * loopback address that isn't one of these two exact origins is treated
 * exactly like a request to a real external host: aborted and recorded as
 * unexpected, failing the test. Every request is classified with EXACT
 * matching (protocol, credentials, port, hostname, pathname, and — for the
 * three external mocks — the full query-parameter multiset):
 *   - the exact frontend origin -> allowed through
 *   - the exact backend origin, exact /api/analytics/visit path -> fulfilled
 *     locally with a deterministic 204 (see the note further down on why)
 *   - the exact backend origin, everything else -> allowed through
 *   - the exact expected PayPal SDK script URL -> fulfilled with a
 *     deterministic local stub that mounts a real DOM marker
 *   - the exact expected ipapi.co geolocation URL -> fulfilled with a
 *     deterministic local JSON response
 *   - the exact expected Google Fonts stylesheet URL -> fulfilled with an
 *     empty stylesheet (fulfilled, not aborted — an aborted resource makes
 *     Chromium itself emit a console.error, which would trip the
 *     zero-console-error assertion below over the test's OWN interception
 *     choice rather than a real page problem)
 *   - anything else, including any of the three hosts above at an
 *     unexpected path/port/protocol/credential/query shape, OR any OTHER
 *     loopback destination that isn't the exact frontend/backend origin
 *     -> aborted AND recorded as unexpected, which fails the test
 * None of these hosts is ever allowlisted broadly — only one exact request
 * shape per external host is recognized, and only to fulfill it locally,
 * never to let it through to the real network.
 *
 * Playwright is additionally configured with `serviceWorkers: 'block'`
 * (playwright.config.js) so a service worker can never originate a request
 * that bypasses context-level routing entirely.
 *
 * The pre-existing POST /api/analytics/visit backend route intentionally
 * returns HTTP 500 when its Telegram delivery fails (see index.js's own
 * comment on that route) — unrelated to payments, not touched by any
 * P0/2B/2C/2D/2E/2E.1 work, and always triggered in a hermetic run because
 * TELEGRAM_BOT_TOKEN is always blank. Rather than suppress the resulting
 * console.error, the exact backend-origin analytics URL is fulfilled
 * locally with a deterministic 204 — the real backend endpoint is never
 * even reached, so there is nothing to suppress. The zero-pageerror/
 * zero-console-error assertions below have no exceptions. If this 500 is
 * ever observed OUTSIDE a hermetic test run, it is a genuine, separate,
 * pre-existing production issue worth its own ticket — not a
 * payment-security concern this checkpoint is scoped to fix.
 *
 * Every test captures `pageerror` and console "error" events and asserts
 * zero of each — a test cannot pass while React quietly logs an error
 * boundary trip (e.g. an earlier version of the PayPal SDK stub being an
 * incomplete shape and tripping @paypal/react-paypal-js's own error
 * boundary with "isEligible is not a function").
 *
 * Precise claim this file proves: zero external HTTP(S) egress during the
 * hermetic test run. It does NOT prove zero DNS activity — index.html's
 * <link rel="dns-prefetch"> hints to paypal.com resolve below the
 * context.route() interception layer and are out of scope here.
 */

const CART_OVERLAY = '.cart-overlay';
const QUICK_ADD_MODAL = '.quick-config-modal';
const CART_ITEM = '.cart-items .cart-item';

const ANALYTICS_VISIT_PATHNAME = '/api/analytics/visit';
const CHECKOUT_CONFIG_PATHNAME = '/api/checkout/config';

// The exact frontend origin — matches playwright.config.js's use.baseURL.
const FRONTEND_ORIGIN = parseOrigin('http://localhost:5173');

// The exact backend origin. Required, not defaulted: App.jsx falls back to
// a real hosted URL (https://custom-ecommerce-qp30.onrender.com) when
// VITE_API_BASE_URL is unset, so silently defaulting here could make this
// suite believe it's hermetic while the app under test actually targets a
// real backend. Refuses to even start rather than guess.
const BACKEND_ORIGIN_STRING = process.env.VITE_API_BASE_URL;
if (!BACKEND_ORIGIN_STRING) {
  throw new Error(
    'VITE_API_BASE_URL must be set when running this suite (e.g. http://localhost:4101), pointing at an isolated local hermetic backend. ' +
    'The app defaults to a real hosted URL when this is unset — refusing to run rather than risk targeting it.'
  );
}
const BACKEND_ORIGIN = parseOrigin(BACKEND_ORIGIN_STRING);
if (!['localhost', '127.0.0.1', '::1'].includes(BACKEND_ORIGIN.hostname)) {
  throw new Error(
    `VITE_API_BASE_URL must point at a loopback host; got hostname "${BACKEND_ORIGIN.hostname}" from "${BACKEND_ORIGIN_STRING}". Refusing to run against a non-local backend.`
  );
}

function parseOrigin(urlString) {
  const u = new URL(urlString);
  return { protocol: u.protocol, hostname: u.hostname.toLowerCase(), port: u.port };
}

function defaultPortFor(protocol) {
  return protocol === 'https:' ? '443' : '80';
}

/** Exact protocol + hostname + port match (no credentials permitted). */
function isExactOrigin(parsedUrl, origin) {
  if (parsedUrl.username !== '' || parsedUrl.password !== '') return false;
  if (parsedUrl.protocol !== origin.protocol) return false;
  if (parsedUrl.hostname.toLowerCase() !== origin.hostname) return false;
  const actualPort = parsedUrl.port || defaultPortFor(parsedUrl.protocol);
  const expectedPort = origin.port || defaultPortFor(origin.protocol);
  return actualPort === expectedPort;
}

function normalizeParamPairs(searchParams) {
  return [...searchParams.entries()].sort(([k1, v1], [k2, v2]) => {
    if (k1 !== k2) return k1 < k2 ? -1 : 1;
    return v1 < v2 ? -1 : v1 > v2 ? 1 : 0;
  });
}

/**
 * Derives an exact-match spec {hostname, pathname, paramPairs} from a real
 * URL string, rather than hand-typing hostname/pathname/params separately —
 * less error-prone, especially for encoding-sensitive values like Google
 * Fonts' `family=Inter:wght@400;500;600;700;800`.
 */
function urlToExpectedSpec(urlString) {
  const u = new URL(urlString);
  return {
    hostname: u.hostname.toLowerCase(),
    pathname: u.pathname,
    paramPairs: normalizeParamPairs(u.searchParams),
  };
}

/**
 * Strict exact-match validator: protocol, credentials, port, hostname,
 * pathname, fragment, AND the exact multiset of query (key,value) pairs.
 * Rejects extra keys, missing keys, substituted values, duplicate keys not
 * present in the expected set, and any fragment. Legitimate repeated keys
 * (Google Fonts' two "family" params) are matched pair-for-pair against the
 * expected multiset, not just checked by key presence, so an extra/altered
 * duplicate is still caught.
 */
function isExactUrlMatch(parsedUrl, expected) {
  if (parsedUrl.protocol !== 'https:') return false;
  if (parsedUrl.username !== '' || parsedUrl.password !== '') return false;
  if (parsedUrl.port !== '') return false; // '' means default (443) per WHATWG URL parsing
  if (parsedUrl.hostname.toLowerCase() !== expected.hostname) return false;
  if (parsedUrl.pathname !== expected.pathname) return false;
  if (parsedUrl.hash !== '') return false;

  const actualPairs = normalizeParamPairs(parsedUrl.searchParams);
  if (actualPairs.length !== expected.paramPairs.length) return false;
  for (let i = 0; i < actualPairs.length; i += 1) {
    if (actualPairs[i][0] !== expected.paramPairs[i][0] || actualPairs[i][1] !== expected.paramPairs[i][1]) return false;
  }
  return true;
}

// The exact PayPal SDK request the app is known to construct (App.jsx:
// `<PayPalScriptProvider options={{ 'client-id': paypalClientId, currency,
// intent: 'capture', 'disable-funding': 'card,credit,paylater,venmo' }}>`),
// confirmed empirically across multiple prior hermetic runs. `client-id`
// comes from our own mocked /api/checkout/config response below; `currency`
// resolves to ILS via the backend's own /api/geolocation fallback (private
// request IP -> country 'IL' -> 'ILS').
const PAYPAL_SDK_EXPECTED_CLIENT_ID = 'test-mock-paypal-client-id-not-real';
const PAYPAL_SDK_EXPECTED = urlToExpectedSpec(
  `https://www.paypal.com/sdk/js?client-id=${PAYPAL_SDK_EXPECTED_CLIENT_ID}&currency=ILS&intent=capture&disable-funding=card,credit,paylater,venmo`
);

const IPAPI_EXPECTED = urlToExpectedSpec('https://ipapi.co/json/');
const IPAPI_STUB_BODY = JSON.stringify({
  ip: '203.0.113.1',
  country_code: 'IL',
  country_name: 'Israel',
  currency: 'ILS',
});

// The exact, single stylesheet <link> frontend/index.html loads unconditionally.
const GOOGLE_FONTS_EXPECTED = urlToExpectedSpec(
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap'
);

const PAYPAL_MARKER_TESTID = 'paypal-sdk-stub-button';

const PAYPAL_SDK_STUB_BODY = `
  // Deterministic local test stub — installed by the browser-context network
  // guard in frontend/tests/checkout.spec.js. Never fetched from paypal.com.
  // Shape matches what @paypal/react-paypal-js's PayPalButtons wrapper
  // calls on the instance: isEligible() (sync boolean), render(container)
  // and close() (both must return a thenable — the wrapper chains .catch()
  // directly on their return value), and updateProps(). render() mounts a
  // real, deterministic DOM marker so the test can assert something
  // actually rendered, not just that no error was thrown.
  window.paypal = {
    Buttons: function paypalButtonsStub() {
      return {
        isEligible: function isEligibleStub() { return true; },
        render: function renderStub(container) {
          try {
            var el = typeof container === 'string' ? document.querySelector(container) : container;
            if (el) {
              var marker = document.createElement('button');
              marker.setAttribute('data-testid', '${PAYPAL_MARKER_TESTID}');
              marker.type = 'button';
              marker.textContent = 'PayPal (deterministic test stub)';
              el.appendChild(marker);
            }
          } catch (e) { /* stub best-effort only */ }
          return Promise.resolve();
        },
        close: function closeStub() { return Promise.resolve(); },
        updateProps: function updatePropsStub() {},
      };
    },
  };
`;

/**
 * Installs a comprehensive, catch-all network interceptor on the given
 * BROWSER CONTEXT (not a page — a page-scoped route misses popups and any
 * new page opened within the same context). Callers MUST await this before
 * any page in the context navigates; the custom `page` fixture below
 * enforces that structurally rather than by convention.
 */
async function installBrowserNetworkGuard(context) {
  const unexpectedExternalUrls = [];
  const mockedPaypalSdkUrls = [];
  const mockedIpapiUrls = [];
  const mockedGoogleFontsUrls = [];

  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    let parsedUrl;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      unexpectedExternalUrls.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }

    if (isExactOrigin(parsedUrl, FRONTEND_ORIGIN) || isExactOrigin(parsedUrl, BACKEND_ORIGIN)) {
      await route.continue();
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === PAYPAL_SDK_EXPECTED.hostname) {
      if (isExactUrlMatch(parsedUrl, PAYPAL_SDK_EXPECTED)) {
        mockedPaypalSdkUrls.push(requestUrl);
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: PAYPAL_SDK_STUB_BODY });
        return;
      }
      // Any other paypal.com URL, or the expected path with an unexpected
      // protocol/port/credentials/query shape, is a surprise — must fail
      // the test, not be silently absorbed alongside the one recognized
      // request shape.
      unexpectedExternalUrls.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }

    if (hostname === IPAPI_EXPECTED.hostname) {
      if (isExactUrlMatch(parsedUrl, IPAPI_EXPECTED)) {
        mockedIpapiUrls.push(requestUrl);
        await route.fulfill({ status: 200, contentType: 'application/json', body: IPAPI_STUB_BODY });
        return;
      }
      unexpectedExternalUrls.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }

    if (hostname === GOOGLE_FONTS_EXPECTED.hostname) {
      if (isExactUrlMatch(parsedUrl, GOOGLE_FONTS_EXPECTED)) {
        mockedGoogleFontsUrls.push(requestUrl);
        await route.fulfill({ status: 200, contentType: 'text/css', body: '/* blocked by hermetic test network guard */' });
        return;
      }
      unexpectedExternalUrls.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }

    // Everything else, including any OTHER loopback destination that isn't
    // the exact frontend/backend origin (e.g. a stray port), is unexpected.
    unexpectedExternalUrls.push(requestUrl);
    await route.abort('blockedbyclient');
  });

  // Registered AFTER the catch-all so it takes priority for this one exact
  // (origin + pathname) request (Playwright resolves routes in reverse
  // registration order, so the most recently added route gets first
  // refusal). Matched by a predicate scoped to the exact backend origin —
  // not a bare path glob, which would also match this path on ANY origin,
  // including one that isn't ours, before the catch-all above ever got a
  // chance to classify it as unexpected.
  await context.route(
    (url) => isExactOrigin(url, BACKEND_ORIGIN) && url.pathname === ANALYTICS_VISIT_PATHNAME,
    async (route) => {
      await route.fulfill({ status: 204, body: '' });
    }
  );

  return { unexpectedExternalUrls, mockedPaypalSdkUrls, mockedIpapiUrls, mockedGoogleFontsUrls };
}

/**
 * Custom test fixture: forces `netGuard` (which installs the context-level
 * route) to be a dependency of the `page` fixture, so Playwright's fixture
 * graph guarantees the route is installed before `context.newPage()` runs
 * — a structural property, not a convention every test has to remember.
 * `errorCapture` in turn depends on the (now custom) `page`, so it also
 * naturally resolves after the guard is in place.
 */
const test = base.extend({
  netGuard: async ({ context }, use) => {
    const guard = await installBrowserNetworkGuard(context);
    await use(guard);
  },
  page: async ({ context, netGuard }, use) => {
    const page = await context.newPage();
    await use(page);
  },
  errorCapture: async ({ page }, use) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error && error.message ? error.message : String(error));
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${msg.text()} (${msg.location().url || 'no-location'})`);
    });
    await use({ pageErrors, consoleErrors });
  },
});

function assertNoUnexpectedExternalTraffic(guard) {
  if (guard.unexpectedExternalUrls.length > 0) {
    console.error('[browser-network-guard] Unexpected external URL(s) attempted:', guard.unexpectedExternalUrls);
  }
  expect(
    guard.unexpectedExternalUrls,
    'zero unexpected external HTTP(S) egress expected — see console output above for the offending URL(s)'
  ).toEqual([]);

  if (guard.mockedPaypalSdkUrls.length > 0) {
    console.log('[browser-network-guard] Locally-fulfilled PayPal SDK request(s):', guard.mockedPaypalSdkUrls);
  }
  if (guard.mockedIpapiUrls.length > 0) {
    console.log('[browser-network-guard] Locally-fulfilled ipapi.co request(s):', guard.mockedIpapiUrls);
  }
  if (guard.mockedGoogleFontsUrls.length > 0) {
    console.log('[browser-network-guard] Locally-fulfilled Google Fonts request(s):', guard.mockedGoogleFontsUrls);
  }
}

function assertNoPageErrors(errorCapture) {
  if (errorCapture.pageErrors.length > 0) {
    console.error('[error-capture] Uncaught page error(s):', errorCapture.pageErrors);
  }
  expect(errorCapture.pageErrors, 'zero uncaught page errors expected').toEqual([]);

  if (errorCapture.consoleErrors.length > 0) {
    console.error('[error-capture] console.error call(s):', errorCapture.consoleErrors);
  }
  expect(errorCapture.consoleErrors, 'zero console.error calls expected — no exceptions').toEqual([]);
}

async function addItemAndReachCheckout(page) {
  await page.goto('/');
  await page.evaluate(() => {
    try { localStorage.removeItem('drip_street_cart'); } catch { /* noop */ }
    try { sessionStorage.removeItem('drip_street_pending_order'); } catch { /* noop */ }
    try { localStorage.setItem('drip_street_lead_dismissed_at', String(Date.now())); } catch { /* noop */ }
    try { sessionStorage.setItem('drip_street_lead_popup_seen_session', '1'); } catch { /* noop */ }
  });
  await page.reload();

  await page.waitForSelector('button.add-to-cart, button.quick-add-btn', { timeout: 30_000 });

  const firstAddToCart = page.locator('button.add-to-cart, button.quick-add-btn').first();
  await firstAddToCart.scrollIntoViewIfNeeded();
  await firstAddToCart.click();
  await expect(page.locator(QUICK_ADD_MODAL)).toBeVisible({ timeout: 15_000 });

  const quickAddConfirm = page.locator('[data-track="quick_add_to_cart"]');
  await expect(quickAddConfirm).toBeEnabled({ timeout: 15_000 });
  await quickAddConfirm.click();
  await expect(page.locator(QUICK_ADD_MODAL)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(`${CART_OVERLAY}.open`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(CART_ITEM).first()).toBeVisible({ timeout: 10_000 });

  const drawerCheckoutBtn = page.locator('[data-track="drawer_checkout"]');
  await drawerCheckoutBtn.scrollIntoViewIfNeeded();
  await drawerCheckoutBtn.click();
  await page.waitForURL('**/checkout', { timeout: 15_000 });
}

test.describe('Checkout payment surface — post Braintree/Meshulam removal', () => {
  test('cart → checkout shows no Braintree/Meshulam remnants', async ({ page, netGuard, errorCapture }) => {
    await addItemAndReachCheckout(page);

    const pageContent = await page.content();
    expect(pageContent, 'no Braintree markup should remain').not.toMatch(/braintree/i);
    expect(pageContent, 'no Meshulam markup should remain').not.toMatch(/meshulam/i);
    await expect(page.locator('[data-track="payment_select_braintree"]')).toHaveCount(0);
    await expect(page.locator('[data-track="payment_select_meshulam_card"]')).toHaveCount(0);
    await expect(page.locator('input[name="payment"][value="meshulam_bit"]')).toHaveCount(0);
    await expect(page.locator('input[name="payment"][value="braintree"]')).toHaveCount(0);

    // Secondary card-form section (PayPlus/Stripe) must stay hidden while both
    // remain unconfigured — its card-number/CVV fields are decorative and
    // there is no live payment method for it to submit to yet.
    await expect(page.getByText('OR PAY WITH CREDIT CARD', { exact: false })).toHaveCount(0);
    await expect(page.locator('input[placeholder="0000 0000 0000 0000"]')).toHaveCount(0);

    assertNoUnexpectedExternalTraffic(netGuard);
    assertNoPageErrors(errorCapture);
  });

  test('when no payment method is configured, checkout fails closed with an explicit message', async ({ page, netGuard, errorCapture }) => {
    // This run's target backend has every payment credential blanked
    // (isolated test server, never real PayPal/PayPlus/Stripe credentials),
    // so no radio auto-selects. The app must show a clear unavailable message
    // — never leave a generic, always-rendered submit button standing in
    // with no explanation, since a button that can never succeed is
    // indistinguishable from a broken page to a real customer.
    await addItemAndReachCheckout(page);

    const unavailableMessage = page.locator('[data-track="payment_no_method_available"]');
    await expect(unavailableMessage).toBeVisible({ timeout: 15_000 });

    // No selectable dead provider of any kind.
    await expect(page.locator('input[name="payment"]')).toHaveCount(0);

    // No inert generic submit button rendered in its place.
    await expect(page.locator('button.checkout-btn[data-track="checkout_submit"]')).toHaveCount(0);

    // No live PayPal surface either, since it is genuinely unconfigured here.
    await expect(page.locator('.premium-paypal-container')).toHaveCount(0);

    assertNoUnexpectedExternalTraffic(netGuard);
    expect(netGuard.mockedPaypalSdkUrls, 'PayPal SDK should never even be requested when unconfigured').toEqual([]);
    assertNoPageErrors(errorCapture);
  });

  test('when PayPal is configured, its live payment surface renders (mocked backend, zero real external calls)', async ({ page, netGuard, errorCapture }) => {
    // Simulate a configured backend purely by mocking our OWN
    // /api/checkout/config response — never a real PayPal client ID/secret
    // anywhere in this process. Scoped to the exact backend origin + exact
    // pathname via a predicate (not a bare path glob, which would also
    // match this path on any other origin). Registered on the context
    // after the catch-all guard, so per Playwright's last-registered-wins
    // routing, this specific route takes priority for this one request
    // while the guard still governs everything else.
    await page.context().route(
      (url) => isExactOrigin(url, BACKEND_ORIGIN) && url.pathname === CHECKOUT_CONFIG_PATHNAME,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            paypalEnabled: true,
            stripeEnabled: false,
            payplusEnabled: false,
            paypalClientId: PAYPAL_SDK_EXPECTED_CLIENT_ID,
          }),
        });
      }
    );

    await addItemAndReachCheckout(page);

    // The app's own decision to show the live PayPal surface is controlled
    // entirely by our mocked config response.
    await expect(page.locator('.premium-paypal-container')).toBeVisible({ timeout: 15_000 });

    // The fail-closed message and the dead generic button must NOT appear
    // now that a real payment method is available.
    await expect(page.locator('[data-track="payment_no_method_available"]')).toHaveCount(0);
    await expect(page.locator('button.checkout-btn[data-track="checkout_submit"]')).toHaveCount(0);

    // The stub's render() must have actually mounted a visible DOM marker —
    // proof the component completed its full render lifecycle (isEligible
    // -> render) without tripping react-paypal-js's error boundary, not
    // just that the outer container div (which our own app code renders
    // regardless of the SDK) is present.
    await expect(page.locator(`[data-testid="${PAYPAL_MARKER_TESTID}"]`)).toBeVisible({ timeout: 15_000 });

    assertNoUnexpectedExternalTraffic(netGuard);
    expect(
      netGuard.mockedPaypalSdkUrls.length,
      'expected the PayPal SDK script request to be intercepted and locally fulfilled, confirming the test never made a real external call'
    ).toBeGreaterThan(0);
    assertNoPageErrors(errorCapture);
  });
});
