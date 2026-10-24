// Failure-path scenarios on a live stack, paid by fare-wallet:
//
//   paid       pay the price once: 100 tokens, and a call with one of them succeeds
//   underpaid  pay half the price: the purchase stays underpaid and no signature is issued
//   second     pay the price twice: the scanner records both payments, the purchase is
//              paid with the extra noted, and still exactly 100 tokens come back
//
// Prints one JSON summary and exits non-zero if any expectation fails.
//
//   API_URL, ISSUER_URL, SCANNER_URL, FARE_WALLET, WALLET_DIR, LIGHTWALLETD, FARE_PAYER_SEED

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { FareClient, parseOffer, type Offer, type PendingPurchase } from '../../sdk/src/index.ts';

const run = promisify(execFile);
const env = process.env;
const apiUrl = env.API_URL ?? 'http://127.0.0.1:8080/v1/ask';
const issuerUrl = env.ISSUER_URL ?? 'http://127.0.0.1:8787';
const scannerUrl = env.SCANNER_URL ?? 'http://127.0.0.1:7077';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

async function pay(uri: string, maxZec: string): Promise<string[]> {
  const args = ['--dir', env.WALLET_DIR ?? '../wallet/fare-wallet-data'];
  if (env.LIGHTWALLETD) args.push('--server', env.LIGHTWALLETD);
  args.push('pay', uri, '--max-zec', maxZec, '--wait-secs', '900');
  const { stdout } = await run(env.FARE_WALLET ?? '../wallet/target/release/fare-wallet', args, { env, maxBuffer: 1 << 20 });
  const txids = stdout.split('\n').filter((l) => l.startsWith('TXID ')).map((l) => l.slice(5).trim());
  console.log(`paid ${uri.split('?')[1]} in ${txids.join(', ')}`);
  return txids;
}

async function issuerStatus(id: string): Promise<{ status: string; signatures?: string[] }> {
  return (await fetch(`${issuerUrl}/fare/purchases/${id}`)).json() as Promise<{ status: string; signatures?: string[] }>;
}

async function scannerStatus(id: string): Promise<{ status: string; received_zat: number; payments: { height: number | null; txid: string }[] }> {
  return (await fetch(`${scannerUrl}/purchases/${id}`)).json() as Promise<{ status: string; received_zat: number; payments: { height: number | null; txid: string }[] }>;
}

/** Polls the scanner until `done` holds or ten minutes pass. */
async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > deadline) return v;
    await sleep(10_000);
  }
}

const fare = new FareClient({ issuerUrl, stateFile: env.AGENT_STATE ?? 'scenarios-state.json', pollMs: 5_000, timeoutMs: 15 * 60_000 });
await fare.pin();
const probe = await fetch(apiUrl, { method: 'POST' });
const challenge = await fare.acceptChallenge(probe.headers.get('www-authenticate'));
const offer = parseOffer(probe.headers.get('fare-offer')) as Offer;
const half = (Number(offer.price_zec) / 2).toString();

// Order all three first, then pay them one after another.
const paid: PendingPurchase = await fare.order(challenge, offer);
const underpaid: PendingPurchase = await fare.order(challenge, offer);
const second: PendingPurchase = await fare.order(challenge, offer);
const summary: Record<string, unknown> = {};

// paid
summary.paid = { purchase: paid.purchase_id.slice(0, 8), txids: await pay(paid.pay_uri, offer.price_zec) };
// underpaid: same address, half the amount
summary.underpaid = { purchase: underpaid.purchase_id.slice(0, 8), txids: await pay(underpaid.pay_uri.replace(/amount=[0-9.]+$/, `amount=${half}`), half) };
// second payment: the price, twice
const secondTx = [...(await pay(second.pay_uri, offer.price_zec)), ...(await pay(second.pay_uri, offer.price_zec))];
summary.second = { purchase: second.purchase_id.slice(0, 8), txids: secondTx };

// paid: tokens, then one call
const tokens = await fare.collect(paid);
expect(tokens === offer.pack, `paid: ${tokens} tokens for one payment of ${offer.price_zec}`);
const call = await fare.fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'scenario call' }) });
expect(call.status === 200, `paid: a call with one token returns ${call.status}`);

// underpaid: mined, still short, no signatures
const u = await waitFor(() => scannerStatus(underpaid.purchase_id), (s) => s.status === 'underpaid');
expect(u.status === 'underpaid' && u.received_zat * 2 === Number(offer.price_zec) * 1e8, `underpaid: scanner says ${u.status}, received ${u.received_zat} zat`);
const ui = await issuerStatus(underpaid.purchase_id);
expect(ui.status === 'underpaid' && ui.signatures === undefined, `underpaid: issuer says ${ui.status} and returns no signatures`);
(summary.underpaid as Record<string, unknown>).status = ui.status;

// second payment: both mined, paid with the extra, exactly one pack
const s = await waitFor(() => scannerStatus(second.purchase_id), (v) => v.payments.length === 2 && v.payments.every((p) => p.height !== null));
expect(s.payments.length === 2 && s.received_zat === 2 * Number(offer.price_zec) * 1e8, `second: scanner recorded ${s.payments.length} payments, ${s.received_zat} zat`);
const before = fare.tokenCount();
const secondTokens = await fare.collect(second);
expect(secondTokens === offer.pack && fare.tokenCount() - before === offer.pack, `second: exactly ${secondTokens} tokens for two payments`);
(summary.second as Record<string, unknown>).received_zat = s.received_zat;

console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  console.log(`SCENARIOS FAIL: ${failures.length}`);
  process.exit(1);
}
console.log('SCENARIOS PASS');
