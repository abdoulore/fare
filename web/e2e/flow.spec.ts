// The buyer flow on a local stack (stub scanner and wallet, real issuer, origin, API and
// payer), including every refusal the page promises.

import { expect, test, type Page } from '@playwright/test';

async function ask(page: Page) {
  await page.goto('/try');
  const btn = page.getByRole('button', { name: 'Ask without a token' });
  await expect(btn).toBeEnabled();
  await btn.click();
}

async function buy(page: Page): Promise<string> {
  const order = page.waitForResponse((r) => r.url().endsWith('/fare/purchases') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Buy 100 calls' }).click();
  const res = await order;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { purchase_id: string };
  await expect(page.getByTestId('order')).toBeVisible();
  return body.purchase_id;
}

test('402, buy, demo payer, paid, 100 tokens, 3 calls, replay and model failure refused', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url());
  });

  await ask(page);
  const probe = page.getByTestId('probe');
  await expect(probe).toContainText('402 Payment Required');
  await expect(probe).toContainText('key matches the published directory');
  await expect(probe).toContainText('100 calls for 0.001 TAZ');

  const purchaseId = await buy(page);
  await expect(page.getByText(/blinded 100 of 100 nonces in this browser, \d+ ms/)).toBeVisible();

  await page.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  await expect(page.getByTestId('demo-paid')).toContainText('Paid by the demo wallet, not by you');
  await expect(page.getByTestId('demo-paid')).toContainText(/txid [0-9a-f]{64}/);
  await expect(page.getByTestId('status-label')).toHaveText('paid');
  await expect(page.getByTestId('tokens-left')).toHaveText('100');

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Ask with one token' }).click(), await expect(page.getByTestId('tokens-left')).toHaveText(String(99 - i));
  await expect(page.getByTestId('answers').locator('.badge.sim')).toHaveCount(3);

  await page.getByRole('button', { name: 'Replay my last token' }).click();
  await expect(page.getByTestId('replay-refused')).toContainText('401 token_reused');
  await expect(page.getByTestId('tokens-left')).toHaveText('97');

  await page.getByLabel('Question').fill('#fail this one');
  await page.getByRole('button', { name: 'Ask with one token' }).click();
  await expect(page.getByTestId('call-refused')).toContainText('model_unavailable');
  await expect(page.getByTestId('call-refused')).toContainText('cannot refund it');
  await expect(page.getByTestId('tokens-left')).toHaveText('96');

  // Tokens survive a reload: they are in IndexedDB.
  await page.reload();
  await expect(page.getByTestId('tokens-total')).toHaveText('96 unspent');

  // The server view: both sides, no link, and never the purchase id.
  await page.getByRole('link', { name: 'What the server sees' }).first().click();
  await expect(page.getByTestId('issuer-table')).toContainText('paid');
  await expect(page.getByTestId('origin-stats')).toContainText('Served');
  await expect(page.getByTestId('no-link')).toBeVisible();
  const ledger = (await (await page.request.get('http://127.0.0.1:18787/fare/ledger')).json()) as { keys: { key_id: string; issued: number }[] };
  const stats = (await (await page.request.get('http://127.0.0.1:18080/v1/stats')).json()) as { spent_by_key: Record<string, number> };
  const key = ledger.keys[0];
  expect(key.issued % 100).toBe(0);
  await expect(page.getByTestId('dots').locator('i')).toHaveCount(Math.min(key.issued, 1000));
  const spentHere = stats.spent_by_key[key.key_id.slice(0, 16)];
  expect(spentHere).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('dots').locator('i.spent')).toHaveCount(spentHere);
  expect(await page.content()).not.toContain(purchaseId);

  // Forget my tokens.
  await page.goto('/try');
  await expect(page.getByTestId('tokens-total')).toHaveText('96 unspent');
  await page.getByRole('button', { name: 'Forget my tokens' }).click();
  await expect(page.getByTestId('tokens-total')).toHaveText('0 unspent');

  expect(external, 'no request left the local stack').toEqual([]);
});

test('an underpaid purchase gets no tokens', async ({ page }) => {
  await ask(page);
  await buy(page);
  await page.getByRole('button', { name: 'Pay half (shows underpaid)' }).click();
  await expect(page.getByTestId('demo-paid')).toContainText('Sent 0.0005 TAZ');
  await expect(page.getByTestId('status-label')).toHaveText('underpaid');
  await expect(page.getByTestId('dead')).toContainText('No signatures are issued');
  await expect(page.getByTestId('tokens-left')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Ask with one token' })).toBeDisabled();
});

test('a challenge with an unlisted key is refused before any order', async ({ page }) => {
  let orders = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/fare/purchases') && r.method() === 'POST') orders++;
  });
  await page.goto('/try');
  await page.getByLabel('Simulate a malicious API that swaps the challenge key').check();
  await page.getByRole('button', { name: 'Ask without a token' }).click();
  await expect(page.getByTestId('key-refused')).toContainText('not in the issuer directory');
  await expect(page.getByRole('button', { name: 'Buy 100 calls' })).toBeDisabled();
  expect(orders).toBe(0);
});

test('an expired purchase says so and offers a new one', async ({ page }) => {
  await page.route(/\/fare\/purchases\/[0-9a-f]{32}$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":"expired"}' }),
  );
  await ask(page);
  await buy(page);
  await expect(page.getByTestId('status-label')).toHaveText('expired');
  await expect(page.getByTestId('dead')).toContainText('Order again');
  await expect(page.getByTestId('tokens-left')).toHaveText('0');
});

test('every page loads only from this origin and the stack', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  for (const path of ['/', '/try', '/server', '/proof', '/how']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  for (const h of hosts) expect(h).toMatch(/^127\.0\.0\.1:\d+$/);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain('connect-src');
});
