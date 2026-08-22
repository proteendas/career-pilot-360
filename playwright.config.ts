import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright is used ONLY to test CareerPilot360's own UI.
 * It is never used to automate a third-party job portal.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
