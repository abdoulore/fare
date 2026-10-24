// The demo agent: asks the API a series of questions. On the first 402 it buys a pack
// through the SDK and pays with fare-wallet; every call after that spends one token.
// It ends by replaying a token to show the origin refuse it.
//
//   API_URL       demo API (default http://127.0.0.1:8080/v1/ask)
//   ISSUER_URL    issuer (default http://127.0.0.1:8787)
//   CALLS         questions to ask (default 5)
//   AGENT_STATE   SDK state file: pin and unspent tokens (default agent-state.json)
//   FARE_WALLET   fare-wallet binary (default ../wallet/target/release/fare-wallet)
//   WALLET_DIR    its database dir (default ../wallet/fare-wallet-data)
//   FARE_PAYER_SEED   passed through to fare-wallet; never read here

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { FareClient, type Offer } from '../../sdk/src/index.ts';

const run = promisify(execFile);
const env = process.env;
const apiUrl = env.API_URL ?? 'http://127.0.0.1:8080/v1/ask';
const calls = Number(env.CALLS ?? 5);
const QUESTIONS = [
  'What does a shielded Zcash payment hide from a chain observer?',
  'In one sentence, what is a blind signature?',
  'Why does single-use matter for an anonymous token?',
  'What can an API provider still learn from a request it serves?',
  'Name one risk of a very small anonymity set.',
];

/** Pays a pay URI with fare-wallet, refusing anything above the offered price. */
async function payWithWallet(payUri: string, offer: Offer): Promise<void> {
  const wallet = env.FARE_WALLET ?? '../wallet/target/release/fare-wallet';
  const args = ['--dir', env.WALLET_DIR ?? '../wallet/fare-wallet-data'];
  if (env.LIGHTWALLETD) args.push('--server', env.LIGHTWALLETD);
  args.push('pay', payUri, '--max-zec', offer.price_zec, '--wait-secs', '600');
  console.log(`paying ${offer.price_zec} TAZ for ${offer.pack} calls with fare-wallet`);
  const { stdout } = await run(wallet, args, { env, maxBuffer: 1 << 20 });
  for (const line of stdout.split('\n').filter((l) => l.startsWith('TXID '))) console.log(line);
}

const fare = new FareClient({ issuerUrl: env.ISSUER_URL ?? 'http://127.0.0.1:8787', stateFile: env.AGENT_STATE ?? 'agent-state.json', pollMs: 5_000 });
await fare.pin();

for (let i = 0; i < calls; i++) {
  const prompt = QUESTIONS[i % QUESTIONS.length];
  const res = await fare.fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }, payWithWallet);
  const body = (await res.json()) as { answer?: string; simulated?: boolean; error?: string };
  console.log(`\n[${i + 1}] ${prompt}\n${res.status} ${body.simulated ? '(simulated) ' : ''}${body.answer ?? body.error}`);
}
console.log(`\ntokens left: ${fare.tokenCount()}`);

// Replay: spend one token by hand and send it twice.
const probe = await fetch(apiUrl, { method: 'POST' });
const challenge = await fare.acceptChallenge(probe.headers.get('www-authenticate'));
const auth = fare.spend(challenge);
if (!auth) throw new Error('no token left to replay');
const send = () => fetch(apiUrl, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'replay test' }) });
const first = await send();
const second = await send();
console.log(`replay: first use ${first.status}, second use ${second.status} ${JSON.stringify(await second.json())}`);
if (first.status !== 200 || second.status !== 401) process.exit(1);
