import { test, expect } from '@playwright/test';

test.describe('Drip Street — Hardware Products PDP Verification', () => {
  const hardwareProductIds = [17, 18, 19, 20, 21];

  hardwareProductIds.forEach((id) => {
    test(`Product ID ${id} PDP renders correctly with high-color images`, async ({ page }) => {
      // Navigate directly to the product detail page
      await page.goto(`/product/${id}`);

      // Verify page is hydrated and the title is visible
      const title = page.locator('.pdp-info h1');
      await expect(title).toBeVisible({ timeout: 15_000 });
      console.log(`[test] ID ${id} Title:`, await title.textContent());

      // Ensure the main image is visible and has opacity = 1 (not failed/fallback skeleton)
      const mainImage = page.locator('.pdp-image').first();
      await expect(mainImage).toBeVisible({ timeout: 15_000 });
      await expect(mainImage).toHaveCSS('opacity', '1');

      // Check that the image source is NOT the global fallback shirt image
      const src = await mainImage.getAttribute('src');
      expect(src).toBeTruthy();
      expect(src).not.toContain('shirt-black-design.png');
      expect(src).not.toContain('undefined');
      console.log(`[test] ID ${id} Main Image Src:`, src);

      // Verify that the gallery loaded all supplier images (thumbnail buttons exist)
      const thumbnails = page.locator('button.pdp-thumb-btn');
      const thumbCount = await thumbnails.count();
      console.log(`[test] ID ${id} Thumbnail count:`, thumbCount);

      // We expect multiple images to show the supplier's range
      expect(thumbCount).toBeGreaterThan(1);
    });
  });
});
