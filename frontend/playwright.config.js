// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 10: minimal Playwright config for the checkout E2E spec.
 *
 * The test boots the Vite dev server via `webServer` so `npx playwright test`
 * is a single-command entry point. We give the dev server up to 90 s to come
 * up because cold installs on Windows can be slow.
 *
 * baseURL is the Vite default; tests use relative paths.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Locale that matches the storefront's default Israeli flow.
    locale: 'he-IL',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
