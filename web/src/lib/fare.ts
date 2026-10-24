// The browser's Fare client: the SDK core with its state in IndexedDB. Blinding and
// unblinding happen here; the issuer sees only blinded requests, the API only tokens.

import { MemoryFareClient, sha256hex, fromB64url, tokenKeyId, type DirectoryKey } from '../../../sdk/src/core.ts';
import { publicVerif, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

import { EPOCH_SECONDS, GRACE_SECONDS, ISSUER_URL } from './config.ts';
import { idbStore, memoryStore, type TokenStore } from './store.ts';

export { MemoryFareClient };

export async function openStore(): Promise<{ store: TokenStore; persistent: boolean }> {
  try {
    const store = idbStore();
    await store.load();
    return { store, persistent: true };
  } catch {
    return { store: memoryStore(), persistent: false };
  }
}

export async function createClient(store: TokenStore, issuerUrl = ISSUER_URL): Promise<MemoryFareClient> {
  const state = await store.load();
  return new MemoryFareClient({ issuerUrl, pollMs: 5_000 }, state, (s) => store.save(s));
}

export async function keyIdOf(tokenKey: string): Promise<string> {
  return sha256hex(fromB64url(tokenKey));
}

/** When a key stops being accepted: its epoch end plus the grace window. */
export function retiresAt(key: DirectoryKey): number {
  return key.notBefore + EPOCH_SECONDS + GRACE_SECONDS;
}

export interface TokenGroup {
  keyId: string;
  count: number;
  /** Unix seconds, or undefined when the directory no longer lists the key. */
  retiresAt?: number;
}

/** Unspent tokens grouped by the key they were issued under, with each key's retirement. */
export async function groupTokens(tokens: { token: string }[], directory: DirectoryKey[]): Promise<TokenGroup[]> {
  const ids = new Map<string, number>();
  for (const k of directory) ids.set(await keyIdOf(k.tokenKey), retiresAt(k));
  const groups = new Map<string, number>();
  for (const t of tokens) {
    const id = tokenKeyId(t.token);
    groups.set(id, (groups.get(id) ?? 0) + 1);
  }
  return [...groups].map(([keyId, count]) => ({ keyId, count, retiresAt: ids.get(keyId) }));
}

/**
 * A challenge header like `header` but naming a freshly generated key: what a malicious
 * API handing one visitor their own key would send. The client must refuse it.
 */
export async function swapChallengeKey(header: string): Promise<string> {
  const [parsed] = WWWAuthenticateHeader.parse(header);
  const pair = await publicVerif.Issuer.generateKey(publicVerif.BlindRSAMode.PSS, {
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  });
  const bytes = await publicVerif.getPublicKeyBytes(pair.publicKey);
  return new WWWAuthenticateHeader(parsed.challenge, bytes).toString();
}
