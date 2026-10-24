// Starts the demo API (behind the origin) and the server-view panel.
//
//   API_LISTEN     public API, host:port (default 127.0.0.1:8080)
//   PANEL_LISTEN   panel, loopback only (default 127.0.0.1:8790)
//   ISSUER_URL     issuer the origin reads keys from (default http://127.0.0.1:8787)
//   ISSUER_NAME    issuer name in challenges (default issuer.fare.demo)
//   ORIGIN_NAME    this origin's name in challenges (default api.fare.demo)
//   ORIGIN_DATA    spent-nonce store (default origin-data)
//   ISSUER_DATA    the issuer's data dir, read by the panel (default ../issuer/issuer-data)
//   SCANNER_URL    scanner sidecar, read by the panel (default http://127.0.0.1:7077)
//   ANTHROPIC_API_KEY / FARE_MODEL   real model answers; without a key, answers are simulated

import { createServer } from 'node:http';
import { isIP } from 'node:net';

import { createOrigin } from '../../origin/src/index.ts';
import { PACK, PRICE_ZAT } from '../../issuer/src/config.ts';
import { responderFromEnv } from './llm.ts';
import { createPanel } from './panel.ts';
import { createApi } from './server.ts';

function hostPort(value: string, name: string): [string, number] {
  const i = value.lastIndexOf(':');
  const host = value.slice(0, i).replace(/^\[|\]$/g, '');
  const port = Number(value.slice(i + 1));
  if (i < 0 || !host || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`${name} must be host:port, got ${value}`);
  return [host, port];
}

const env = process.env;
const priceZec = (PRICE_ZAT / 1e8).toString();
const simulated = !(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);

const origin = createOrigin({
  originName: env.ORIGIN_NAME ?? 'api.fare.demo',
  issuerName: env.ISSUER_NAME ?? 'issuer.fare.demo',
  issuerUrl: env.ISSUER_URL ?? 'http://127.0.0.1:8787',
  pack: PACK,
  priceZec,
  dataDir: env.ORIGIN_DATA ?? 'origin-data',
});

const [apiHost, apiPort] = hostPort(env.API_LISTEN ?? '127.0.0.1:8080', 'API_LISTEN');
const [panelHost, panelPort] = hostPort(env.PANEL_LISTEN ?? '127.0.0.1:8790', 'PANEL_LISTEN');
if (!(panelHost === 'localhost' || (isIP(panelHost) && (panelHost.startsWith('127.') || panelHost === '::1')))) {
  console.error(`PANEL_LISTEN must be loopback: the panel shows both sides. Got ${panelHost}`);
  process.exit(1);
}

createServer(createApi({ origin, responder: responderFromEnv(env), simulated, pack: PACK, priceZec })).listen(apiPort, apiHost, () => {
  console.log(`demo API on http://${apiHost}:${apiPort}${simulated ? ' (answers SIMULATED: no model API key)' : ''}`);
});
createServer(
  createPanel({ origin, issuerDataDir: env.ISSUER_DATA ?? '../issuer/issuer-data', scannerUrl: env.SCANNER_URL ?? 'http://127.0.0.1:7077', pack: PACK, simulated }),
).listen(panelPort, panelHost, () => {
  console.log(`panel on http://${panelHost}:${panelPort}/panel (loopback only)`);
});
