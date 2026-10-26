// One real run on the hosted stack, on testnet: health, a pack bought and paid by the demo
// payer, 3 calls, a replayed token refused, and the server view. Screenshots of each step
// and the txid go to hosted-results/. Runs only with HOSTED_URL set.

import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

const SITE = process.env.HOSTED_URL ?? '';
const OUT = 'hosted-results';
test.skip(!SITE, 'HOSTED_URL not set');

const sub = (name: string) => {
  const u = new URL(SITE);
  return `${u.protocol}//${name}.${u.host}`;
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test('hosted: demo payer buys a pack, 3 calls, replay refused', async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  const record: Record<string, unknown> = { site: SITE, at: new Date().toISOString() };

  // Health of every public service.
  for (const name of ['issuer', 'api', 'payer']) {
    const res = await request.get(`${sub(name)}/health`);
    expect(res.status(), `${name} health`).toBe(200);
    record[`${name}_health`] = await res.json();
  }
  const payer = record.payer_health as { empty: boolean; ok: boolean };
  expect(payer.ok, 'demo payer has a known balance').toBe(true);
  expect(payer.empty, 'demo payer has funds').toBe(false);
  expect((record.issuer_health as { scanned_to: number | null }).scanned_to, 'scanner has synced').not.toBeNull();

  const external: string[] = [];
  const allowed = new Set([new URL(SITE).host, ...['issuer', 'api', 'payer'].map((n) => new URL(sub(n)).host)]);
  page.on('request', (r) => {
    if (!allowed.has(new URL(r.url()).host)) external.push(r.url());
  });

  await page.goto('/');
  await expect(page.getByTestId('status-line')).toBeVisible();
  await shot(page, '01-landing');

  await page.goto('/app');
  await expect(page.getByTestId('works-until')).toContainText('UTC');
  await page.getByText('What happens in your browser').click();
  await expect(page.getByTestId('probe')).toContainText('key matches the published directory');
  await shot(page, '02-402');

  const order = page.waitForResponse((r) => r.url().endsWith('/fare/purchases') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Buy 100 calls' }).click();
  expect((await order).status()).toBe(201);
  await expect(page.getByTestId('order')).toBeVisible({ timeout: 60_000 });
  await shot(page, '03-ordered');

  const paid = page.waitForResponse((r) => r.url().endsWith('/pay') && r.request().method() === 'POST', { timeout: 8 * 60_000 });
  await page.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  const payRes = await paid;
  const payBody = (await payRes.json()) as { txids?: string[]; error?: string };
  record.payment = payBody;
  writeFileSync(`${OUT}/run.json`, JSON.stringify(record, null, 2));
  expect(payRes.status(), `demo payer: ${payBody.error}`).toBe(200);
  console.log(`TXID ${payBody.txids?.join(' ')}`);
  await expect(page.getByTestId('demo-paid')).toBeVisible();
  await shot(page, '04-paid-by-demo-wallet');

  await expect(page.getByTestId('status-label')).toHaveText('paid', { timeout: 12 * 60_000 });
  await expect(page.getByTestId('tokens-left')).toHaveText('100', { timeout: 60_000 });
  await shot(page, '05-tokens');

  for (const [i, q] of ['What does a shielded Zcash payment hide?', 'In one sentence, what is a blind signature?', 'Why does single use matter for a token?'].entries()) {
    await page.locator('#prompt-use').fill(q);
    await page.getByRole('button', { name: 'Ask with one token' }).click();
    await expect(page.getByTestId('tokens-left')).toHaveText(String(99 - i));
    await expect(page.getByTestId('answers').locator('li')).toHaveCount(i + 1, { timeout: 120_000 });
  }
  const answers = await page.getByTestId('answers').locator('li').allInnerTexts();
  record.answers = answers;

  await page.getByText('Test the refusals').click();
  await page.getByRole('button', { name: 'Replay my last token' }).click();
  await expect(page.getByTestId('replay-refused')).toContainText('401 token_reused');
  await shot(page, '06-calls-and-replay');

  await page.goto('/proof');
  await expect(page.getByTestId('issuer-table')).toContainText('paid', { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await shot(page, '07-server');
  record.ledger = await (await request.get(`${sub('issuer')}/fare/ledger`)).json();
  record.origin_stats = await (await request.get(`${sub('api')}/v1/stats`)).json();

  await page.goto('/proof');
  await shot(page, '08-proof');

  record.external_requests = external;
  writeFileSync(`${OUT}/run.json`, JSON.stringify(record, null, 2));
  expect(external, 'no request left the site and its services').toEqual([]);
});
