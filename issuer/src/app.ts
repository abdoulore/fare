// Fare issuer HTTP API.
//
//   GET  /.well-known/private-token-issuer-directory   RFC 9578 issuer directory
//   POST /fare/purchases   {pack, blinded: [N serialized TokenRequests]}  -> 201 {purchase_id, pay_uri, expires_at}
//   GET  /fare/purchases/{id}   {status}; once paid {status: "paid", signatures: [N]}
//
// The issuer sees purchases and blinded messages, never tokens (invariant 7). It logs
// nothing about requests (invariant 8).

import type { IncomingMessage, ServerResponse } from 'node:http';

import { publicVerif } from '@cloudflare/privacypass-ts';

import { PACK, PRICE_ZAT, PURCHASE_TTL_SECONDS, TOKEN_REQUEST_BYTES } from './config.ts';
import { KeyRing } from './keys.ts';
import { ScannerClient, ScannerUnavailable } from './scanner.ts';
import { blindSign } from './sign.ts';
import { PurchaseStore } from './store.ts';

const { BLIND_RSA, TokenRequest, TokenResponse } = publicVerif;

export const DIRECTORY_PATH = '/.well-known/private-token-issuer-directory';
export const PURCHASES_PATH = '/fare/purchases';
const MAX_BODY_BYTES = 256 * 1024;
const B64URL = /^[A-Za-z0-9_-]+$/;
const PURCHASE_ID = /^[0-9a-f]{32}$/;

export interface IssuerOptions {
  dataDir: string;
  scannerUrl: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

class HttpError extends Error {
  readonly code: number;
  constructor(code: number, reason: string) {
    super(reason);
    this.code = code;
  }
}

function send(res: ServerResponse, code: number, body: unknown, contentType = 'application/json'): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': contentType, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body_not_json');
  }
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

export function createIssuer(opts: IssuerOptions) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const keys = new KeyRing(opts.dataDir);
  const store = new PurchaseStore(opts.dataDir);
  const scanner = new ScannerClient(opts.scannerUrl);

  async function directory(res: ServerResponse): Promise<void> {
    const live = await keys.live(now());
    send(
      res,
      200,
      {
        'issuer-request-uri': PURCHASES_PATH,
        'token-keys': live.map((k) => ({ 'token-type': 2, 'token-key': b64url(k.tokenKey), 'not-before': k.notBefore })),
      },
      'application/private-token-issuer-directory',
    );
  }

  async function createPurchase(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req)) as { pack?: unknown; blinded?: unknown } | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body_not_object');
    const extra = Object.keys(body).filter((k) => k !== 'pack' && k !== 'blinded');
    if (extra.length > 0) throw new HttpError(400, 'unknown_field');
    if (body.pack !== PACK) throw new HttpError(400, 'wrong_pack');
    if (!Array.isArray(body.blinded) || body.blinded.length !== PACK) throw new HttpError(400, 'wrong_count');

    const t = now();
    const current = await keys.current(t);
    const seen = new Set<string>();
    for (const item of body.blinded) {
      if (typeof item !== 'string' || !B64URL.test(item)) throw new HttpError(400, 'malformed_request');
      const bytes = new Uint8Array(Buffer.from(item, 'base64url'));
      if (bytes.length !== TOKEN_REQUEST_BYTES || b64url(bytes) !== item) throw new HttpError(400, 'malformed_request');
      let parsed;
      try {
        parsed = TokenRequest.deserialize(BLIND_RSA, bytes);
      } catch {
        throw new HttpError(400, 'malformed_request');
      }
      if (parsed.tokenType !== BLIND_RSA.value) throw new HttpError(400, 'wrong_token_type');
      if (parsed.truncatedTokenKeyId !== current.truncatedKeyId) throw new HttpError(400, 'unknown_key');
      const blinded = b64url(parsed.blindedMsg);
      if (seen.has(blinded)) throw new HttpError(400, 'duplicate_request');
      seen.add(blinded);
    }

    let minted;
    try {
      minted = await scanner.mint(PRICE_ZAT);
    } catch (e) {
      if (e instanceof ScannerUnavailable) throw new HttpError(503, 'scanner_unavailable');
      throw e;
    }
    const expires = Math.min(t + PURCHASE_TTL_SECONDS, current.retiresAt);
    store.add({ id: minted.purchase_id, epoch: current.epoch, requests: body.blinded as string[], pay_uri: minted.pay_uri, expires_at: expires });
    send(res, 201, { purchase_id: minted.purchase_id, pay_uri: minted.pay_uri, expires_at: new Date(expires * 1000).toISOString() });
  }

  async function purchaseStatus(id: string, res: ServerResponse): Promise<void> {
    if (!PURCHASE_ID.test(id)) throw new HttpError(400, 'malformed_id');
    const record = store.get(id);
    if (!record) throw new HttpError(404, 'unknown_purchase');
    let status;
    try {
      status = await scanner.status(id);
    } catch (e) {
      if (e instanceof ScannerUnavailable) throw new HttpError(503, 'scanner_unavailable');
      throw e;
    }
    if (!status) throw new HttpError(500, 'scanner_lost_purchase');

    const t = now();
    if (status.status === 'paid') {
      const key = keys.signable(record.epoch, t);
      if (!key) {
        send(res, 410, { status: 'key_retired' });
        return;
      }
      const signatures = record.requests.map((r) => {
        const request = TokenRequest.deserialize(BLIND_RSA, new Uint8Array(Buffer.from(r, 'base64url')));
        return b64url(new TokenResponse(blindSign(key, request.blindedMsg)).serialize());
      });
      const body: Record<string, unknown> = { status: 'paid', signatures };
      // Invariant 11: flagged, never silently accepted.
      if (status.leaky_funding) body.warning = 'funded_from_transparent_inputs';
      send(res, 200, body);
      return;
    }
    if (t >= record.expires_at) {
      send(res, 200, { status: 'expired' });
      return;
    }
    send(res, 200, { status: status.status });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (path === DIRECTORY_PATH) {
        if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
        return await directory(res);
      }
      if (path === PURCHASES_PATH) {
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
        return await createPurchase(req, res);
      }
      if (path.startsWith(`${PURCHASES_PATH}/`)) {
        if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
        return await purchaseStatus(path.slice(PURCHASES_PATH.length + 1), res);
      }
      throw new HttpError(404, 'not_found');
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, e.code, { error: e.message });
      } else {
        send(res, 500, { error: 'internal' });
      }
    }
  }

  return { handle, keys, store };
}
