// Starts the demo payer. Configuration from the environment:
//
//   PAYER_LISTEN         host:port (default 127.0.0.1:8791)
//   FARE_WALLET          fare-wallet binary (default ../wallet/target/release/fare-wallet)
//   WALLET_DIR           its database dir (default ../wallet/fare-wallet-data)
//   LIGHTWALLETD         lightwalletd URL (default: fare-wallet's, testnet.zec.rocks)
//   FARE_PAYER_SEED      passed through to fare-wallet; never read here
//   PAYER_MAX_PER_HOUR   packs per hour, all visitors (default 5)
//   PAYER_TRUST_PROXY    1 behind a reverse proxy that sets X-Forwarded-For
//   WEB_ORIGINS          browser origins allowed by CORS, comma-separated

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

import { PRICE_ZAT } from '../../issuer/src/config.ts';
import { parseOrigins } from '../../issuer/src/cors.ts';
import { createPayer } from './payer.ts';

const exec = promisify(execFile);
const env = process.env;
const wallet = env.FARE_WALLET ?? '../wallet/target/release/fare-wallet';
const base = ['--dir', env.WALLET_DIR ?? '../wallet/fare-wallet-data', ...(env.LIGHTWALLETD ? ['--server', env.LIGHTWALLETD] : [])];

const payer = createPayer({
  run: async (args) => (await exec(wallet, [...base, ...args], { env, maxBuffer: 1 << 20, timeout: 10 * 60_000 })).stdout,
  priceZat: PRICE_ZAT,
  maxPerHour: Number(env.PAYER_MAX_PER_HOUR ?? 5),
  trustProxy: env.PAYER_TRUST_PROXY === '1',
  webOrigins: parseOrigins(env.WEB_ORIGINS),
});

const listen = env.PAYER_LISTEN ?? '127.0.0.1:8791';
const i = listen.lastIndexOf(':');
createServer((req, res) => void payer.handle(req, res)).listen(Number(listen.slice(i + 1)), listen.slice(0, i), () => {
  console.log(`demo payer on http://${listen} (testnet only)`);
});
await payer.refreshBalance();
setInterval(() => void payer.refreshBalance(), 5 * 60_000).unref();
