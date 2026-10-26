// Accessibility: no axe-core violations (WCAG 2.1 A and AA) on any page, in both colour
// schemes, including /app after a purchase with answers and a refusal on screen.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const scheme of ['dark', 'light'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const path of ['/', '/developers', '/proof']) {
      test(`${path} has no violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        await page.waitForTimeout(500);
        await audit(page);
      });
    }
    test('/app has no violations through a purchase', async ({ page }) => {
      await page.goto('/app');
      await audit(page);
      await page.getByText('What happens in your browser').click();
      await page.getByRole('button', { name: 'Buy 100 calls' }).click();
      await expect(page.getByTestId('order')).toBeVisible();
      await audit(page);
      await page.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
      await expect(page.getByTestId('tokens-left')).toHaveText('100');
      await page.getByRole('button', { name: 'Ask with one token' }).click();
      await page.getByText('Test the refusals').click();
      await page.getByRole('button', { name: 'Replay my last token' }).click();
      await expect(page.getByTestId('replay-refused')).toBeVisible();
      await audit(page);
    });
  });
}
