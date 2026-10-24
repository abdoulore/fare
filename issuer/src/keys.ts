// Issuer keys, one per 7-day epoch (invariant 6: never per user or per purchase).
// The previous epoch's key stays valid for a 24 h grace window after rotation.

import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { publicVerif } from '@cloudflare/privacypass-ts';

import { EPOCH_SECONDS, GRACE_SECONDS } from './config.ts';
import type { SigningKey } from './sign.ts';

const { BlindRSAMode, Issuer, getPublicKeyBytes } = publicVerif;
const RSA = { modulusLength: 2048, publicExponent: Uint8Array.from([1, 0, 1]) };

export interface EpochKey extends SigningKey {
  readonly epoch: number;
  /** Unix seconds the key starts being used. */
  readonly notBefore: number;
  /** Unix seconds after which nothing is signed with it. */
  readonly retiresAt: number;
  /** RSASSA-PSS SPKI bytes, as published in the directory and pinned by clients. */
  readonly tokenKey: Uint8Array;
  /** SHA-256 of tokenKey. */
  readonly keyId: Uint8Array;
  /** Last byte of keyId, carried in every TokenRequest. */
  readonly truncatedKeyId: number;
}

export function epochOf(nowSec: number): number {
  return Math.floor(nowSec / EPOCH_SECONDS);
}

export function epochStart(epoch: number): number {
  return epoch * EPOCH_SECONDS;
}

interface StoredKey {
  epoch: number;
  pkcs8: string;
  tokenKey: string;
}

function build(epoch: number, priv: KeyObject, tokenKey: Uint8Array): EpochKey {
  const keyId = new Uint8Array(createHash('sha256').update(tokenKey).digest());
  const notBefore = epochStart(epoch);
  return {
    epoch,
    priv,
    pub: createPublicKey(priv),
    notBefore,
    retiresAt: notBefore + EPOCH_SECONDS + GRACE_SECONDS,
    tokenKey,
    keyId,
    truncatedKeyId: keyId[keyId.length - 1],
  };
}

export class KeyRing {
  private readonly dir: string;
  private readonly keys = new Map<number, EpochKey>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'keys');
  }

  private path(epoch: number): string {
    return join(this.dir, `${epoch}.json`);
  }

  private load(epoch: number): EpochKey | undefined {
    const cached = this.keys.get(epoch);
    if (cached) return cached;
    if (!existsSync(this.path(epoch))) return undefined;
    const stored = JSON.parse(readFileSync(this.path(epoch), 'utf8')) as StoredKey;
    const priv = createPrivateKey({ key: Buffer.from(stored.pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
    const key = build(epoch, priv, new Uint8Array(Buffer.from(stored.tokenKey, 'base64')));
    this.keys.set(epoch, key);
    return key;
  }

  private async generate(epoch: number): Promise<EpochKey> {
    const previous = this.load(epoch - 1);
    // Requests name their key by one byte. Avoid two live keys sharing it.
    for (;;) {
      const pair = await Issuer.generateKey(BlindRSAMode.PSS, RSA);
      const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      const tokenKey = await getPublicKeyBytes(pair.publicKey);
      const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      const key = build(epoch, priv, tokenKey);
      if (previous && previous.truncatedKeyId === key.truncatedKeyId) continue;
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const stored: StoredKey = { epoch, pkcs8: pkcs8.toString('base64'), tokenKey: Buffer.from(tokenKey).toString('base64') };
      const tmp = `${this.path(epoch)}.tmp`;
      writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
      renameSync(tmp, this.path(epoch));
      this.keys.set(epoch, key);
      return key;
    }
  }

  /** The current epoch's key, created on first use. */
  async current(nowSec: number): Promise<EpochKey> {
    const epoch = epochOf(nowSec);
    return this.load(epoch) ?? (await this.generate(epoch));
  }

  /** Keys clients may hold right now: the current one, plus the previous one during grace. */
  async live(nowSec: number): Promise<EpochKey[]> {
    const current = await this.current(nowSec);
    const previous = this.load(current.epoch - 1);
    return previous && nowSec < previous.retiresAt ? [current, previous] : [current];
  }

  /** The key a stored purchase was blinded under, if it may still sign. */
  signable(epoch: number, nowSec: number): EpochKey | undefined {
    const key = this.load(epoch);
    return key && nowSec >= key.notBefore && nowSec < key.retiresAt ? key : undefined;
  }
}
