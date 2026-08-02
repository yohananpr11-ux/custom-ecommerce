// @ts-check
import { test, expect } from '@playwright/test';

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
 *   - PayPal Express Checkout is the default, reachable payment surface.
 *   - The secondary "OR PAY WITH CREDIT CARD" section (PayPlus/Stripe) does
 *     not render while both remain unconfigured/hidden.
 *
 * The dev server connects to whatever VITE_API_BASE_URL / API_BASE_URL
 * points at — run this against a local backend instance, not production.
 */

const CART_OVERLAY = '.cart-overlay';
const QUICK_ADD_MODAL = '.quick-config-modal';
const CART_ITEM = '.cart-items .cart-item';

test.describe('Checkout payment surface — post Braintree/Meshulam removal', () => {
  test('cart → checkout shows PayPal only; no Braintree/Meshulam remnants', async ({ page }) => {
    // ── Clean slate ──────────────────────────────────────────────────────────
    await page.goto('/');
    await page.evaluate(() => {
      try { localStorage.removeItem('drip_street_cart'); } catch { /* noop */ }
      try { sessionStorage.removeItem('drip_street_pending_order'); } catch { /* noop */ }
      try { localStorage.setItem('drip_street_lead_dismissed_at', String(Date.now())); } catch { /* noop */ }
      try { sessionStorage.setItem('drip_street_lead_popup_seen_session', '1'); } catch { /* noop */ }
    });
    await page.reload();

    await page.waitForSelector('button.add-to-cart, button.quick-add-btn', { timeout: 30_000 });

    // ── Add an item and reach /checkout ──────────────────────────────────────
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

    // ── No Braintree or Meshulam remnants anywhere on the page ───────────────
    const pageContent = await page.content();
    expect(pageContent, 'no Braintree markup should remain').not.toMatch(/braintree/i);
    expect(pageContent, 'no Meshulam markup should remain').not.toMatch(/meshulam/i);
    await expect(page.locator('[data-track="payment_select_braintree"]')).toHaveCount(0);
    await expect(page.locator('[data-track="payment_select_meshulam_card"]')).toHaveCount(0);
    await expect(page.locator('input[name="payment"][value="meshulam_bit"]')).toHaveCount(0);
    await expect(page.locator('input[name="payment"][value="braintree"]')).toHaveCount(0);

    // ── PayPal Express Checkout is the live default (or shows the honest
    //    "not configured" fallback if no sandbox client ID is set locally —
    //    either state is correct; what matters is nothing else is offered
    //    in its place). ──────────────────────────────────────────────────────
    const paypalConfigured = page.locator('div[data-testid], iframe[title*="PayPal"], iframe[name*="paypal"]');
    const paypalNotConfiguredMessage = page.getByText('PayPal is not configured', { exact: false });
    const eitherPaypalState = await Promise.race([
      paypalConfigured.first().waitFor({ state: 'attached', timeout: 15_000 }).then(() => 'configured').catch(() => null),
      paypalNotConfiguredMessage.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'not-configured').catch(() => null),
    ]);
    expect(eitherPaypalState, 'checkout must show either real PayPal buttons or the explicit not-configured message').not.toBeNull();

    // ── Secondary card-form section (PayPlus/Stripe) must stay hidden while
    //    both are unconfigured — its card-number/CVV fields are decorative
    //    and there is no live payment method for it to submit to yet. ───────
    await expect(page.getByText('OR PAY WITH CREDIT CARD', { exact: false })).toHaveCount(0);
    await expect(page.locator('input[placeholder="0000 0000 0000 0000"]')).toHaveCount(0);
  });
});
