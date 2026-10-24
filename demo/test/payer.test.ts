import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';

import { createPayer, formatZat, parseBalance, type PayerOptions } from '../src/payer.ts';

const ADDR = 'utest1' + 'q'.repeat(100);
const URI = `zcash:${ADDR}?amount=0.001`;
const BALANCE = `As of chain tip 10, fully scanned to 10, 1 confirmation:
POOL              SPENDABLE        PENDING
ironwood              0.9921         0.0005
fare-wallet spends shielded notes only. It never spends transparent funds.
`;

async function payer(overrides: Partial<PayerOptions> = {}) {
  const calls: string[][] = [];
  const p = createPayer({
    priceZat: 100_000,
    webOrigins: ['http://web.fare.test'],
    run: async (args) => {
      calls.push(args);
      if (args[0] === 'balance') return BALANCE;
      if (args[0] === 'pay') return `Paying   x\nTXID ${'ab'.repeat(32)}\n`;
      return '';
    },
    ...overrides,
  });
  const server = createServer((req, res) => void p.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pay = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/pay`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const close = () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
  return { p, url, pay, calls, close };
}

test('balance and amounts parse exactly', () => {
  assert.equal(parseBalance(BALANCE), 99_260_000);
  assert.equal(parseBalance('nothing here'), undefined);
  assert.equal(formatZat(100_000), '0.001');
  assert.equal(formatZat(50_000), '0.0005');
  assert.equal(formatZat(100_000_000), '1');
});

test('pays the full price or half, says who paid, and returns the txid', async () => {
  const s = await payer();
  try {
    const full = await s.pay({ pay_uri: URI, mode: 'full' });
    assert.equal(full.status, 200);
    assert.deepEqual(await full.json(), { txids: ['ab'.repeat(32)], amount_zec: '0.001', mode: 'full', paid_by: 'fare-demo-wallet' });
    const pay = s.calls.find((c) => c[0] === 'pay')!;
    assert.deepEqual(pay, ['pay', URI, '--max-zec', '0.001', '--wait-secs', '240']);

    const other = `zcash:utest1${'p'.repeat(100)}?amount=0.001`;
    const half = await s.pay({ pay_uri: other, mode: 'half' });
    assert.equal(half.status, 200);
    assert.equal((await half.json()).amount_zec, '0.0005');
    assert.equal(s.calls.filter((c) => c[0] === 'pay')[1][1], `zcash:utest1${'p'.repeat(100)}?amount=0.0005`);
  } finally {
    await s.close();
  }
});

test('refuses anything but a testnet pack URI, and each address twice', async () => {
  const s = await payer();
  try {
    const cases: [unknown, number, string][] = [
      ['nope', 400, 'body_not_json'],
      [{ pay_uri: URI }, 400, 'body_must_be_pay_uri_and_mode'],
      [{ pay_uri: URI, mode: 'double' }, 400, 'mode_must_be_full_or_half'],
      [{ pay_uri: URI, mode: 'full', extra: 1 }, 400, 'body_must_be_pay_uri_and_mode'],
      [{ pay_uri: `zcash:u1${'q'.repeat(100)}?amount=0.001`, mode: 'full' }, 400, 'pay_uri_not_testnet'],
      [{ pay_uri: `zcash:tmXYZ?amount=0.001`, mode: 'full' }, 400, 'pay_uri_not_testnet'],
      [{ pay_uri: `${URI}&memo=aGk`, mode: 'full' }, 400, 'pay_uri_not_testnet'],
      [{ pay_uri: `zcash:${ADDR}?amount=1`, mode: 'full' }, 400, 'pay_uri_wrong_price'],
    ];
    for (const [body, code, error] of cases) {
      const res = await s.pay(body);
      assert.equal(res.status, code, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error });
    }
    assert.equal(s.calls.filter((c) => c[0] === 'pay').length, 0, 'nothing paid');
    assert.equal((await s.pay({ pay_uri: URI, mode: 'full' })).status, 200);
    const again = await s.pay({ pay_uri: URI, mode: 'half' });
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: 'already_paid' });
  } finally {
    await s.close();
  }
});

test('hourly caps, globally and per client', async () => {
  const clock = { t: 1_000_000 };
  const s = await payer({ maxPerHour: 3, maxPerClientHour: 2, trustProxy: true, now: () => clock.t });
  const uri = (c: string) => `zcash:utest1${c.repeat(100)}?amount=0.001`;
  try {
    assert.equal((await s.pay({ pay_uri: uri('a'), mode: 'full' }, { 'x-forwarded-for': '198.51.100.1' })).status, 200);
    assert.equal((await s.pay({ pay_uri: uri('c'), mode: 'full' }, { 'x-forwarded-for': '198.51.100.1' })).status, 200);
    const third = await s.pay({ pay_uri: uri('d'), mode: 'full' }, { 'x-forwarded-for': '198.51.100.1' });
    assert.deepEqual([third.status, await third.json()], [429, { error: 'demo_payer_client_limit' }]);
    assert.equal((await s.pay({ pay_uri: uri('d'), mode: 'full' }, { 'x-forwarded-for': '203.0.113.9' })).status, 200);
    const global = await s.pay({ pay_uri: uri('e'), mode: 'full' }, { 'x-forwarded-for': '192.0.2.4' });
    assert.deepEqual([global.status, await global.json()], [429, { error: 'demo_payer_hourly_limit' }]);
    clock.t += 60 * 60 * 1000 + 1;
    assert.equal((await s.pay({ pay_uri: uri('e'), mode: 'full' }, { 'x-forwarded-for': '192.0.2.4' })).status, 200);
  } finally {
    await s.close();
  }
});

test('an empty payer says so; a failed payment frees the address and the slot', async () => {
  let fail = true;
  const s = await payer({
    run: async (args) => {
      if (args[0] === 'balance') return BALANCE.replace('0.9921', '0.0001').replace('0.0005', '0');
      if (args[0] === 'pay' && fail) throw new Error('lightwalletd unreachable');
      return `TXID ${'cd'.repeat(32)}\n`;
    },
  });
  try {
    const before = await (await fetch(`${s.url}/health`)).json();
    assert.equal(before.ok, false, 'no balance known yet');
    const failed = await s.pay({ pay_uri: URI, mode: 'full' });
    assert.deepEqual([failed.status, await failed.json()], [502, { error: 'demo_payer_failed' }]);
    await s.p.refreshBalance();
    const health = await (await fetch(`${s.url}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.empty, true);
    assert.equal(health.balance_zat, 10_000);
    fail = false;
    const empty = await s.pay({ pay_uri: URI, mode: 'full' });
    assert.deepEqual([empty.status, await empty.json()], [503, { error: 'demo_payer_empty' }]);
  } finally {
    await s.close();
  }
});

test('CORS for the web origin only', async () => {
  const s = await payer();
  try {
    const pre = await fetch(`${s.url}/pay`, { method: 'OPTIONS', headers: { origin: 'http://web.fare.test', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://web.fare.test');
    const bad = await fetch(`${s.url}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  } finally {
    await s.close();
  }
});

test('the payer logs nothing, keeps client addresses only hashed, and never sees a purchase id or token', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'payer.ts'), 'utf8');
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), 'payer logs');
  assert.ok(!/purchase_id|authorization|privacypass/i.test(src.replace(/^\/\/.*$/gm, '')), 'payer handles purchase ids or tokens');
  assert.match(src, /hash\(clientOf\(req\)\)/, 'client address hashed before it is kept');
});
