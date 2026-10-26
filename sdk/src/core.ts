// Fare client core: no Node imports, so it runs in a browser as well as in Node.
//
// 1. pin()      fetch the issuer directory once and pin its key (invariant 6).
// 2. fetch()    call an API; on 402, check the challenge against the pin before anything
//               else, spend a stored token, or buy a pack through a payer callback.
// 3. order()    blind a pack of nonces and order it; collect() polls until paid and
//               unblinds the signatures into tokens.
//
// Tokens are spent once: each is removed from the store, and the store persisted, before
// the request carrying it is sent, so a crash can lose a token but never reuse one.
//
// An order is saved, with what is needed to unblind its signatures, before order()
// returns and so before anyone pays it. A page closed or a process killed after paying
// can collect the tokens later from pendingPurchases().
//
// Every change to the state is one atomic read-modify-write on the store (StateStore),
// so two tabs or two clients on one store never overwrite each other's tokens.
//
// Blinding and unblinding happen here, on the client. Nothing in this file sends a nonce
// or a token anywhere but the origin.

import { AuthenticatorInput, AuthorizationHeader, publicVerif, Token, TokenChallenge, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

const { BlindRSAMode, BLIND_RSA, TokenRequest, TokenResponse, convertRSASSAPSSToEnc } = publicVerif;

export const DIRECTORY_PATH = '/.well-known/private-token-issuer-directory';
const MODE = BlindRSAMode.PSS;
const MAX_PACK = 1000;

/** The origin presented a key other than the pinned one: possibly a per-user key. */
export class UnpinnedKeyError extends Error {}
/** The origin presented a key other than the pinned one. */
export class KeyMismatch extends UnpinnedKeyError {
  readonly presented: string;
  constructor(presented: string) {
    super('origin presented a key other than the pinned one, refusing');
    this.presented = presented;
  }
}
/** The 402 challenge is not one Fare accepts. */
export class ChallengeError extends Error {}
/** No token for this origin and no payer to buy more. */
export class PaymentRequired extends Error {
  readonly offer: Offer | undefined;
  constructor(offer: Offer | undefined) {
    super('payment required: no token for this origin');
    this.offer = offer;
  }
}
export class PurchaseError extends Error {}

export interface Offer {
  pack: number;
  price_zec: string;
  issuer: string;
}

/** One token's blinding state: what unblinds its signature. Never sent anywhere. */
export interface Blind {
  /** The token input (type, nonce, challenge digest, key id), base64url. */
  input: string;
  /** The blinding inverse, base64url. */
  inv: string;
}

/** An order, saved in the client's state until its tokens are collected or it can never complete. */
export interface PendingPurchase {
  purchase_id: string;
  pay_uri: string;
  expires_at: string;
  /** Serialized challenge the tokens will redeem against. */
  challenge: string;
  /** The issuer key the requests were blinded to, base64url SPKI. */
  token_key: string;
  /** One per token, in request order. */
  blinds: Blind[];
}

/** One poll of the issuer: the status, and the signatures once paid. */
export interface PurchaseStatus {
  status: string;
  signatures?: string[];
  warning?: string;
  /** HTTP status of the poll. */
  code: number;
}

export type Payer = (payUri: string, offer: Offer) => Promise<void>;

export interface DirectoryKey {
  tokenKey: string;
  notBefore: number;
}

export interface StoredToken {
  challenge: string;
  token: string;
}

export interface SdkState {
  pinnedKey?: string;
  tokens: StoredToken[];
  /** Orders not yet collected. */
  pending?: PendingPurchase[];
}

/**
 * Where a client keeps its state. `update` must be atomic: read the current state, apply
 * `fn` (synchronous; it may mutate its argument), write the result, with nothing else
 * writing in between. A JSON file in Node, one IndexedDB transaction in a browser.
 */
export interface StateStore {
  read(): SdkState | Promise<SdkState>;
  update<T>(fn: (s: SdkState) => T): Updated<T> | Promise<Updated<T>>;
}

export interface Updated<T> {
  result: T;
  /** The state as written. */
  state: SdkState;
}

/** A state with every field present, from whatever a store held. */
export function normalize(s: Partial<SdkState> | undefined): SdkState {
  return {
    pinnedKey: s?.pinnedKey,
    tokens: Array.isArray(s?.tokens) ? s.tokens : [],
    pending: Array.isArray(s?.pending) ? s.pending : [],
  };
}

export interface CoreOptions {
  issuerUrl: string;
  pollMs?: number;
  timeoutMs?: number;
}

export function b64url(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256hex(b: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b))));
}

/** The token key id (SHA-256 of the issuer key) a stored token was issued under. */
export function tokenKeyId(token: string): string {
  return hex(Token.deserialize(BLIND_RSA, fromB64url(token)).authInput.tokenKeyId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const suite = BLIND_RSA.suite[MODE]();

/** The issuer key as a WebCrypto key; WebCrypto cannot import the RSASSA-PSS OID directly. */
function issuerCryptoKey(tokenKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', new Uint8Array(convertRSASSAPSSToEnc(tokenKey)), BLIND_RSA.rsaParams, true, ['verify']);
}

export function parseOffer(header: string | null): Offer | undefined {
  if (!header) return undefined;
  try {
    const o = JSON.parse(header) as Partial<Offer>;
    if (typeof o.pack === 'number' && typeof o.price_zec === 'string' && typeof o.issuer === 'string') {
      return { pack: o.pack, price_zec: o.price_zec, issuer: o.issuer };
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * The client over a StateStore. `state` is a cache of the store, refreshed by every change
 * and by refresh(); every decision that matters (which token to spend, whether a purchase
 * is still pending) is made inside an atomic update, never on the cache.
 */
export class FareCore {
  protected readonly issuerUrl: string;
  protected readonly pollMs: number;
  protected readonly timeoutMs: number;
  protected readonly store: StateStore;
  protected state: SdkState;

  constructor(opts: CoreOptions, store: StateStore, state: SdkState) {
    this.issuerUrl = opts.issuerUrl.replace(/\/+$/, '');
    this.pollMs = opts.pollMs ?? 5_000;
    this.timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    this.store = store;
    this.state = normalize(state);
  }

  /** Applies `fn` to the stored state atomically and caches the result. Sync when the store is. */
  protected change<T>(fn: (s: SdkState) => T): T | Promise<T> {
    const apply = (u: Updated<T>): T => {
      this.state = normalize(u.state);
      return u.result;
    };
    const out = this.store.update((s) => {
      const n = normalize(s);
      Object.assign(s, n);
      return fn(s);
    });
    return out instanceof Promise ? out.then(apply) : apply(out);
  }

  /** Re-reads the store: another tab or process may have changed it. */
  async refresh(): Promise<void> {
    this.state = normalize(await this.store.read());
  }

  /** A copy of the cached state, for display. */
  snapshot(): SdkState {
    return { pinnedKey: this.state.pinnedKey, tokens: [...this.state.tokens], pending: [...(this.state.pending ?? [])] };
  }

  /** Orders saved but not yet collected, oldest first. */
  pendingPurchases(): PendingPurchase[] {
    return [...(this.state.pending ?? [])];
  }

  get pinnedKey(): string | undefined {
    return this.state.pinnedKey;
  }

  /** Unspent tokens for a challenge, or all of them. */
  tokenCount(challenge?: string): number {
    return challenge ? this.state.tokens.filter((t) => t.challenge === challenge).length : this.state.tokens.length;
  }

  /** The issuer directory's type 2 keys, newest first. */
  async directory(): Promise<DirectoryKey[]> {
    const res = await fetch(`${this.issuerUrl}${DIRECTORY_PATH}`);
    if (!res.ok) throw new PurchaseError(`issuer directory unavailable (${res.status})`);
    const dir = (await res.json()) as { 'token-keys'?: { 'token-type': number; 'token-key': string; 'not-before'?: number }[] };
    const keys = (dir['token-keys'] ?? [])
      .filter((k) => k['token-type'] === 2 && typeof k['token-key'] === 'string')
      .map((k) => ({ tokenKey: k['token-key'], notBefore: k['not-before'] ?? 0 }));
    if (keys.length === 0) throw new PurchaseError('issuer directory lists no type 2 key');
    return keys;
  }

  private async directoryKeys(): Promise<string[]> {
    return (await this.directory()).map((k) => k.tokenKey);
  }

  /** Pins `key` and drops stored tokens under keys the directory no longer lists. */
  private async adopt(directory: string[], key: string): Promise<void> {
    const liveIds = new Set(await Promise.all(directory.map((k) => sha256hex(fromB64url(k)))));
    await this.change((s) => {
      s.pinnedKey = key;
      s.tokens = s.tokens.filter((t) => liveIds.has(tokenKeyId(t.token)));
    });
  }

  /**
   * Pins the issuer's key: the newest directory key when nothing is pinned, or when the
   * directory no longer lists the pinned one (the issuer rotated). Tokens under keys
   * that left the directory are dropped: the origin would refuse them.
   */
  async pin(): Promise<string> {
    await this.refresh();
    const keys = await this.directoryKeys();
    if (this.state.pinnedKey && keys.includes(this.state.pinnedKey)) return this.state.pinnedKey;
    await this.adopt(keys, keys[0]);
    return keys[0];
  }

  /**
   * checkChallenge, following a rotation: when the origin presents a key other than the
   * pinned one, the issuer directory is read again and the key is accepted only if the
   * directory lists it. Any other key aborts (invariant 6).
   */
  async acceptChallenge(header: string | null): Promise<WWWAuthenticateHeader> {
    try {
      return this.checkChallenge(header);
    } catch (e) {
      if (!(e instanceof KeyMismatch)) throw e;
      const keys = await this.directoryKeys();
      if (!keys.includes(e.presented)) {
        throw new UnpinnedKeyError('origin presented a key the issuer directory does not list, refusing');
      }
      await this.adopt(keys, e.presented);
      return this.checkChallenge(header);
    }
  }

  /** Parses a 402's WWW-Authenticate and checks it against the pin. Throws before any order. */
  checkChallenge(header: string | null): WWWAuthenticateHeader {
    if (!header) throw new ChallengeError('402 without a WWW-Authenticate challenge');
    let parsed: WWWAuthenticateHeader[];
    try {
      parsed = WWWAuthenticateHeader.parse(header);
    } catch {
      throw new ChallengeError('malformed PrivateToken challenge');
    }
    const ours = parsed.filter((c) => c.challenge.tokenType === BLIND_RSA.value);
    if (ours.length !== 1) throw new ChallengeError('expected exactly one type 2 challenge');
    const c = ours[0];
    if (c.challenge.redemptionContext.length !== 0) throw new ChallengeError('challenge must use an empty redemption context');
    if (!this.state.pinnedKey) throw new UnpinnedKeyError('no issuer key pinned yet, call pin() first');
    if (b64url(c.tokenKey) !== this.state.pinnedKey) throw new KeyMismatch(b64url(c.tokenKey));
    return c;
  }

  /**
   * Blinds `offer.pack` nonces for `challenge`, orders them, and saves the order with its
   * blinding state before returning, so it survives a closed page once paid.
   * `onBlind(done, total)` reports progress, so a page can show it.
   */
  async order(challenge: WWWAuthenticateHeader, offer: Offer, onBlind?: (done: number, total: number) => void): Promise<PendingPurchase> {
    if (!Number.isInteger(offer.pack) || offer.pack < 1 || offer.pack > MAX_PACK) throw new PurchaseError('offer has an invalid pack size');
    const pk = await issuerCryptoKey(challenge.tokenKey);
    const keyId = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(challenge.tokenKey)));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(challenge.challenge.serialize())));
    const blinds: Blind[] = [];
    const blinded: string[] = [];
    for (let i = 0; i < offer.pack; i++) {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const input = new AuthenticatorInput(BLIND_RSA, BLIND_RSA.value, nonce, digest, keyId).serialize();
      const { blindedMsg, inv } = await suite.blind(pk, input);
      blinds.push({ input: b64url(input), inv: b64url(inv) });
      blinded.push(b64url(new TokenRequest(keyId[keyId.length - 1], blindedMsg, BLIND_RSA).serialize()));
      onBlind?.(i + 1, offer.pack);
    }
    const res = await fetch(`${this.issuerUrl}/fare/purchases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack: offer.pack, blinded }),
    });
    const body = (await res.json().catch(() => ({}))) as { purchase_id?: string; pay_uri?: string; expires_at?: string; error?: string };
    if (res.status !== 201 || !body.purchase_id || !body.pay_uri || !body.expires_at) {
      throw new PurchaseError(`issuer refused the order: ${body.error ?? res.status}`);
    }
    const purchase: PendingPurchase = {
      purchase_id: body.purchase_id,
      pay_uri: body.pay_uri,
      expires_at: body.expires_at,
      challenge: b64url(challenge.challenge.serialize()),
      token_key: b64url(challenge.tokenKey),
      blinds,
    };
    await this.change((s) => {
      s.pending = [...(s.pending ?? []).filter((p) => p.purchase_id !== purchase.purchase_id), purchase];
    });
    return purchase;
  }

  /** Forgets a saved order, for one that can never complete. */
  async drop(p: PendingPurchase): Promise<void> {
    await this.change((s) => {
      s.pending = (s.pending ?? []).filter((x) => x.purchase_id !== p.purchase_id);
    });
  }

  /** One poll of the issuer for `p`. */
  async poll(p: PendingPurchase): Promise<PurchaseStatus> {
    const res = await fetch(`${this.issuerUrl}/fare/purchases/${p.purchase_id}`);
    const body = (await res.json().catch(() => ({}))) as { status?: string; signatures?: string[]; warning?: string; error?: string };
    return { status: body.status ?? body.error ?? `http_${res.status}`, signatures: body.signatures, warning: body.warning, code: res.status };
  }

  /** True when a poll result means the purchase can never complete. */
  static final(s: PurchaseStatus): boolean {
    return s.status === 'expired' || s.status === 'key_retired' || s.code === 404 || s.code === 400;
  }

  /**
   * Unblinds a paid poll's signatures and stores the tokens, removing the saved order in the
   * same update. Returns how many were stored: 0 when another tab or client sharing the
   * store already collected this purchase.
   */
  async finish(p: PendingPurchase, s: PurchaseStatus): Promise<number> {
    if (!Array.isArray(s.signatures) || s.signatures.length !== p.blinds.length) {
      throw new PurchaseError('issuer returned the wrong number of signatures');
    }
    const pk = await issuerCryptoKey(fromB64url(p.token_key));
    const tokens: StoredToken[] = [];
    for (let i = 0; i < p.blinds.length; i++) {
      const input = fromB64url(p.blinds[i].input);
      const blindSig = new TokenResponse(fromB64url(s.signatures[i])).blindSig;
      // finalize verifies each signature against the issuer key before it becomes a token.
      const authenticator = await suite.finalize(pk, input, blindSig, fromB64url(p.blinds[i].inv));
      const token = new Token(BLIND_RSA, AuthenticatorInput.deserialize(BLIND_RSA, input, { bytesRead: 0 }), authenticator);
      tokens.push({ challenge: p.challenge, token: b64url(token.serialize()) });
    }
    return this.change((st) => {
      const pending = st.pending ?? [];
      if (!pending.some((x) => x.purchase_id === p.purchase_id)) return 0;
      st.pending = pending.filter((x) => x.purchase_id !== p.purchase_id);
      st.tokens.push(...tokens);
      return tokens.length;
    });
  }

  /** Polls until paid, unblinds every signature and stores the tokens. Returns how many. */
  async collect(p: PendingPurchase): Promise<number> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const s = await this.poll(p);
      if (s.status === 'paid') return this.finish(p, s);
      if (FareCore.final(s)) {
        await this.drop(p);
        throw new PurchaseError(`purchase cannot complete: ${s.status}`);
      }
      if (Date.now() >= deadline) throw new PurchaseError('timed out waiting for payment');
      await sleep(this.pollMs);
    }
  }

  /**
   * Removes one token for `challenge` from the store, in one atomic update, and returns its
   * Authorization header once the removal is written. Two tabs never get the same token.
   */
  spend(challenge: WWWAuthenticateHeader): string | undefined | Promise<string | undefined> {
    const key = b64url(challenge.challenge.serialize());
    const taken = this.change((s) => {
      const i = s.tokens.findIndex((t) => t.challenge === key);
      return i < 0 ? undefined : s.tokens.splice(i, 1)[0];
    });
    const header = (t: StoredToken | undefined) => (t ? new AuthorizationHeader(Token.deserialize(BLIND_RSA, fromB64url(t.token))).toString() : undefined);
    return taken instanceof Promise ? taken.then(header) : header(taken);
  }

  /** Drops every stored token and the pin. Saved orders stay: one may be paid already. */
  async forget(): Promise<void> {
    await this.change((s) => {
      s.tokens = [];
      s.pinnedKey = undefined;
    });
  }

  /**
   * fetch() with Fare: on 402, checks the challenge against the pin, spends a token, or
   * buys a pack through `payer` and then spends one. Without a payer, throws
   * PaymentRequired carrying the origin's offer.
   */
  async fetch(url: string, init: RequestInit = {}, payer?: Payer): Promise<Response> {
    const first = await fetch(url, init);
    if (first.status !== 402) return first;
    const challenge = await this.acceptChallenge(first.headers.get('www-authenticate'));
    const offer = parseOffer(first.headers.get('fare-offer'));
    let auth = await this.spend(challenge);
    if (!auth) {
      if (!payer || !offer) throw new PaymentRequired(offer);
      const purchase = await this.order(challenge, offer);
      await payer(purchase.pay_uri, offer);
      await this.collect(purchase);
      auth = await this.spend(challenge);
      if (!auth) throw new PurchaseError('no token after a completed purchase');
    }
    const headers = new Headers(init.headers);
    headers.set('authorization', auth);
    return fetch(url, { ...init, headers });
  }
}

/** A store holding the state in memory, calling `onSave` with each new state before the update resolves. */
export function memoryStateStore(initial: SdkState = { tokens: [] }, onSave?: (s: SdkState) => void | Promise<void>): StateStore {
  let current = normalize(structuredClone(initial));
  // Updates queue behind one another, so each sees the last one's result.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read: () => structuredClone(current),
    update<T>(fn: (s: SdkState) => T): Promise<Updated<T>> {
      const run = queue.then(async () => {
        const next = structuredClone(current);
        const result = fn(next);
        await onSave?.(structuredClone(next));
        current = next;
        return { result, state: structuredClone(next) };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** A client whose state lives only in memory, and in whatever `onSave` writes. */
export class MemoryFareClient extends FareCore {
  constructor(opts: CoreOptions, state: SdkState = { tokens: [] }, onSave?: (s: SdkState) => void | Promise<void>) {
    super(opts, memoryStateStore(state, onSave), state);
  }
}

export { TokenChallenge, WWWAuthenticateHeader };
