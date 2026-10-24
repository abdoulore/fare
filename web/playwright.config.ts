import { defineConfig, devices } from '@playwright/test';

const env = 'VITE_API_URL=http://127.0.0.1:18080 VITE_ISSUER_URL=http://127.0.0.1:18787 VITE_PAYER_URL=http://127.0.0.1:18791';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', testMatch: /(flow|a11y)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', testMatch: /layout\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 740 } } },
  ],
  webServer: [
    { command: 'node e2e/stack.ts', url: 'http://127.0.0.1:18787/health', reuseExistingServer: false, stdout: 'pipe' },
    { command: `${env} npx vite build && npx vite preview --strictPort`, url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  ],
});
