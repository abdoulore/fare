// 375 px wide: no horizontal scroll, the pitch and the button above the fold, keyboard reach.

import { expect, test } from '@playwright/test';

for (const path of ['/', '/try', '/server', '/proof', '/how']) {
  test(`${path} fits 375 px`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(300);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
}

test('the landing pitch and its button are above the fold on a phone', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByRole('link', { name: 'Try it on testnet' });
  await expect(cta).toBeInViewport();
  await expect(page.locator('h1')).toBeInViewport();
});

test('the main flow is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Try it on testnet');
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.getByRole('button', { name: 'Ask without a token' })).toBeEnabled();
});
