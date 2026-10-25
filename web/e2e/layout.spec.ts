// 375 px wide: no horizontal scroll, the pitch and the button above the fold, keyboard reach.

import { expect, test } from '@playwright/test';

for (const path of ['/', '/app', '/developers', '/proof']) {
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
  const cta = page.getByRole('link', { name: 'Add Fare to your API' });
  await expect(cta).toBeInViewport();
  await expect(page.locator('h1')).toBeInViewport();
});

test('the main flow is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Try it with a demo payment');
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Ask without a token' })).toBeEnabled();
});

test('/app fits 375 px through a whole purchase', async ({ page }) => {
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Ask without a token' }).click();
  await expect(page.getByTestId('probe')).toContainText('key matches the published directory');
  expect(await width(), 'after the 402').toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Buy 100 calls' }).click();
  await expect(page.getByTestId('order')).toBeVisible();
  await page.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  await expect(page.getByTestId('status-label')).toBeVisible();
  expect(await width(), 'while waiting').toBeLessThanOrEqual(375);
  await expect(page.getByTestId('tokens-left')).toHaveText('100', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Ask with one token' }).click();
  await page.getByRole('button', { name: 'Replay my last token' }).click();
  await expect(page.getByTestId('replay-refused')).toBeVisible();
  expect(await width(), 'with tokens and a refusal').toBeLessThanOrEqual(375);
});

test('the live postmark inscriptions fit their arcs in the real font', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: /^Live check/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<SVGTextElement>('.postmark text.inscription')].map((t) => ({ text: t.textContent, len: t.getComputedTextLength(), arc: Math.PI * 46 - 20 })).filter((x) => x.len > x.arc),
  );
  expect(overflow).toEqual([]);
});

for (const path of ['/developers', '/proof']) {
  test(`${path} tables and code fit 375 px without hidden overflow`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('main table')].filter((t) => t.getBoundingClientRect().right > window.innerWidth + 1 || t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent?.slice(0, 40)),
    );
    expect(clipped).toEqual([]);
    for (const block of await page.locator('.code-block').all()) {
      const copy = await block.locator('button').boundingBox();
      const code = await block.locator('pre').boundingBox();
      expect(copy && code && copy.y + copy.height <= code.y + 1).toBe(true);
    }
  });
}
