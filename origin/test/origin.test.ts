import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { AuthorizationHeader, publicVerif, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

import { createOrigin } from '../src/index.ts';
import { FareClient } from '../../sdk/src/index.ts';
import { blind, json, startIssuer, stubScanner, tempDir, type StubScanner, type TestIssuer } from '../../issuer/test/helpers.ts';
import { EPOCH_SECONDS, GRACE_SECONDS, PACK } from '../../issuer/src/config.ts';
import { epochStart } from '../../issuer/src/keys.ts';

const { BLIND_RSA, Token, TokenResponse } = { ...publicVerif, Token: (await import('@cloudflare/privacypass-ts')).Token };

const ORIGIN_NAME = 'demo.fare.test';
const ISSUER_NAME = 'issuer.fare.test';

let scanner: StubScanner;
let issuer: TestIssuer;

async function serve(handler: Parameters<typeof createServer>[1]) {
  const server: Server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
  return { url, close };
}

async function startOrigin(dataDir = tempDir(), issuerUrl = issuer.url) {
  const origin = createOrigin({ originName: ORIGIN_NAME, issuerName: ISSUER_NAME, issuerUrl, pack: PACK, priceZec: '0.001', dataDir });
  const served = { count: 0 };
  const http = await serve(origin.protect((_req, res) => {
    served.count += 1;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"answer":42}');
  }));
  return { origin, served, dataDir, ...http };
}

const payer = async () => {
  for (const id of scanner.statuses.keys()) scanner.statuses.set(id, { status: 'paid' });
};

/** An SDK client with a fresh pack bought against `originUrl`. */
async function stocked(originUrl: string) {
  const sdk = new FareClient({ issuerUrl: issuer.url, stateFile: join(tempDir(), 'sdk.json'), pollMs: 10, timeoutMs: 2_000 });
  await sdk.pin();
  const res = await sdk.fetch(originUrl, {}, payer);
  assert.equal(res.status, 200);
  const challenge = sdk.checkChallenge((await fetch(originUrl)).headers.get('www-authenticate'));
  return { sdk, take: () => sdk.spend(challenge)! };
}

const call = (url: string, authorization?: string) => fetch(url, authorization ? { headers: { authorization } } : {});

before(async () => {
  scanner = await stubScanner();
  issuer = await startIssuer(scanner.url, tempDir(), epochStart(20_000) + 3600);
});

after(async () => {
  await issuer.close();
  await scanner.close();
});

test('402 carries one type 2 challenge for this origin, the newest issuer key, and the offer', async () => {
  const o = await startOrigin();
  try {
    const res = await call(o.url);
    assert.equal(res.status, 402);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const [c] = WWWAuthenticateHeader.parse(res.headers.get('www-authenticate')!);
    assert.equal(c.challenge.tokenType, 2);
    assert.equal(c.challenge.issuerName, ISSUER_NAME);
    assert.deepEqual(c.challenge.originInfo, [ORIGIN_NAME]);
    assert.equal(c.challenge.redemptionContext.length, 0, 'empty redemption context');
    const dir = await json(await fetch(`${issuer.url}/.well-known/private-token-issuer-directory`));
    assert.equal(Buffer.from(c.tokenKey).toString('base64url'), dir['token-keys'][0]['token-key']);
    assert.deepEqual(JSON.parse(res.headers.get('fare-offer')!), { pack: PACK, price_zec: '0.001', issuer: issuer.url });
    assert.equal(o.served.count, 0);
  } finally {
    await o.close();
  }
});

test('end to end: the SDK buys a pack and every call spends one token', async () => {
  const o = await startOrigin();
  try {
    const { sdk } = await stocked(o.url);
    for (let i = 0; i < 9; i++) assert.equal((await sdk.fetch(o.url)).status, 200);
    assert.equal(o.served.count, 10);
    assert.equal(o.origin.stats().redeemed, 10);
    assert.equal(sdk.tokenCount(), PACK - 10);
  } finally {
    await o.close();
  }
});

test('a replayed token is refused', async () => {
  const o = await startOrigin();
  try {
    const { take } = await stocked(o.url);
    const auth = take();
    assert.equal((await call(o.url, auth)).status, 200);
    const replay = await call(o.url, auth);
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), { error: 'token_reused' });
  } finally {
    await o.close();
  }
});

test('one token sent twice at once is served once', async () => {
  const o = await startOrigin();
  try {
    const { take } = await stocked(o.url);
    const auth = take();
    const before = o.served.count;
    const codes = (await Promise.all([call(o.url, auth), call(o.url, auth), call(o.url, auth)])).map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 401, 401]);
    assert.equal(o.served.count, before + 1);
  } finally {
    await o.close();
  }
});

test('a token for another origin is wrong_challenge', async () => {
  const o = await startOrigin();
  try {
    // helpers.blind binds tokens to api.fare.test, not this origin.
    const dir = await json(await fetch(`${issuer.url}/.well-known/private-token-issuer-directory`));
    const pack = await blind(PACK, new Uint8Array(Buffer.from(dir['token-keys'][0]['token-key'], 'base64url')));
    const bought = await json(await fetch(`${issuer.url}/fare/purchases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: PACK, blinded: pack.requests }) }));
    scanner.statuses.set(bought.purchase_id, { status: 'paid' });
    const paid = await json(await fetch(`${issuer.url}/fare/purchases/${bought.purchase_id}`));
    const token = await pack.clients[0].finalize(new TokenResponse(new Uint8Array(Buffer.from(paid.signatures[0], 'base64url'))));
    const res = await call(o.url, new AuthorizationHeader(token).toString());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'wrong_challenge' });
  } finally {
    await o.close();
  }
});

test('a token from another issuer key is unknown_key', async () => {
  const strangerScanner = await stubScanner();
  const stranger = await startIssuer(strangerScanner.url);
  const strangerOrigin = await startOrigin(tempDir(), stranger.url);
  const o = await startOrigin();
  try {
    const sdk = new FareClient({ issuerUrl: stranger.url, stateFile: join(tempDir(), 's.json'), pollMs: 10, timeoutMs: 2_000 });
    await sdk.pin();
    const pay = async () => { for (const id of strangerScanner.statuses.keys()) strangerScanner.statuses.set(id, { status: 'paid' }); };
    assert.equal((await sdk.fetch(strangerOrigin.url, {}, pay)).status, 200);
    const auth = sdk.spend(sdk.checkChallenge((await fetch(strangerOrigin.url)).headers.get('www-authenticate')))!;
    const res = await call(o.url, auth);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unknown_key' });
  } finally {
    await o.close();
    await strangerOrigin.close();
    await stranger.close();
    await strangerScanner.close();
  }
});

test('tampered and malformed tokens are bad_signature', async () => {
  const o = await startOrigin();
  try {
    const { take } = await stocked(o.url);
    const token = AuthorizationHeader.parse(BLIND_RSA, take())[0].token;
    const bytes = token.serialize();
    bytes[bytes.length - 1] ^= 1;
    const tampered = new AuthorizationHeader(Token.deserialize(BLIND_RSA, bytes)).toString();
    for (const auth of [tampered, 'PrivateToken token="AAAA"', 'Bearer abc', 'PrivateToken']) {
      const res = await call(o.url, auth);
      assert.equal(res.status, 401, auth.slice(0, 20));
      assert.deepEqual(await res.json(), { error: 'bad_signature' });
    }
    assert.equal(o.origin.stats().refused.bad_signature, 4);
  } finally {
    await o.close();
  }
});

test('after rotation and grace, tokens under the old key are expired_epoch', async () => {
  const o = await startOrigin();
  const t0 = issuer.clock.now;
  try {
    const { take, sdk } = await stocked(o.url);
    const old = take();
    const kept = take();

    // Next epoch, inside the grace window: the old key still redeems.
    issuer.clock.now = epochStart(20_001) + 60;
    await o.origin.refresh(true);
    assert.equal((await call(o.url, kept)).status, 200);

    // Past the grace window: the directory dropped it.
    issuer.clock.now = epochStart(20_001) + GRACE_SECONDS + 1;
    await o.origin.refresh(true);
    const res = await call(o.url, old);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'expired_epoch' });
    assert.ok(sdk.tokenCount() > 0);
  } finally {
    issuer.clock.now = t0;
  }
  await o.close();
  assert.ok(EPOCH_SECONDS > GRACE_SECONDS);
});

test('the spent set survives a restart and holds nonces only', async () => {
  const dataDir = tempDir();
  const a = await startOrigin(dataDir);
  const { take } = await stocked(a.url);
  const auth = take();
  assert.equal((await call(a.url, auth)).status, 200);
  await a.close();

  const b = await startOrigin(dataDir);
  try {
    const res = await call(b.url, auth);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'token_reused' });
    for (const f of readdirSync(join(dataDir, 'spent'))) {
      assert.match(f, /^[0-9a-f]{64}\.txt$/);
      for (const line of readFileSync(join(dataDir, 'spent', f), 'utf8').split('\n').filter(Boolean)) {
        assert.match(line, /^[0-9a-f]{64}$/, 'a nonce and nothing else');
      }
    }
  } finally {
    await b.close();
  }
});

test('an unreachable issuer directory is a 503, and nothing is served', async () => {
  const o = await startOrigin(tempDir(), 'http://127.0.0.1:9');
  try {
    const res = await call(o.url);
    assert.equal(res.status, 503);
    assert.equal(o.served.count, 0);
  } finally {
    await o.close();
  }
});

test('the origin source logs nothing, reads no client identity and knows no purchases', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), 'logs');
  assert.ok(!/remoteAddress|user-agent|x-forwarded-for/i.test(src), 'reads client identity');
  assert.ok(!/purchase/i.test(src), 'touches purchases');
  assert.ok(!/Date\.now\(\).*nonce|nonce.*Date\.now\(\)/.test(src), 'times a nonce');
});
