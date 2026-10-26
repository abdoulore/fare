// Fare origin middleware.
//
// No token: 402 with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` and a
// `Fare-Offer`. With a token, invariant 9 in order: key id, challenge digest, signature,
// spent set. Only then does the wrapped handler run.
//
// The origin learns issuer keys from the public directory only. It shares no table, id
// or log with the issuer (invariant 7), and never sees a purchase or a payment. It stores spent
// nonces per key and nothing else: no client address, no time (invariant 8).
//
// The spent set is one empty file per nonce, spent/<key id>/<nonce>, created with
// O_CREAT | O_EXCL. Creation is atomic, so any number of origin processes sharing the
// data directory on one host can redeem concurrently and a token still works once.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { AuthorizationHeader, publicVerif, WWWAuthenticateHeader, type Token } from '@cloudflare/privacypass-ts';

const { BlindRSAMode, BLIND_RSA, Origin, convertRSASSAPSSToEnc } = publicVerif;
const MODE = BlindRSAMode.PSS;
const DIRECTORY_PATH = '/.well-known/private-token-issuer-directory';

export type Refusal = 'token_reused' | 'bad_signature' | 'unknown_key' | 'wrong_challenge' | 'expired_epoch';

export interface OriginOptions {
  /** This origin's name, bound into every challenge. */
  originName: string;
  /** The issuer name clients see in the challenge. */
  issuerName: string;
  /** Where the issuer directory is fetched from. */
  issuerUrl: string;
  /** The issuer URL advertised to clients in Fare-Offer, when it differs from issuerUrl. */
  publicIssuerUrl?: string;
  /** Offer advertised on 402. */
  pack: number;
  priceZec: string;
  /** Directory for the spent-nonce store. */
  dataDir: string;
  /** Seconds between directory refreshes. */
  refreshSeconds?: number;
}

interface LiveKey {
  keyId: string;
  tokenKey: Uint8Array;
  cryptoKey: CryptoKey;
  notBefore: number;
}

export interface OriginStats {
  redeemed: number;
  refused: Record<Refusal, number>;
  challenged: number;
  /** Spent nonces per key id prefix. Counts only. */
  spentByKey: Record<string, number>;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const sha256hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const KEY_ID = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{64}$/;

export function createOrigin(opts: OriginOptions) {
  const origin = new Origin(MODE, [opts.originName]);
  const challenge = origin.createTokenChallenge(opts.issuerName, new Uint8Array(0));
  const challengeDigest = sha256hex(challenge.serialize());
  const spentDir = join(opts.dataDir, 'spent');
  const refreshMs = (opts.refreshSeconds ?? 300) * 1000;

  let live: LiveKey[] = [];
  let lastRefresh = 0;
  /** Key ids this origin has ever accepted. A token under one that left the directory is expired, not unknown. */
  const retired = new Set<string>();
  const stats: OriginStats = {
    redeemed: 0,
    challenged: 0,
    refused: { token_reused: 0, bad_signature: 0, unknown_key: 0, wrong_challenge: 0, expired_epoch: 0 },
    spentByKey: {},
  };

  /** Marks `nonce` spent under `keyId`. False when it already was, in this process or any other. */
  function markSpent(keyId: string, nonce: string): boolean {
    const dir = join(spentDir, keyId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      closeSync(openSync(join(dir, nonce), 'wx', 0o600));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  mkdirSync(spentDir, { recursive: true, mode: 0o700 });
  for (const f of readdirSync(spentDir)) {
    // Before Oct 26 the set was one append-only file per key, spent/<key id>.txt. Its
    // nonces are copied into the per-nonce layout (idempotent) and the file is kept.
    const legacy = f.match(/^([0-9a-f]{64})\.txt$/);
    if (legacy) {
      for (const nonce of readFileSync(join(spentDir, f), 'utf8').split('\n').filter((n) => NONCE.test(n))) markSpent(legacy[1], nonce);
      retired.add(legacy[1]);
    } else if (KEY_ID.test(f) && statSync(join(spentDir, f)).isDirectory()) {
      retired.add(f);
    }
  }

  async function refresh(force = false): Promise<void> {
    if (!force && Date.now() - lastRefresh < refreshMs && live.length > 0) return;
    const res = await fetch(`${opts.issuerUrl.replace(/\/+$/, '')}${DIRECTORY_PATH}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`issuer directory unavailable (${res.status})`);
    const dir = (await res.json()) as { 'token-keys'?: { 'token-type': number; 'token-key': string; 'not-before'?: number }[] };
    const next: LiveKey[] = [];
    for (const k of dir['token-keys'] ?? []) {
      if (k['token-type'] !== 2) continue;
      const tokenKey = new Uint8Array(Buffer.from(k['token-key'], 'base64url'));
      const cryptoKey = await crypto.subtle.importKey('spki', new Uint8Array(convertRSASSAPSSToEnc(tokenKey)), { name: 'RSA-PSS', hash: 'SHA-384' }, true, ['verify']);
      next.push({ keyId: sha256hex(tokenKey), tokenKey, cryptoKey, notBefore: k['not-before'] ?? 0 });
    }
    if (next.length === 0) throw new Error('issuer directory lists no type 2 key');
    for (const k of live) if (!next.some((n) => n.keyId === k.keyId)) retired.add(k.keyId);
    live = next.sort((a, b) => b.notBefore - a.notBefore);
    lastRefresh = Date.now();
  }

  /** The 402 headers: challenge under the newest key, and the offer. */
  async function challengeHeaders(): Promise<Record<string, string>> {
    await refresh();
    stats.challenged += 1;
    return {
      'www-authenticate': new WWWAuthenticateHeader(challenge, live[0].tokenKey).toString(),
      'fare-offer': JSON.stringify({ pack: opts.pack, price_zec: opts.priceZec, issuer: opts.publicIssuerUrl ?? opts.issuerUrl }),
      'cache-control': 'no-store',
    };
  }

  function refuse(reason: Refusal): { ok: false; reason: Refusal } {
    stats.refused[reason] += 1;
    return { ok: false, reason };
  }

  /** Invariant 9, in order. Marks the nonce spent only when everything else passed. */
  async function redeem(authorization: string): Promise<{ ok: true } | { ok: false; reason: Refusal }> {
    let token: Token;
    try {
      const parsed = AuthorizationHeader.parse(BLIND_RSA, authorization);
      if (parsed.length !== 1) return refuse('bad_signature');
      token = parsed[0].token;
    } catch {
      return refuse('bad_signature');
    }
    await refresh();
    const keyId = hex(token.authInput.tokenKeyId);
    let key = live.find((k) => k.keyId === keyId);
    if (!key && !retired.has(keyId)) {
      // Maybe the issuer rotated since the last refresh.
      await refresh(true).catch(() => undefined);
      key = live.find((k) => k.keyId === keyId);
    }
    if (!key) return refuse(retired.has(keyId) ? 'expired_epoch' : 'unknown_key');
    if (hex(token.authInput.challengeDigest) !== challengeDigest) return refuse('wrong_challenge');
    if (!(await origin.verify(token, key.cryptoKey))) return refuse('bad_signature');

    // One exclusive create: two requests with one token, in this process or another, cannot both pass.
    if (!markSpent(keyId, hex(token.authInput.nonce))) return refuse('token_reused');
    stats.redeemed += 1;
    return { ok: true };
  }

  /** Wraps a node:http handler: it runs only for a request carrying a valid, unspent token. */
  function protect(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        const auth = req.headers.authorization;
        if (!auth) {
          res.writeHead(402, { ...(await challengeHeaders()), 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'payment_required' }));
          return;
        }
        const verdict = await redeem(auth);
        if (!verdict.ok) {
          res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ error: verdict.reason }));
          return;
        }
        await handler(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'issuer_directory_unavailable' }));
        }
      }
    };
  }

  function snapshot(): OriginStats {
    const spentByKey: Record<string, number> = {};
    for (const k of readdirSync(spentDir)) {
      if (KEY_ID.test(k) && existsSync(join(spentDir, k)) && statSync(join(spentDir, k)).isDirectory()) spentByKey[k.slice(0, 16)] = readdirSync(join(spentDir, k)).length;
    }
    return { ...stats, refused: { ...stats.refused }, spentByKey };
  }

  /** The key id new challenges use, once the directory has been read. */
  const currentKeyId = (): string | undefined => live[0]?.keyId;

  return { protect, redeem, challengeHeaders, refresh, stats: snapshot, challengeDigest, currentKeyId };
}

