// The demo API (public) and the server-view panel (loopback only).
//
//   POST /v1/ask {prompt}   402 without a token; one token per answer.
//   GET  /                  what this API is and what it costs.
//
// The body is validated before the token is redeemed, so a malformed request costs
// nothing. A model failure after redemption does cost the token: it cannot be unspent
// without linking it to the caller.

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createOrigin } from '../../origin/src/index.ts';
import { MAX_PROMPT_CHARS, UpstreamError, type Responder } from './llm.ts';

type Origin = ReturnType<typeof createOrigin>;
const MAX_BODY_BYTES = 16 * 1024;

function send(res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `{prompt}` with a non-empty string of at most MAX_PROMPT_CHARS, or an error code. */
export function parseAsk(raw: string | undefined): { prompt: string } | { error: string } {
  if (raw === undefined) return { error: 'body_too_large' };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: 'body_not_json' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body_not_object' };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'prompt') return { error: 'body_must_be_prompt_only' };
  const prompt = (body as { prompt: unknown }).prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') return { error: 'prompt_empty' };
  if (prompt.length > MAX_PROMPT_CHARS) return { error: 'prompt_too_long' };
  return { prompt };
}

export interface ApiOptions {
  origin: Origin;
  responder: Responder;
  simulated: boolean;
  pack: number;
  priceZec: string;
}

export function createApi(opts: ApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (path === '/' && req.method === 'GET') {
        send(res, 200, {
          service: 'Fare demo LLM proxy',
          ask: 'POST /v1/ask {"prompt": "..."} with Authorization: PrivateToken token="..."',
          price: `${opts.pack} calls for ${opts.priceZec} TAZ (testnet)`,
          simulated: opts.simulated,
        });
        return;
      }
      if (path !== '/v1/ask') return send(res, 404, { error: 'not_found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

      const auth = req.headers.authorization;
      if (!auth) {
        send(res, 402, { error: 'payment_required' }, await opts.origin.challengeHeaders());
        return;
      }
      const ask = parseAsk(await readBody(req));
      if ('error' in ask) return send(res, ask.error === 'body_too_large' ? 413 : 400, { error: ask.error });

      const verdict = await opts.origin.redeem(auth);
      if (!verdict.ok) return send(res, 401, { error: verdict.reason });

      try {
        const answer = await opts.responder(ask.prompt);
        send(res, 200, { answer: answer.text, simulated: answer.simulated, model: answer.model, ...(answer.refused ? { refused: true } : {}) });
      } catch (e) {
        if (e instanceof UpstreamError) return send(res, e.status, { error: 'model_unavailable', detail: e.message });
        throw e;
      }
    } catch {
      if (!res.headersSent) send(res, 503, { error: 'unavailable' });
    }
  };
}
