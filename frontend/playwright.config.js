// @ts-check
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Checkpoint 2E.1: prove the Vite dev server process itself (not just the
// browser Chromium runs in, and not just backend Node processes) makes zero
// outbound HTTP(S) calls during a hermetic test run — preloaded via an
// absolute path so it resolves correctly regardless of the dev server's own
// cwd. Given its own log file, separate from every other process's log.
const NETWORK_GUARD_ABS_PATH = path.resolve(__dirname, '../backend/scripts/network-guard.cjs');

/**
 * Phase 10 / Checkpoint 2E.1: Playwright config for the checkout E2E spec.
 *
 * The test boots the Vite dev server via `webServer` so `npx playwright test`
 * is a single-command entry point. We give the dev server up to 90 s to come
 * up because cold installs on Windows can be slow.
 *
 * baseURL is the Vite default; tests use relative paths.
 *
 * serviceWorkers: 'block' — a service worker can intercept/originate fetches
 * independent of page-level JS, bypassing page.route()/context.route()
 * interception entirely if one were ever registered. This app doesn't
 * register one today, but blocking them outright removes that whole class
 * of coverage gap rather than relying on "it happens not to use one".
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
    serviceWorkers: 'block',
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
    env: {
      NODE_OPTIONS: `-r ${NETWORK_GUARD_ABS_PATH}`,
      ...(process.env.NETWORK_GUARD_LOG_PATH_VITE_DEV
        ? { NETWORK_GUARD_LOG_PATH: process.env.NETWORK_GUARD_LOG_PATH_VITE_DEV }
        : {}),
    },
  },
});
