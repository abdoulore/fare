// The hosted run: the same browser, against the deployed site on testnet. No local stack.
//
//   HOSTED_URL=https://fare.example npx playwright test -c playwright.hosted.config.ts

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: /hosted\.spec\.ts/,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'hosted-results/trace',
  use: { baseURL: process.env.HOSTED_URL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
});
