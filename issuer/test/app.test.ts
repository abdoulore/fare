import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { publicVerif } from '@cloudflare/privacypass-ts';

import { PACK, GRACE_SECONDS, EPOCH_SECONDS } from '../src/config.ts';
import { epochStart } from '../src/keys.ts';
import { blind, json, MODE, ORIGIN_NAME, startIssuer, stubScanner, tempDir, type StubScanner, type TestIssuer } from './helpers.ts';

const { Origin, TokenResponse } = publicVerif;

let scanner: StubScanner;
let issuer: TestIssuer;
let dataDir: string;
let pack: Awaited<ReturnType<typeof blind>>;
let tokenKey: Uint8Array;

const post = (body: unknown, raw?: string) =>
  fetch(`${issuer.url}/fare/purchases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
const status = (id: string) => fetch(`${issuer.url}/fare/purchases/${id}`);

async function buy(requests = pack.requests) {
  const res = await post({ pack: PACK, blinded: requests });
  assert.equal(res.status, 201);
  return json(res);
}

before(async () => {
  scanner = await stubScanner();
  dataDir = tempDir();
  issuer = await startIssuer(scanner.url, dataDir, epochStart(10_000) + 3600);
  const dir = await json(await fetch(`${issuer.url}/.well-known/private-token-issuer-directory`));
  tokenKey = new Uint8Array(Buffer.from(dir['token-keys'][0]['token-key'], 'base64url'));
  pack = await blind(PACK, tokenKey);
});

after(async () => {
  await issuer.close();
  await scanner.close();
});

test('directory is RFC 9578 shaped and lists one type 2 key', async () => {
  const res = await fetch(`${issuer.url}/.well-known/private-token-issuer-directory`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/private-token-issuer-directory');
  const body = await json(res);
  assert.equal(body['issuer-request-uri'], '/fare/purchases');
  assert.equal(body['token-keys'].length, 1);
  assert.equal(body['token-keys'][0]['token-type'], 2);
  assert.equal(body['token-keys'][0]['not-before'], epochStart(10_000));
});

test('a paid purchase returns N signatures that finalize into N valid tokens', async () => {
  const bought = await buy();
  assert.match(bought.purchase_id, /^[0-9a-f]{32}$/);
  assert.match(bought.pay_uri, /^zcash:\S+\?amount=0\.001$/);
  assert.ok(Date.parse(bought.expires_at) > issuer.clock.now * 1000);

  const before = await json(await status(bought.purchase_id));
  assert.deepEqual(before, { status: 'pending' });

  scanner.statuses.set(bought.purchase_id, { status: 'paid' });
  const paid = await json(await status(bought.purchase_id));
  assert.equal(paid.status, 'paid');
  assert.equal(paid.signatures.length, PACK);
  assert.equal(paid.warning, undefined);

  const origin = new Origin(MODE, [ORIGIN_NAME]);
  const publicKey = issuer.issuer.keys.signable(10_000, issuer.clock.now)!;
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    publicKey.pub.export({ type: 'spki', format: 'der' }),
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['verify'],
  );
  for (let i = 0; i < PACK; i++) {
    const token = await pack.clients[i].finalize(new TokenResponse(new Uint8Array(Buffer.from(paid.signatures[i], 'base64url'))));
    assert.equal(await origin.verify(token, cryptoKey), true, `token ${i}`);
  }
});

test('no signatures until the scanner says paid', async () => {
  const bought = await buy();
  for (const s of ['pending', 'in_mempool', 'confirming', 'underpaid']) {
    scanner.statuses.set(bought.purchase_id, { status: s });
    const body = await json(await status(bought.purchase_id));
    assert.deepEqual(body, { status: s });
  }
});

test('a transparent-funded payment is signed but flagged', async () => {
  const bought = await buy();
  scanner.statuses.set(bought.purchase_id, { status: 'paid', leaky_funding: true });
  const body = await json(await status(bought.purchase_id));
  assert.equal(body.warning, 'funded_from_transparent_inputs');
  assert.equal(body.signatures.length, PACK);
});

test('a signing failure is a clean 500, never an OpenSSL message', async () => {
  const bought = await buy();
  scanner.statuses.set(bought.purchase_id, { status: 'paid' });
  const keys = issuer.issuer.keys;
  const real = keys.signable.bind(keys);
  const { generateKeyPairSync } = await import('node:crypto');
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
  // The right private key with a stranger's public key: verification must fail.
  keys.signable = (epoch, t) => {
    const k = real(epoch, t);
    return k && { ...k, pub: stranger.publicKey };
  };
  try {
    const res = await status(bought.purchase_id);
    assert.equal(res.status, 500);
    assert.deepEqual(await json(res), { error: 'signing_failed' });
  } finally {
    keys.signable = real;
  }
});

test('refuses any pack size but the fixed one', async () => {
  const before = scanner.mints;
  for (const [packN, blinded, reason] of [
    [99, pack.requests.slice(0, 99), 'wrong_pack'],
    [101, pack.requests, 'wrong_pack'],
    [PACK, pack.requests.slice(0, 99), 'wrong_count'],
    [PACK, [...pack.requests, pack.requests[0]], 'wrong_count'],
    ['100', pack.requests, 'wrong_pack'],
  ] as const) {
    const res = await post({ pack: packN, blinded });
    assert.equal(res.status, 400);
    assert.equal((await json(res)).error, reason);
  }
  assert.equal(scanner.mints, before, 'a refused order mints nothing');
});

test('refuses malformed, duplicate and foreign-key requests', async () => {
  const before = scanner.mints;
  const swap = (i: number, v: string) => pack.requests.map((r, j) => (j === i ? v : r));
  // Requests blinded for another issuer's key.
  const stranger = await startIssuer(scanner.url);
  const strangerDir = await json(await fetch(`${stranger.url}/.well-known/private-token-issuer-directory`));
  await stranger.close();
  const other = await blind(1, new Uint8Array(Buffer.from(strangerDir['token-keys'][0]['token-key'], 'base64url')));
  const cases: [unknown, string][] = [
    [{ pack: PACK, blinded: swap(3, 'not base64!') }, 'malformed_request'],
    [{ pack: PACK, blinded: swap(3, pack.requests[3].slice(0, -4)) }, 'malformed_request'],
    [{ pack: PACK, blinded: swap(3, 42 as unknown as string) }, 'malformed_request'],
    [{ pack: PACK, blinded: swap(7, pack.requests[0]) }, 'duplicate_request'],
    [{ pack: PACK, blinded: swap(9, other.requests[0]) }, 'unknown_key'],
    [{ pack: PACK, blinded: pack.requests, label: 'x' }, 'unknown_field'],
    [[1, 2], 'body_not_object'],
  ];
  for (const [body, reason] of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, reason);
    assert.equal((await json(res)).error, reason);
  }
  assert.equal((await json(await post(null, '{not json'))).error, 'body_not_json');
  assert.equal((await post(null, JSON.stringify({ pack: PACK, blinded: ['A'.repeat(300_000)] }))).status, 413);
  assert.equal(scanner.mints, before);
});

test('refuses unknown and malformed purchase ids', async () => {
  assert.equal((await status('0'.repeat(31) + 'f')).status, 404);
  for (const bad of ['xyz', 'A'.repeat(32), '0'.repeat(16), '..%2Fkeys']) {
    assert.equal((await status(bad)).status, 400, bad);
  }
});

test('an unreachable scanner is a 503, not a guess', async () => {
  const bought = await buy();
  scanner.down = true;
  try {
    assert.equal((await status(bought.purchase_id)).status, 503);
    assert.equal((await post({ pack: PACK, blinded: pack.requests })).status, 503);
  } finally {
    scanner.down = false;
  }
});

test('an unpaid purchase expires; a paid one is signed until its key retires', async () => {
  const t0 = issuer.clock.now;
  const unpaid = await buy();
  const paidLate = await buy();
  try {
    issuer.clock.now = t0 + 24 * 3600;
    assert.deepEqual(await json(await status(unpaid.purchase_id)), { status: 'expired' });

    scanner.statuses.set(paidLate.purchase_id, { status: 'paid' });
    assert.equal((await json(await status(paidLate.purchase_id))).signatures.length, PACK);

    issuer.clock.now = epochStart(10_000) + EPOCH_SECONDS + GRACE_SECONDS;
    const retired = await status(paidLate.purchase_id);
    assert.equal(retired.status, 410);
    assert.deepEqual(await json(retired), { status: 'key_retired' });
  } finally {
    issuer.clock.now = t0;
  }
});

test('wrong methods and paths', async () => {
  assert.equal((await fetch(`${issuer.url}/fare/purchases`)).status, 405);
  assert.equal((await fetch(`${issuer.url}/.well-known/private-token-issuer-directory`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${issuer.url}/admin`)).status, 404);
});

test('purchases on disk hold no client data and no signatures', () => {
  const records = JSON.parse(readFileSync(join(dataDir, 'purchases.json'), 'utf8')) as Record<string, unknown>[];
  assert.ok(records.length > 0);
  for (const r of records) {
    assert.deepEqual(Object.keys(r).sort(), ['epoch', 'expires_at', 'id', 'pay_uri', 'requests']);
  }
});

test('the issuer source logs nothing and never handles tokens', () => {
  for (const f of ['app.ts', 'keys.ts', 'scanner.ts', 'sign.ts', 'store.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), `${f} logs`);
    assert.ok(!/remoteAddress|user-agent|x-forwarded-for/i.test(src), `${f} reads client identity`);
    assert.ok(!/AuthorizationHeader|Origin\(|\.verify\(/.test(src), `${f} touches tokens`);
  }
});
