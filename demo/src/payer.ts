// The hosted demo's payer (owner decision D3): pays a purchase's zcash: URI with
// fare-wallet, so a visitor without an Ironwood testnet wallet can still buy a pack.
//
//   POST /pay {pay_uri, mode: "full" | "half"}   -> 200 {txids, amount_zec, paid_by}
//   GET  /health                                 -> {ok, balance_zat, empty, network}
//
// It is a separate service from the origin: it sees a purchase address, never a purchase
// id or a token, and the origin never sees it. Pages that use it say who paid.
//
// Limits: testnet only, the pack price or half of it, each address once, a global and a
// per-client hourly cap, one payment at a time. Client addresses are kept only as
// salted hashes in memory, for the cap, and never logged.

import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { cors } from '../../issuer/src/cors.ts';

export type Mode = 'full' | 'half';

/** Runs fare-wallet with these arguments and returns stdout; throws on a non-zero exit. */
export type WalletRunner = (args: string[]) => Promise<string>;

export interface PayerOptions {
  run: WalletRunner;
  priceZat: number;
  /** Packs per rolling hour across all clients. */
  maxPerHour?: number;
  /** Packs per rolling hour per client address. */
  maxPerClientHour?: number;
  /** Use the last X-Forwarded-For hop as the client address (behind a reverse proxy). */
  trustProxy?: boolean;
  webOrigins?: readonly string[];
  /** Below this spendable plus pending balance, the payer reports itself empty. */
  minBalanceZat?: number;
  now?: () => number;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024;
const TESTNET_URI = /^zcash:(utest1[02-9ac-hj-np-z]{20,600})\?amount=([0-9]+(?:\.[0-9]{1,8})?)$/;

export function formatZat(zat: number): string {
  const whole = Math.floor(zat / 1e8);
  const frac = (zat % 1e8).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function parseZecToZat(s: string): number {
  const [w, f = ''] = s.split('.');
  return Number(w) * 1e8 + Number(f.padEnd(8, '0'));
}

/** Sum of SPENDABLE and PENDING over every pool row of `fare-wallet balance`. */
export function parseBalance(stdout: string): number | undefined {
  let total = 0;
  let rows = 0;
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s*$/.exec(line.trim());
    if (!m || m[1] === 'POOL') continue;
    total += parseZecToZat(m[2]) + parseZecToZat(m[3]);
    rows += 1;
  }
  return rows > 0 ? total : undefined;
}

class Refusal extends Error {
  readonly code: number;
  constructor(code: number, reason: string) {
    super(reason);
    this.code = code;
  }
}

export function createPayer(opts: PayerOptions) {
  const now = opts.now ?? (() => Date.now());
  const maxPerHour = opts.maxPerHour ?? 5;
  const maxPerClient = opts.maxPerClientHour ?? 2;
  const minBalance = opts.minBalanceZat ?? opts.priceZat + 10_000;
  const salt = randomBytes(16);
  const recent: number[] = [];
  const byClient = new Map<string, number[]>();
  const paidAddresses = new Set<string>();
  let busy = false;
  let balance: number | undefined;

  const hash = (s: string) => createHash('sha256').update(salt).update(s).digest('hex');

  function clientOf(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (opts.trustProxy && typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',').at(-1)!.trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function prune(list: number[]): number[] {
    const cutoff = now() - HOUR_MS;
    while (list.length > 0 && list[0] <= cutoff) list.shift();
    return list;
  }

  async function refreshBalance(): Promise<number | undefined> {
    try {
      await opts.run(['sync']);
      balance = parseBalance(await opts.run(['balance']));
    } catch {
      // Keep the last known balance; health reports ok: false when there is none.
    }
    return balance;
  }

  function checkRequest(body: unknown): { uri: string; address: string; mode: Mode; amountZat: number } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refusal(400, 'body_not_object');
    const keys = Object.keys(body).sort();
    if (keys.join(',') !== 'mode,pay_uri') throw new Refusal(400, 'body_must_be_pay_uri_and_mode');
    const { pay_uri: uri, mode } = body as { pay_uri: unknown; mode: unknown };
    if (mode !== 'full' && mode !== 'half') throw new Refusal(400, 'mode_must_be_full_or_half');
    if (typeof uri !== 'string') throw new Refusal(400, 'pay_uri_not_testnet');
    const m = TESTNET_URI.exec(uri);
    if (!m) throw new Refusal(400, 'pay_uri_not_testnet');
    if (parseZecToZat(m[2]) !== opts.priceZat) throw new Refusal(400, 'pay_uri_wrong_price');
    const amountZat = mode === 'full' ? opts.priceZat : Math.floor(opts.priceZat / 2);
    return { uri: `zcash:${m[1]}?amount=${formatZat(amountZat)}`, address: m[1], mode, amountZat };
  }

  async function pay(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new Refusal(413, 'body_too_large');
      chunks.push(chunk as Buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Refusal(400, 'body_not_json');
    }
    const r = checkRequest(body);
    const addressKey = hash(r.address);
    if (paidAddresses.has(addressKey)) throw new Refusal(409, 'already_paid');
    const client = hash(clientOf(req));
    const mine = prune(byClient.get(client) ?? []);
    if (prune(recent).length >= maxPerHour) throw new Refusal(429, 'demo_payer_hourly_limit');
    if (mine.length >= maxPerClient) throw new Refusal(429, 'demo_payer_client_limit');
    if (busy) throw new Refusal(429, 'demo_payer_busy');
    if (balance !== undefined && balance < minBalance) throw new Refusal(503, 'demo_payer_empty');

    busy = true;
    try {
      recent.push(now());
      mine.push(now());
      byClient.set(client, mine);
      paidAddresses.add(addressKey);
      let stdout: string;
      try {
        stdout = await opts.run(['pay', r.uri, '--max-zec', formatZat(opts.priceZat), '--wait-secs', '240']);
      } catch {
        // Not paid: give the address and the slot back so the visitor can retry.
        paidAddresses.delete(addressKey);
        recent.pop();
        mine.pop();
        throw new Refusal(502, 'demo_payer_failed');
      }
      const txids = stdout
        .split('\n')
        .filter((l) => l.startsWith('TXID '))
        .map((l) => l.slice(5).trim())
        .filter((t) => /^[0-9a-f]{64}$/.test(t));
      send(res, 200, { txids, amount_zec: formatZat(r.amountZat), mode: r.mode, paid_by: 'fare-demo-wallet' });
    } finally {
      busy = false;
      void refreshBalance();
    }
  }

  function send(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (cors(req, res, opts.webOrigins ?? [])) return;
      if (path === '/health' && req.method === 'GET') {
        send(res, 200, {
          ok: balance !== undefined,
          balance_zat: balance ?? null,
          empty: balance !== undefined && balance < minBalance,
          network: 'test',
          packs_left_this_hour: Math.max(0, maxPerHour - prune(recent).length),
        });
        return;
      }
      if (path !== '/pay') return send(res, 404, { error: 'not_found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
      await pay(req, res);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof Refusal) send(res, e.code, { error: e.message });
      else send(res, 500, { error: 'internal' });
    }
  }

  return { handle, refreshBalance };
}
