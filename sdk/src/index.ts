// Fare client SDK.
//
// 1. pin()      fetch the issuer directory once and pin its key (invariant 6).
// 2. fetch()    call an API; on 402, check the challenge against the pin before anything
//               else, spend a stored token, or buy a pack through a payer callback.
// 3. order()    blind a pack of nonces and order it; collect() polls until paid and
//               unblinds the signatures into tokens.
//
// Tokens are spent once: each is removed from the store before the request carrying it
// is sent, so a crash can lose a token but never reuse one.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { AuthorizationHeader, publicVerif, Token, TokenChallenge, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

const { BlindRSAMode, BLIND_RSA, Client, TokenResponse } = publicVerif;
type BlindClient = InstanceType<typeof Client>;

export const DIRECTORY_PATH = '/.well-known/private-token-issuer-directory';
const MODE = BlindRSAMode.PSS;
const MAX_PACK = 1000;

/** The origin presented a key other than the pinned one: possibly a per-user key. */
export class UnpinnedKeyError extends Error {}
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

export interface PendingPurchase {
  purchase_id: string;
  pay_uri: string;
  expires_at: string;
  /** Serialized challenge the tokens will redeem against. */
  challenge: string;
  /** Blinding state, one client per token. Lives only in this process. */
  clients: BlindClient[];
}

export type Payer = (payUri: string, offer: Offer) => Promise<void>;

export interface FareOptions {
  issuerUrl: string;
  /** JSON file for the pin and unspent tokens. Written with mode 0600. */
  stateFile: string;
  pollMs?: number;
  timeoutMs?: number;
}

interface StoredToken {
  challenge: string;
  token: string;
}

interface SdkState {
  pinnedKey?: string;
  tokens: StoredToken[];
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const fromB64url = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64url'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export class FareClient {
  private readonly issuerUrl: string;
  private readonly stateFile: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private state: SdkState;

  constructor(opts: FareOptions) {
    this.issuerUrl = opts.issuerUrl.replace(/\/+$/, '');
    this.stateFile = opts.stateFile;
    this.pollMs = opts.pollMs ?? 5_000;
    this.timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    this.state = existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, 'utf8')) as SdkState) : { tokens: [] };
  }

  private save(): void {
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(tmp, this.stateFile);
  }

  get pinnedKey(): string | undefined {
    return this.state.pinnedKey;
  }

  /** Unspent tokens for a challenge, or all of them. */
  tokenCount(challenge?: string): number {
    return challenge ? this.state.tokens.filter((t) => t.challenge === challenge).length : this.state.tokens.length;
  }

  /**
   * Pins the issuer's key. With no pin yet, the newest directory key is pinned. With a
   * pin, the directory must still list it, or this throws.
   */
  async pin(): Promise<string> {
    const res = await fetch(`${this.issuerUrl}${DIRECTORY_PATH}`);
    if (!res.ok) throw new PurchaseError(`issuer directory unavailable (${res.status})`);
    const dir = (await res.json()) as { 'token-keys'?: { 'token-type': number; 'token-key': string; 'not-before'?: number }[] };
    const keys = (dir['token-keys'] ?? []).filter((k) => k['token-type'] === 2).map((k) => k['token-key']);
    if (keys.length === 0) throw new PurchaseError('issuer directory lists no type 2 key');
    if (this.state.pinnedKey) {
      if (!keys.includes(this.state.pinnedKey)) throw new UnpinnedKeyError('issuer directory no longer lists the pinned key');
      return this.state.pinnedKey;
    }
    this.state.pinnedKey = keys[0];
    this.save();
    return keys[0];
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
    if (b64url(c.tokenKey) !== this.state.pinnedKey) {
      throw new UnpinnedKeyError('origin presented a key other than the pinned one, refusing');
    }
    return c;
  }

  /** Blinds `offer.pack` nonces for `challenge` and orders them. */
  async order(challenge: WWWAuthenticateHeader, offer: Offer): Promise<PendingPurchase> {
    if (!Number.isInteger(offer.pack) || offer.pack < 1 || offer.pack > MAX_PACK) throw new PurchaseError('offer has an invalid pack size');
    const clients: BlindClient[] = [];
    const blinded: string[] = [];
    for (let i = 0; i < offer.pack; i++) {
      const client = new Client(MODE);
      const req = await client.createTokenRequest(challenge.challenge, challenge.tokenKey);
      clients.push(client);
      blinded.push(b64url(req.serialize()));
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
    return {
      purchase_id: body.purchase_id,
      pay_uri: body.pay_uri,
      expires_at: body.expires_at,
      challenge: b64url(challenge.challenge.serialize()),
      clients,
    };
  }

  /** Polls until paid, unblinds every signature and stores the tokens. Returns how many. */
  async collect(p: PendingPurchase): Promise<number> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const res = await fetch(`${this.issuerUrl}/fare/purchases/${p.purchase_id}`);
      const body = (await res.json().catch(() => ({}))) as { status?: string; signatures?: string[]; error?: string };
      if (body.status === 'paid') {
        if (!Array.isArray(body.signatures) || body.signatures.length !== p.clients.length) {
          throw new PurchaseError('issuer returned the wrong number of signatures');
        }
        const tokens: StoredToken[] = [];
        for (let i = 0; i < p.clients.length; i++) {
          // finalize checks each signature against the pinned key before it becomes a token.
          const token = await p.clients[i].finalize(new TokenResponse(fromB64url(body.signatures[i])));
          tokens.push({ challenge: p.challenge, token: b64url(token.serialize()) });
        }
        this.state.tokens.push(...tokens);
        this.save();
        return tokens.length;
      }
      if (body.status === 'expired' || body.status === 'key_retired' || res.status === 404 || res.status === 400) {
        throw new PurchaseError(`purchase cannot complete: ${body.status ?? body.error ?? res.status}`);
      }
      if (Date.now() >= deadline) throw new PurchaseError('timed out waiting for payment');
      await sleep(this.pollMs);
    }
  }

  /** Removes one token for `challenge` from the store and returns its Authorization header. */
  spend(challenge: WWWAuthenticateHeader): string | undefined {
    const key = b64url(challenge.challenge.serialize());
    const i = this.state.tokens.findIndex((t) => t.challenge === key);
    if (i < 0) return undefined;
    const [stored] = this.state.tokens.splice(i, 1);
    this.save();
    return new AuthorizationHeader(Token.deserialize(BLIND_RSA, fromB64url(stored.token))).toString();
  }

  /**
   * fetch() with Fare: on 402, checks the challenge against the pin, spends a token, or
   * buys a pack through `payer` and then spends one. Without a payer, throws
   * PaymentRequired carrying the origin's offer.
   */
  async fetch(url: string, init: RequestInit = {}, payer?: Payer): Promise<Response> {
    const first = await fetch(url, init);
    if (first.status !== 402) return first;
    const challenge = this.checkChallenge(first.headers.get('www-authenticate'));
    const offer = parseOffer(first.headers.get('fare-offer'));
    let auth = this.spend(challenge);
    if (!auth) {
      if (!payer || !offer) throw new PaymentRequired(offer);
      const purchase = await this.order(challenge, offer);
      await payer(purchase.pay_uri, offer);
      await this.collect(purchase);
      auth = this.spend(challenge);
      if (!auth) throw new PurchaseError('no token after a completed purchase');
    }
    const headers = new Headers(init.headers);
    headers.set('authorization', auth);
    return fetch(url, { ...init, headers });
  }
}

export { TokenChallenge };
