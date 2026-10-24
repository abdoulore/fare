// A local Fare stack for the end-to-end test: the real issuer, origin, demo API and
// demo payer, with a stub scanner standing in for the chain and a stub wallet standing
// in for fare-wallet. Run with Node 22 (type stripping):
//
//   node e2e/stack.ts
//
// The stub scanner moves a purchase from pending through in_mempool and confirming to
// paid when the stub wallet pays its address in full, or to underpaid when it pays half.

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createIssuer } from '../../issuer/src/app.ts';
import { PACK, PRICE_ZAT } from '../../issuer/src/config.ts';
import { createOrigin } from '../../origin/src/index.ts';
import { cannedResponder, failingOn } from '../../demo/src/llm.ts';
import { createPayer } from '../../demo/src/payer.ts';
import { createApi } from '../../demo/src/server.ts';

export const PORTS = { scanner: 18077, issuer: 18787, api: 18080, payer: 18791, web: 4173 };
const WEB_ORIGIN = `http://127.0.0.1:${PORTS.web}`;
const STEP_MS = Number(process.env.STUB_STEP_MS ?? 1500);
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

interface StubPurchase {
  id: string;
  index: number;
  address: string;
  status: string;
  received: number;
  height: number | null;
}

const purchases = new Map<string, StubPurchase>();
let tip = 4_600_000;

function json(res: Parameters<RequestListener>[1], code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const scanner: RequestListener = (req, res) => {
  if (req.method === 'POST' && req.url === '/mint') {
    const index = purchases.size + 7;
    const address = 'utest1' + Array.from(randomBytes(90), (b) => BECH32[b & 31]).join('');
    const p: StubPurchase = { id: randomBytes(16).toString('hex'), index, address, status: 'pending', received: 0, height: null };
    purchases.set(p.id, p);
    return json(res, 201, { purchase_id: p.id, index, address, pay_uri: `zcash:${address}?amount=0.001` });
  }
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { scanned_to: tip, purchases: purchases.size });
  if (req.method === 'GET' && req.url === '/ledger') {
    const rows = [...purchases.values()].map((p) => ({ index: p.index, price_zat: PRICE_ZAT, received_zat: p.received, payments: p.received ? 1 : 0, height: p.height, status: p.status }));
    return json(res, 200, { scanned_to: tip, rows });
  }
  const m = /^\/purchases\/([0-9a-f]{32})$/.exec(req.url ?? '');
  const p = m && purchases.get(m[1]);
  if (req.method === 'GET' && p) return json(res, 200, { status: p.status, received_zat: p.received, payments: [], leaky_funding: false });
  json(res, 404, { error: 'unknown_purchase' });
};

/** The stub chain: a payment walks the purchase forward one status per step. */
function pay(address: string, zat: number): string {
  const p = [...purchases.values()].find((x) => x.address === address);
  if (!p) throw new Error('no such address');
  const steps = zat >= PRICE_ZAT ? ['in_mempool', 'confirming', 'paid'] : ['in_mempool', 'confirming', 'underpaid'];
  steps.forEach((s, i) =>
    setTimeout(() => {
      p.status = s;
      p.received = zat;
      if (s !== 'in_mempool') p.height = p.height ?? ++tip;
    }, STEP_MS * (i + 1)),
  );
  return randomBytes(32).toString('hex');
}

function listen(handler: RequestListener, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

const data = mkdtempSync(join(tmpdir(), 'fare-e2e-'));
const issuer = createIssuer({ dataDir: join(data, 'issuer'), scannerUrl: `http://127.0.0.1:${PORTS.scanner}`, webOrigins: [WEB_ORIGIN] });
const issuerUrl = `http://127.0.0.1:${PORTS.issuer}`;
const origin = createOrigin({ originName: 'api.fare.e2e', issuerName: 'issuer.fare.e2e', issuerUrl, pack: PACK, priceZec: '0.001', dataDir: join(data, 'origin') });
const payer = createPayer({
  priceZat: PRICE_ZAT,
  webOrigins: [WEB_ORIGIN],
  maxPerHour: 50,
  maxPerClientHour: 50,
  run: async (args) => {
    if (args[0] === 'balance') return 'POOL SPENDABLE PENDING\nironwood 0.99 0\n';
    if (args[0] !== 'pay') return '';
    const m = /^zcash:(\S+)\?amount=([0-9.]+)$/.exec(args[1])!;
    const zat = Math.round(Number(m[2]) * 1e8);
    return `TXID ${pay(m[1], zat)}\n`;
  },
});

await listen(scanner, PORTS.scanner);
await listen((req, res) => void issuer.handle(req, res), PORTS.issuer);
await listen(createApi({ origin, responder: failingOn('#fail', cannedResponder()), simulated: true, pack: PACK, priceZec: '0.001', webOrigins: [WEB_ORIGIN] }), PORTS.api);
await listen((req, res) => void payer.handle(req, res), PORTS.payer);
await payer.refreshBalance();
console.log(`e2e stack up: issuer ${issuerUrl}, api :${PORTS.api}, payer :${PORTS.payer}, scanner stub :${PORTS.scanner}`);
