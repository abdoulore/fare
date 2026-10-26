// The buyer flow on a local stack (stub scanner and wallet, real issuer, origin, API and
// payer), including every refusal the page promises.

import { expect, test, type Page } from '@playwright/test';

/** Opens /app; the price check runs on load and enables Buy once the key is checked. */
async function ask(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Buy 100 calls' })).toBeEnabled();
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
  // The offer leads, with the exact date the tokens stop working; the cryptography is one click away.
  await expect(page.getByTestId('offer')).toContainText('0.001 TAZ, paid once');
  await expect(page.getByTestId('works-until')).toHaveText(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2} UTC$/);
  const probe = page.getByTestId('probe');
  await expect(probe).toBeHidden();
  await page.getByText('What happens in your browser').click();
  await expect(probe).toContainText('402 Payment Required');
  await expect(probe).toContainText('key matches the published directory');
  await expect(probe).toContainText('100 calls for 0.001 TAZ');

  const purchaseId = await buy(page);
  await expect(page.getByText(/blinded 100 of 100 in this browser, \d+ ms/)).toBeVisible();
  await expect(page.getByTestId('order')).toContainText('You can close this page: the order is saved in this browser');

  await page.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  await expect(page.getByTestId('demo-paid')).toContainText('Paid by the demo wallet, not by you');
  await expect(page.getByTestId('demo-paid')).toContainText(/txid [0-9a-f]{64}/);
  await expect(page.getByTestId('status-label')).toHaveText('paid');
  await expect(page.getByTestId('tokens-left')).toHaveText('100');
  await expect(page.getByTestId('payment-receipt')).toContainText(/sent 0\.001 TAZ by the demo wallet, txid [0-9a-f]{64}/);
  await expect(page.getByRole('heading', { name: 'Ask' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Replay my last token' }), 'replay testing is not beside the normal action').toBeHidden();

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Ask with one token' }).click(), await expect(page.getByTestId('tokens-left')).toHaveText(String(99 - i));
  await expect(page.getByTestId('answers').locator('.sim')).toHaveCount(3);

  await page.getByText('Test the refusals').click();
  await page.getByRole('button', { name: 'Replay my last token' }).click();
  await expect(page.getByTestId('replay-refused')).toContainText('401 token_reused');
  await expect(page.getByTestId('tokens-left')).toHaveText('97');

  // Once tokens are held, the Use step has its own question box beside its buttons.
  await expect(page.locator('#prompt-use')).toBeVisible();
  await page.locator('#prompt-use').fill('#fail this one');
  await page.getByRole('button', { name: 'Ask with one token' }).click();
  await expect(page.getByTestId('call-refused')).toContainText('model_unavailable');
  await expect(page.getByTestId('call-refused')).toContainText('cannot refund it');
  await expect(page.getByTestId('tokens-left')).toHaveText('96');

  // Tokens survive a reload: they are in IndexedDB.
  await page.reload();
  await expect(page.getByTestId('tokens-total')).toHaveText('96 unspent');

  // The server view: both sides, no link, and never the purchase id.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Proof' }).click();
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
  await page.goto('/app');
  await expect(page.getByTestId('tokens-total')).toHaveText('96 unspent');
  await page.getByRole('button', { name: 'Forget my tokens' }).click();
  await expect(page.getByText('Delete 96 unspent tokens? They cannot be recovered.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep them' }).click();
  await expect(page.getByTestId('tokens-total')).toHaveText('96 unspent');
  await page.getByRole('button', { name: 'Forget my tokens' }).click();
  await page.getByRole('button', { name: 'Delete them' }).click();
  await expect(page.getByTestId('tokens-total')).toHaveText('0 unspent');
  await expect(page.getByRole('button', { name: 'Forget my tokens' })).toBeDisabled();

  expect(external, 'no request left the local stack').toEqual([]);
});

test('an underpaid purchase gets no tokens', async ({ page }) => {
  await ask(page);
  await buy(page);
  await page.getByText('Test the refusals').click();
  await page.getByRole('button', { name: 'Pay half (shows underpaid)' }).click();
  await expect(page.getByTestId('demo-paid')).toContainText('Sent 0.0005 TAZ');
  await expect(page.getByTestId('status-label')).toHaveText('postage due');
  await expect(page.getByTestId('status')).toContainText('No signatures are issued');
  await expect(page.getByTestId('dead')).toContainText('No tokens from this purchase');
  await expect(page.getByTestId('payment-receipt')).toContainText('sent 0.0005 TAZ by the demo wallet');
  await expect(page.getByTestId('tokens-left')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Ask with one token' })).toBeDisabled();
});

test('a challenge with an unlisted key is refused before any order', async ({ page }) => {
  let orders = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/fare/purchases') && r.method() === 'POST') orders++;
  });
  await page.goto('/app');
  await page.getByText('Test the refusals').click();
  await page.getByLabel('Simulate a malicious API that swaps the challenge key').check();
  await page.getByRole('button', { name: 'Ask without a token' }).click();
  await expect(page.getByTestId('key-refused')).toContainText('not in the issuer directory');
  await expect(page.getByRole('button', { name: 'Buy 100 calls' })).toBeDisabled();
  expect(orders).toBe(0);
});

test('a paid order survives its tab closing before the tokens arrive', async ({ context }) => {
  const first = await context.newPage();
  // This tab never sees the purchase paid: the issuer answers "pending" to it.
  await first.route(/\/fare\/purchases\/[0-9a-f]{32}$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":"pending"}' }),
  );
  await ask(first);
  await buy(first);
  await first.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  await expect(first.getByTestId('demo-paid')).toBeVisible();
  await expect(first.getByTestId('tokens-left')).toHaveText('0');
  await first.close();

  const later = await context.newPage();
  await later.goto('/app');
  await expect(later.getByTestId('order')).toContainText('Your order from your last visit');
  await expect(later.getByTestId('tokens-left')).toHaveText('100', { timeout: 30_000 });
  await later.getByRole('button', { name: 'Ask with one token' }).click();
  await expect(later.getByTestId('answers').locator('li')).toHaveCount(1);
  await later.reload();
  await expect(later.getByTestId('order'), 'a collected order is not resumed again').toHaveCount(0);
  await expect(later.getByTestId('tokens-total')).toHaveText('99 unspent');
});

test('two tabs share one sheet and never spend the same token', async ({ context }) => {
  const a = await context.newPage();
  await ask(a);
  await buy(a);
  await a.getByRole('button', { name: 'Pay 0.001 TAZ with the demo payer' }).click();
  await expect(a.getByTestId('tokens-left')).toHaveText('100');

  const b = await context.newPage();
  await b.goto('/app');
  await expect(b.getByTestId('tokens-left')).toHaveText('100');
  await b.getByRole('button', { name: 'Ask with one token' }).click();
  await expect(b.getByTestId('tokens-left')).toHaveText('99');
  await expect(a.getByTestId('tokens-total'), 'the other tab hears the spend').toHaveText('99 unspent');

  const answered = (p: typeof a, n: number) => expect(p.getByTestId('answers').locator('li')).toHaveCount(n);
  await Promise.all([a.getByRole('button', { name: 'Ask with one token' }).click(), b.getByRole('button', { name: 'Ask with one token' }).click()]);
  await answered(a, 1);
  await answered(b, 2);
  await expect(a.getByTestId('answers').locator('.sim')).toHaveCount(1);
  await expect(b.getByTestId('answers').locator('.sim'), 'no call refused as a reused token').toHaveCount(2);
  await expect(a.getByTestId('tokens-total')).toHaveText('97 unspent');
  await expect(b.getByTestId('tokens-total')).toHaveText('97 unspent');
});

test('an expired purchase says so and offers a new one', async ({ page }) => {
  await page.route(/\/fare\/purchases\/[0-9a-f]{32}$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":"expired"}' }),
  );
  await ask(page);
  await buy(page);
  await expect(page.getByTestId('status-label')).toHaveText('expired');
  await expect(page.getByTestId('status')).toContainText('Order again');
  await expect(page.getByTestId('dead')).toContainText('No tokens from this purchase');
  await expect(page.getByTestId('tokens-left')).toHaveText('0');
});

test('every page loads only from this origin and the stack', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  for (const path of ['/', '/app', '/developers', '/proof']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  for (const h of hosts) expect(h).toMatch(/^127\.0\.0\.1:\d+$/);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain('connect-src');
});

test('old paths redirect to where their content lives now', async ({ page }) => {
  for (const [from, to] of [['/try', /\/app$/], ['/server', /\/proof#ledger$/], ['/how', /\/proof#who-sees-what$/]] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('home shows a live 402 from the API with the key checked against the directory', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: /hosted API answered 402 Payment Required, 100 calls for 0.001 TAZ, and its key matches the published directory/ })).toBeVisible();
  await expect(page.getByTestId('hero-stamp')).toContainText("createOrigin");
});
