// Starts the issuer. Configuration from the environment:
//   ISSUER_LISTEN   host:port to listen on (default 127.0.0.1:8787)
//   ISSUER_DATA     directory for keys and purchases (default issuer-data)
//   SCANNER_URL     the scanner sidecar (default http://127.0.0.1:7077)
//   WEB_ORIGINS     browser origins allowed by CORS, comma-separated (default none)

import { createServer } from 'node:http';

import { createIssuer } from './app.ts';
import { parseOrigins } from './cors.ts';

const listen = process.env.ISSUER_LISTEN ?? '127.0.0.1:8787';
const [host, portText] = [listen.slice(0, listen.lastIndexOf(':')), listen.slice(listen.lastIndexOf(':') + 1)];
const port = Number(portText);
if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`ISSUER_LISTEN must be host:port, got ${listen}`);
  process.exit(1);
}

const issuer = createIssuer({
  dataDir: process.env.ISSUER_DATA ?? 'issuer-data',
  scannerUrl: process.env.SCANNER_URL ?? 'http://127.0.0.1:7077',
  webOrigins: parseOrigins(process.env.WEB_ORIGINS),
});

const key = await issuer.keys.current(Math.floor(Date.now() / 1000));
createServer((req, res) => void issuer.handle(req, res)).listen(port, host, () => {
  console.log(`issuer on http://${listen}, key epoch ${key.epoch}, key id ${Buffer.from(key.keyId).toString('hex').slice(0, 16)}...`);
});
