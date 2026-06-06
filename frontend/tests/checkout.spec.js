// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Phase 10 E2E: the full checkout flow Drip Street depends on.
 *
 *   home → add-to-cart (Quick Add modal) → cart drawer opens with item →
 *   navigate to /checkout → fill shipping/contact form → pick Meshulam Bit →
 *   submit → POST /api/payment/create is fired with correct payload →
 *   either redirectUrl (Meshulam configured) or meshulam_not_configured
 *   (still unconfigured on backend), both treated as a passing flow.
 *
 * The dev server connects to the live Render backend by default (see
 * VITE_API_BASE_URL). That is exactly the contract we want to verify.
 */

const CART_OVERLAY = '.cart-overlay';
const QUICK_ADD_MODAL = '.quick-config-modal';
const CART_ITEM = '.cart-items .cart-item';
const PAYMENT_API_PATH = '/api/payment/create';

const DUMMY_CUSTOMER = {
  customerEmail: 'phase10-test@dripstreetshop.com',
  firstName: 'Test',
  lastName: 'Buyer',
  phone: '0501234567',
  addressLine1: '100 Allenby Street',
  city: 'Tel Aviv',
  postalCode: '6300100',
};

test.describe('Drip Street — Phase 10 checkout flow', () => {
  test('add-to-cart → cart drawer → checkout → Meshulam Bit redirect', async ({ page }) => {
    // ── Clean slate ──────────────────────────────────────────────────────────
    await page.goto('/');
    await page.evaluate(() => {
      try { localStorage.removeItem('drip_street_cart'); } catch { /* noop */ }
      try { sessionStorage.removeItem('drip_street_pending_order'); } catch { /* noop */ }
      try { localStorage.setItem('drip_street_lead_dismissed_at', String(Date.now())); } catch { /* noop */ }
      try { sessionStorage.setItem('drip_street_lead_popup_seen_session', '1'); } catch { /* noop */ }
      try { localStorage.setItem('drip_street_lead_code', 'disabled'); } catch { /* noop */ }
    });
    await page.reload();

    // Phase 11.2: the new metallic D logo must be in the navbar before any
    // interaction. This is also a smoke check that /logo-new.png is published
    // and ships in dist/ — a broken path here means the build pipeline lost
    // the asset on the way to Vite's static handling.
    await expect(page.locator('img[src="/logo-new.png"]').first()).toBeVisible({ timeout: 15_000 });

    // Wait for products to hydrate from the live API (cards have add-to-cart buttons).
    await page.waitForSelector('button.add-to-cart, button.quick-add-btn', { timeout: 30_000 });

    // ── 1. Open Quick Add modal ──────────────────────────────────────────────
    // First product card add-to-cart click opens the Quick Add config modal.
    const firstAddToCart = page.locator('button.add-to-cart, button.quick-add-btn').first();
    await firstAddToCart.scrollIntoViewIfNeeded();
    await firstAddToCart.click();
    await expect(page.locator(QUICK_ADD_MODAL)).toBeVisible({ timeout: 15_000 });

    // ── 2. Confirm Quick Add → expects drawer to open with the item ──────────
    const quickAddConfirm = page.locator('[data-track="quick_add_to_cart"]');
    await expect(quickAddConfirm).toBeVisible();

    // The button is disabled while variants are loading or invalid; wait for
    // it to become enabled (variants resolved) before clicking.
    await expect(quickAddConfirm).toBeEnabled({ timeout: 15_000 });
    await quickAddConfirm.click();

    // Quick Add modal closes; cart drawer opens via the openCart option.
    await expect(page.locator(QUICK_ADD_MODAL)).toHaveCount(0, { timeout: 10_000 });

    // The bug we shipped a fix for: drawer must open AND contain the item.
    await expect(page.locator(`${CART_OVERLAY}.open`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(CART_ITEM).first()).toBeVisible({ timeout: 10_000 });

    const itemCount = await page.locator(CART_ITEM).count();
    expect(itemCount).toBeGreaterThan(0);
    console.log(`[phase10] ✓ Cart drawer opened with ${itemCount} item(s).`);

    // ── 3. Proceed to /checkout from the cart drawer ─────────────────────────
    // The ACTIVE drawer's checkout button uses data-track="drawer_checkout".
    // ("cart_checkout" is the legacy, never-rendered drawer at App.jsx:3271.)
    const drawerCheckoutBtn = page.locator('[data-track="drawer_checkout"]');
    await drawerCheckoutBtn.scrollIntoViewIfNeeded();
    await drawerCheckoutBtn.click();
    await page.waitForURL('**/checkout', { timeout: 15_000 });

    // ── 4. Fill shipping/contact form ────────────────────────────────────────
    await page.fill('input[name="customerEmail"]', DUMMY_CUSTOMER.customerEmail);
    await page.fill('input[name="firstName"]', DUMMY_CUSTOMER.firstName);
    await page.fill('input[name="lastName"]', DUMMY_CUSTOMER.lastName);
    await page.fill('input[name="phone"]', DUMMY_CUSTOMER.phone);
    await page.fill('input[name="addressLine1"]', DUMMY_CUSTOMER.addressLine1);
    await page.fill('input[name="city"]', DUMMY_CUSTOMER.city);
    await page.fill('input[name="postalCode"]', DUMMY_CUSTOMER.postalCode);

    // Country defaults to IL; explicitly pin to keep the test deterministic.
    await page.selectOption('select[name="country"]', 'IL');

    // ── 5. Pick Meshulam Bit ─────────────────────────────────────────────────
    const bitRadio = page.locator('input[name="payment"][value="meshulam_bit"]');
    await expect(bitRadio).toBeVisible({ timeout: 10_000 });
    await bitRadio.check();
    await expect(bitRadio).toBeChecked();

    // ── 6. Intercept the POST /api/payment/create call ───────────────────────
    const paymentRequestPromise = page.waitForRequest(
      (req) => req.url().includes(PAYMENT_API_PATH) && req.method() === 'POST',
      { timeout: 30_000 }
    );
    const paymentResponsePromise = page.waitForResponse(
      (res) => res.url().includes(PAYMENT_API_PATH),
      { timeout: 30_000 }
    );

    // Submit checkout — for Meshulam_bit the form's <button type="submit">
    // is the trigger (PayPal path has its own buttons and isn't selected here).
    const submitBtn = page.locator('button.checkout-btn[type="submit"]');
    await submitBtn.click();

    const [paymentRequest, paymentResponse] = await Promise.all([
      paymentRequestPromise,
      paymentResponsePromise,
    ]);

    // ── 7. Assert request payload structure ──────────────────────────────────
    const payload = paymentRequest.postDataJSON();
    expect(payload, 'request body should be valid JSON').toBeTruthy();
    expect(typeof payload.amount, 'amount must be a number').toBe('number');
    expect(payload.amount).toBeGreaterThan(0);
    expect(payload.paymentMethod, 'paymentMethod must reflect Bit selection').toBe('meshulam_bit');
    expect(payload.customer, 'customer object must exist').toBeTruthy();
    expect(payload.customer.email).toBe(DUMMY_CUSTOMER.customerEmail);
    expect(payload.customer.phone).toBe(DUMMY_CUSTOMER.phone);
    expect(payload.customer.fullName).toContain(DUMMY_CUSTOMER.firstName);
    expect(payload.shipping, 'shipping object must exist').toBeTruthy();
    expect(payload.shipping.city).toBe(DUMMY_CUSTOMER.city);
    expect(payload.shipping.postalCode).toBe(DUMMY_CUSTOMER.postalCode);
    expect(payload.shipping.country).toBe('IL');
    expect(Array.isArray(payload.items), 'items must be an array').toBe(true);
    expect(payload.items.length).toBeGreaterThan(0);
    console.log(
      `[phase10] ✓ /api/payment/create payload OK (amount=${payload.amount}, items=${payload.items.length})`
    );

    // ── 8. Assert response — accept either configured or unconfigured paths ──
    const status = paymentResponse.status();
    const body = await paymentResponse.json().catch(() => ({}));
    console.log(`[phase10] /api/payment/create → HTTP ${status}, body=${JSON.stringify(body).slice(0, 200)}`);

    if (status === 200 && body.ok === true) {
      // Meshulam is fully configured: must hand us a redirect URL.
      expect(body.redirectUrl, 'redirectUrl must be present on success').toMatch(/^https?:\/\//);
      expect(typeof body.orderId).not.toBe('undefined');
      console.log('[phase10] ✓ Meshulam configured — received redirectUrl');
    } else {
      // Backend Meshulam env vars are not set yet — frontend must catch this
      // gracefully via a toast. We've already proven the payload contract; now
      // assert the frontend didn't crash and surfaced a user-visible message.
      expect([400, 500, 502]).toContain(status);
      expect(body.ok).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(['meshulam_not_configured', 'meshulam_failed', 'meshulam_rejected', 'order_persist_failed']).toContain(body.error);

      // Toast container hooks into a window CustomEvent in the app; the simplest
      // user-visible proof is that we're still on /checkout (not crashed) and
      // the submit button is interactive again.
      await expect(page).toHaveURL(/\/checkout/);
      await expect(submitBtn).toBeEnabled();
      console.log(`[phase10] ✓ Meshulam unconfigured — frontend handled "${body.error}" gracefully`);
    }
  });
});
