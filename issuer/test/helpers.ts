// Test fixtures: a stub scanner sidecar, an issuer on a random port, and real blinded
// requests from privacypass-ts clients.

import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { publicVerif } from '@cloudflare/privacypass-ts';

import { createIssuer } from '../src/app.ts';

const { BlindRSAMode, Client, Origin } = publicVerif;

export const ISSUER_NAME = 'issuer.fare.test';
export const ORIGIN_NAME = 'api.fare.test';
export const MODE = BlindRSAMode.PSS;

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fare-issuer-'));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export interface StubScanner {
  url: string;
  /** Status the stub reports, per purchase id. */
  statuses: Map<string, { status: string; leaky_funding?: boolean }>;
  mints: number;
  down: boolean;
  close(): Promise<void>;
}

export async function stubScanner(): Promise<StubScanner> {
  const stub = { statuses: new Map(), mints: 0, down: false } as unknown as StubScanner;
  const server = createServer((req, res) => {
    if (stub.down) {
      res.writeHead(500).end();
      return;
    }
    if (req.method === 'POST' && req.url === '/mint') {
      stub.mints += 1;
      const id = stub.mints.toString(16).padStart(32, '0');
      stub.statuses.set(id, { status: 'pending' });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ purchase_id: id, index: 1, address: `utest1stub${stub.mints}`, pay_uri: `zcash:utest1stub${stub.mints}?amount=0.001` }));
      return;
    }
    const m = /^\/purchases\/([0-9a-f]+)$/.exec(req.url ?? '');
    const s = m && stub.statuses.get(m[1]);
    if (req.method === 'GET' && s) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: s.status, received_zat: 0, payments: [], leaky_funding: s.leaky_funding ?? false }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"unknown_purchase"}');
  });
  stub.url = await listen(server);
  stub.close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  return stub;
}

export interface TestIssuer {
  url: string;
  issuer: ReturnType<typeof createIssuer>;
  clock: { now: number };
  close(): Promise<void>;
}

export async function startIssuer(scannerUrl: string, dataDir = tempDir(), now = Math.floor(Date.now() / 1000)): Promise<TestIssuer> {
  const clock = { now };
  const issuer = createIssuer({ dataDir, scannerUrl, now: () => clock.now });
  const server = createServer((req, res) => void issuer.handle(req, res));
  const url = await listen(server);
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return { url, issuer, clock, close };
}

/** n real clients blinding nonces against `tokenKey` for a challenge from ORIGIN_NAME. */
export async function blind(n: number, tokenKey: Uint8Array) {
  const challenge = new Origin(MODE, [ORIGIN_NAME]).createTokenChallenge(ISSUER_NAME, new Uint8Array(0));
  const clients = [];
  const requests: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = new Client(MODE);
    const r = await c.createTokenRequest(challenge, tokenKey);
    clients.push(c);
    requests.push(Buffer.from(r.serialize()).toString('base64url'));
  }
  return { clients, requests, challenge };
}

export async function json(res: Response): Promise<any> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
