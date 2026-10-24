import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { AuthorizationHeader, publicVerif, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

import { ChallengeError, FareClient, PaymentRequired, PurchaseError, UnpinnedKeyError } from '../src/index.ts';
import { startIssuer, stubScanner, tempDir, type StubScanner, type TestIssuer } from '../../issuer/test/helpers.ts';

const { BlindRSAMode, BLIND_RSA, Origin } = publicVerif;
const MODE = BlindRSAMode.PSS;
const ISSUER_NAME = 'issuer.fare.test';
const ORIGIN_NAME = 'api.fare.test';
const PACK = 100;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();

/** A test origin: 402 with a challenge for `tokenKey`, then redeem with the invariant 9 checks. */
async function testOrigin(tokenKey: Uint8Array, verifyKey: CryptoKey, redemptionContext = new Uint8Array(0)) {
  const origin = new Origin(MODE, [ORIGIN_NAME]);
  const challenge = origin.createTokenChallenge(ISSUER_NAME, redemptionContext);
  const digest = hex(sha256(challenge.serialize()));
  const keyId = hex(sha256(tokenKey));
  const spent = new Set<string>();
  const served = { count: 0 };
  const server: Server = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth) {
      res.writeHead(402, {
        'www-authenticate': new WWWAuthenticateHeader(challenge, tokenKey).toString(),
        'fare-offer': JSON.stringify({ pack: PACK, price_zec: '0.001', issuer: 'http://issuer' }),
      });
      res.end();
      return;
    }
    const token = AuthorizationHeader.parse(BLIND_RSA, auth)[0].token;
    let reason = '';
    if (hex(token.authInput.tokenKeyId) !== keyId) reason = 'unknown_key';
    else if (hex(token.authInput.challengeDigest) !== digest) reason = 'wrong_challenge';
    else if (!(await origin.verify(token, verifyKey))) reason = 'bad_signature';
    else if (spent.has(hex(token.authInput.nonce))) reason = 'token_reused';
    if (reason) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: reason }));
      return;
    }
    spent.add(hex(token.authInput.nonce));
    served.count += 1;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"answer":42}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`;
  const close = () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
  return { url, served, spent, close };
}

let scanner: StubScanner;
let issuer: TestIssuer;
let tokenKey: Uint8Array;
let verifyKey: CryptoKey;

/** Pays by marking every purchase the stub knows as paid. */
const payer = async () => {
  for (const id of scanner.statuses.keys()) scanner.statuses.set(id, { status: 'paid' });
};

const client = (stateFile = join(tempDir(), 'sdk.json')) => new FareClient({ issuerUrl: issuer.url, stateFile, pollMs: 10, timeoutMs: 2_000 });

before(async () => {
  scanner = await stubScanner();
  issuer = await startIssuer(scanner.url);
  const key = await issuer.issuer.keys.current(issuer.clock.now);
  tokenKey = key.tokenKey;
  verifyKey = await crypto.subtle.importKey('spki', key.pub.export({ type: 'spki', format: 'der' }), { name: 'RSA-PSS', hash: 'SHA-384' }, true, ['verify']);
});

after(async () => {
  await issuer.close();
  await scanner.close();
});

beforeEach(() => {
  scanner.down = false;
});

test('full flow: pin, 402, order, pay, collect, then one token per call', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    const sdk = client();
    assert.equal(await sdk.pin(), Buffer.from(tokenKey).toString('base64url'));
    const mintsBefore = scanner.mints;

    const first = await sdk.fetch(origin.url, {}, payer);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { answer: 42 });
    assert.equal(scanner.mints, mintsBefore + 1, 'one purchase');
    assert.equal(sdk.tokenCount(), PACK - 1);

    for (let i = 0; i < 5; i++) assert.equal((await sdk.fetch(origin.url)).status, 200);
    assert.equal(sdk.tokenCount(), PACK - 6);
    assert.equal(origin.served.count, 6);
    assert.equal(scanner.mints, mintsBefore + 1, 'calls spend tokens, they do not buy');
  } finally {
    await origin.close();
  }
});

test('aborts before ordering when the origin presents an unpinned key', async () => {
  const stranger = await startIssuer(scanner.url);
  const strangerKey = (await stranger.issuer.keys.current(stranger.clock.now)).tokenKey;
  await stranger.close();
  const origin = await testOrigin(strangerKey, verifyKey);
  try {
    const sdk = client();
    await sdk.pin();
    const mintsBefore = scanner.mints;
    await assert.rejects(sdk.fetch(origin.url, {}, payer), UnpinnedKeyError);
    assert.equal(scanner.mints, mintsBefore, 'nothing was ordered');
    assert.equal(sdk.tokenCount(), 0);
  } finally {
    await origin.close();
  }
});

test('refuses to act on a 402 before a key is pinned', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    await assert.rejects(client().fetch(origin.url, {}, payer), UnpinnedKeyError);
  } finally {
    await origin.close();
  }
});

test('a pin the directory no longer lists is refused', async () => {
  const stateFile = join(tempDir(), 'sdk.json');
  const sdk = client(stateFile);
  await sdk.pin();
  const other = await startIssuer(scanner.url);
  try {
    const moved = new FareClient({ issuerUrl: other.url, stateFile, pollMs: 10 });
    await assert.rejects(moved.pin(), UnpinnedKeyError);
  } finally {
    await other.close();
  }
});

test('refuses a challenge with a redemption context', async () => {
  const origin = await testOrigin(tokenKey, verifyKey, new Uint8Array(32).fill(7));
  try {
    const sdk = client();
    await sdk.pin();
    await assert.rejects(sdk.fetch(origin.url, {}, payer), ChallengeError);
  } finally {
    await origin.close();
  }
});

test('without a payer, a 402 is PaymentRequired with the offer and nothing is ordered', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    const sdk = client();
    await sdk.pin();
    const mintsBefore = scanner.mints;
    await assert.rejects(sdk.fetch(origin.url), (e: unknown) => e instanceof PaymentRequired && e.offer?.pack === PACK);
    assert.equal(scanner.mints, mintsBefore);
  } finally {
    await origin.close();
  }
});

test('tokens persist across restarts, the state file is private, and a spent token is gone first', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  const stateFile = join(tempDir(), 'sdk.json');
  try {
    const a = client(stateFile);
    await a.pin();
    assert.equal((await a.fetch(origin.url, {}, payer)).status, 200);
    assert.equal(statSync(stateFile).mode & 0o777, 0o600);

    const b = client(stateFile);
    assert.equal(b.tokenCount(), PACK - 1);
    const res = await b.fetch(origin.url);
    assert.equal(res.status, 200);
    assert.equal(client(stateFile).tokenCount(), PACK - 2, 'removed from disk before use');
  } finally {
    await origin.close();
  }
});

test('a replayed token is refused by the origin', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    const sdk = client();
    await sdk.pin();
    assert.equal((await sdk.fetch(origin.url, {}, payer)).status, 200);
    // Take a token, use it twice by hand.
    const challengeRes = await fetch(origin.url);
    const challenge = sdk.checkChallenge(challengeRes.headers.get('www-authenticate'));
    const auth = sdk.spend(challenge)!;
    assert.equal((await fetch(origin.url, { headers: { authorization: auth } })).status, 200);
    const replay = await fetch(origin.url, { headers: { authorization: auth } });
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), { error: 'token_reused' });
  } finally {
    await origin.close();
  }
});

test('collect stops on an expired purchase and stores nothing', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  const t0 = issuer.clock.now;
  try {
    const sdk = client();
    await sdk.pin();
    const res = await fetch(origin.url);
    const challenge = sdk.checkChallenge(res.headers.get('www-authenticate'));
    const purchase = await sdk.order(challenge, { pack: PACK, price_zec: '0.001', issuer: issuer.url });
    issuer.clock.now = t0 + 24 * 3600;
    await assert.rejects(sdk.collect(purchase), PurchaseError);
    assert.equal(sdk.tokenCount(), 0);
  } finally {
    issuer.clock.now = t0;
    await origin.close();
  }
});

test('collect times out when nobody pays', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    const sdk = new FareClient({ issuerUrl: issuer.url, stateFile: join(tempDir(), 's.json'), pollMs: 10, timeoutMs: 100 });
    await sdk.pin();
    const challenge = sdk.checkChallenge((await fetch(origin.url)).headers.get('www-authenticate'));
    const purchase = await sdk.order(challenge, { pack: PACK, price_zec: '0.001', issuer: issuer.url });
    await assert.rejects(sdk.collect(purchase), /timed out/);
  } finally {
    await origin.close();
  }
});

test('an order the issuer refuses surfaces its reason', async () => {
  const origin = await testOrigin(tokenKey, verifyKey);
  try {
    const sdk = client();
    await sdk.pin();
    const challenge = sdk.checkChallenge((await fetch(origin.url)).headers.get('www-authenticate'));
    await assert.rejects(sdk.order(challenge, { pack: 99, price_zec: '0.001', issuer: issuer.url }), /wrong_pack/);
  } finally {
    await origin.close();
  }
});
