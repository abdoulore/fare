// The browser client against the real issuer and origin, with a stub scanner.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { UnpinnedKeyError } from '../../sdk/src/core.ts';
import { createOrigin } from '../../origin/src/index.ts';
import { startIssuer, stubScanner, tempDir, type StubScanner, type TestIssuer } from '../../issuer/test/helpers.ts';
import { createClient, groupTokens, retiresAt, swapChallengeKey } from '../src/lib/fare.ts';
import { idbStore, memoryStore } from '../src/lib/store.ts';
import { EPOCH_SECONDS, GRACE_SECONDS } from '../src/lib/config.ts';

let scanner: StubScanner;
let issuer: TestIssuer;
let api: { url: string; close(): Promise<void> };

beforeAll(async () => {
  scanner = await stubScanner();
  issuer = await startIssuer(scanner.url);
  const origin = createOrigin({ originName: 'api.fare.test', issuerName: 'issuer.fare.test', issuerUrl: issuer.url, pack: 100, priceZec: '0.001', dataDir: tempDir() });
  const server = createServer((req, res) => void origin.protect((_q, r) => void r.writeHead(200).end('{"answer":"ok"}'))(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  api = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}, 30_000);

afterAll(async () => {
  await api.close();
  await issuer.close();
  await scanner.close();
});

const challengeHeader = async () => (await fetch(api.url)).headers.get('www-authenticate')!;

describe('key pinning', () => {
  test('accepts the key the directory lists', async () => {
    const c = await createClient(memoryStore(), issuer.url);
    const pinned = await c.pin();
    const challenge = await c.acceptChallenge(await challengeHeader());
    expect(c.pinnedKey).toBe(pinned);
    expect(challenge.challenge.redemptionContext.length).toBe(0);
  });

  test('refuses a swapped challenge key before ordering anything', async () => {
    const c = await createClient(memoryStore(), issuer.url);
    await c.pin();
    const mints = scanner.mints;
    const swapped = await swapChallengeKey(await challengeHeader());
    expect(swapped).not.toBe(await challengeHeader());
    await expect(c.acceptChallenge(swapped)).rejects.toBeInstanceOf(UnpinnedKeyError);
    expect(scanner.mints).toBe(mints);
  }, 30_000);
});

describe('token storage and spending', () => {
  test('IndexedDB keeps the pin and tokens; a spend is saved before it is handed out', async () => {
    const store = idbStore();
    const c = await createClient(store, issuer.url);
    await c.pin();
    const challenge = await c.acceptChallenge(await challengeHeader());
    let progress = 0;
    const p = await c.order(challenge, { pack: 100, price_zec: '0.001', issuer: issuer.url }, (d) => (progress = d));
    expect(progress).toBe(100);

    const pending = await c.poll(p);
    expect(pending.status).toBe('pending');
    scanner.statuses.set(p.purchase_id, { status: 'paid' });
    const paid = await c.poll(p);
    expect(await c.finish(p, paid)).toBe(100);
    expect((await store.read()).tokens.length).toBe(100);

    const auth = await c.spend(challenge);
    expect(auth).toMatch(/^PrivateToken token=/);
    expect((await store.read()).tokens.length, 'persisted before spend() resolved').toBe(99);

    const ok = await fetch(api.url, { headers: { authorization: auth! } });
    expect(ok.status).toBe(200);
    const replay = await fetch(api.url, { headers: { authorization: auth! } });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: 'token_reused' });

    // A reload sees the same tokens and pin.
    const again = await createClient(store, issuer.url);
    expect(again.tokenCount()).toBe(99);
    expect(again.pinnedKey).toBe(c.pinnedKey);

    // Grouped by key, with the key's retirement.
    const dir = await c.directory();
    const groups = await groupTokens(again.snapshot().tokens, dir);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(99);
    expect(groups[0].retiresAt).toBe(dir[0].notBefore + EPOCH_SECONDS + GRACE_SECONDS);
    expect(retiresAt(dir[0])).toBe(groups[0].retiresAt);

    // Forget my tokens.
    await again.forget();
    expect((await store.read()).tokens).toEqual([]);
    expect((await createClient(store, issuer.url)).tokenCount()).toBe(0);
  }, 60_000);

  test('an order is in IndexedDB before it is paid, and a reload collects it', async () => {
    const store = idbStore();
    const c = await createClient(store, issuer.url);
    await c.pin();
    const challenge = await c.acceptChallenge(await challengeHeader());
    const p = await c.order(challenge, { pack: 100, price_zec: '0.001', issuer: issuer.url });
    expect((await store.read()).pending?.map((x) => x.purchase_id)).toContain(p.purchase_id);
    scanner.statuses.set(p.purchase_id, { status: 'paid' });

    // The tab closed after paying. A new page load finds the order and collects it.
    const reloaded = await createClient(store, issuer.url);
    const saved = reloaded.pendingPurchases().find((x) => x.purchase_id === p.purchase_id)!;
    const before = reloaded.tokenCount();
    expect(await reloaded.finish(saved, await reloaded.poll(saved))).toBe(100);
    expect(reloaded.tokenCount()).toBe(before + 100);
    expect(reloaded.pendingPurchases().some((x) => x.purchase_id === p.purchase_id)).toBe(false);
    const auth = await reloaded.spend(challenge);
    expect((await fetch(api.url, { headers: { authorization: auth! } })).status).toBe(200);
  }, 60_000);

  test('two tabs on one IndexedDB never spend the same token, and each hears the other change', async () => {
    const store = idbStore();
    const a = await createClient(store, issuer.url);
    await a.forget();
    await a.pin();
    const challenge = await a.acceptChallenge(await challengeHeader());
    const p = await a.order(challenge, { pack: 100, price_zec: '0.001', issuer: issuer.url });
    scanner.statuses.set(p.purchase_id, { status: 'paid' });
    const b = await createClient(idbStore(), issuer.url);
    const heard = new Promise<void>((resolve) => {
      const stop = store.onChange(() => {
        stop();
        resolve();
      });
    });
    // Both tabs collect the same order: the tokens are stored once.
    const both = await Promise.all([a.finish(p, await a.poll(p)), b.finish(p, await b.poll(p))]);
    expect([...both].sort((x, y) => x - y)).toEqual([0, 100]);
    await heard;

    const spends = await Promise.all(Array.from({ length: 120 }, (_, i) => (i % 2 ? a : b).spend(challenge)));
    const got = spends.filter((x): x is string => typeof x === 'string');
    expect(got).toHaveLength(100);
    expect(new Set(got).size, 'no token handed out twice').toBe(100);
    await b.refresh();
    expect(b.tokenCount()).toBe(0);
  }, 60_000);

  test('an underpaid purchase never yields signatures', async () => {
    const c = await createClient(memoryStore(), issuer.url);
    await c.pin();
    const challenge = await c.acceptChallenge(await challengeHeader());
    const p = await c.order(challenge, { pack: 100, price_zec: '0.001', issuer: issuer.url });
    scanner.statuses.set(p.purchase_id, { status: 'underpaid' });
    const s = await c.poll(p);
    expect(s.status).toBe('underpaid');
    expect(s.signatures).toBeUndefined();
    await expect(c.finish(p, s)).rejects.toThrow(/wrong number of signatures/);
    expect(c.tokenCount()).toBe(0);
  }, 60_000);
});
