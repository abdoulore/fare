// CORS for the web frontend. Only listed origins get the allow headers; no credentials.
// The 402's headers are exposed, or a browser could not read the challenge or the offer.

import type { IncomingMessage, ServerResponse } from 'node:http';

export const EXPOSED_HEADERS = 'WWW-Authenticate, Fare-Offer, Retry-After';

/** Comma-separated origins, e.g. `https://fare.example,http://127.0.0.1:5173`. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Sets CORS headers on `res` when the request's Origin is allowed. Answers a preflight
 * itself and returns true; the caller then stops.
 */
export function cors(req: IncomingMessage, res: ServerResponse, allowed: readonly string[]): boolean {
  const origin = req.headers.origin;
  const ok = typeof origin === 'string' && allowed.includes(origin);
  res.setHeader('vary', 'Origin');
  if (ok) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-expose-headers', EXPOSED_HEADERS);
  }
  if (req.method !== 'OPTIONS') return false;
  if (ok) {
    res.setHeader('access-control-allow-methods', 'GET, POST');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-max-age', '600');
  }
  res.writeHead(204).end();
  return true;
}
