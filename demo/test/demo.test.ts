import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { createOrigin } from '../../origin/src/index.ts';
import { FareClient } from '../../sdk/src/index.ts';
import { startIssuer, stubScanner, tempDir, WEB_ORIGIN, type StubScanner, type TestIssuer } from '../../issuer/test/helpers.ts';
import { PACK } from '../../issuer/src/config.ts';
import { cannedResponder, claudeResponder, failingOn, responderFromEnv, UpstreamError, type MessagesClient, type Responder } from '../src/llm.ts';
import { createPanel, panelStats, PANEL_PAGE } from '../src/panel.ts';
import { createApi, parseAsk } from '../src/server.ts';

let scanner: StubScanner;
let issuer: TestIssuer;
let issuerDataDir: string;

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

async function stack(responder: Responder = cannedResponder()) {
  const origin = createOrigin({ originName: 'api.fare.test', issuerName: 'issuer.fare.test', issuerUrl: issuer.url, pack: PACK, priceZec: '0.001', dataDir: tempDir() });
  const api = await serve(createApi({ origin, responder, simulated: true, pack: PACK, priceZec: '0.001', webOrigins: [WEB_ORIGIN] }));
  const panel = await serve(createPanel({ origin, issuerDataDir, scannerUrl: scanner.url, pack: PACK, simulated: true }));
  const sdk = new FareClient({ issuerUrl: issuer.url, stateFile: join(tempDir(), 'agent.json'), pollMs: 10, timeoutMs: 2_000 });
  await sdk.pin();
  const ask = `${api.url}/v1/ask`;
  const close = async () => { await api.close(); await panel.close(); };
  return { origin, api, panel, sdk, ask, close };
}

const payer = async () => {
  for (const id of scanner.statuses.keys()) scanner.statuses.set(id, { status: 'paid' });
};
const post = (prompt: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });

before(async () => {
  scanner = await stubScanner();
  issuerDataDir = tempDir();
  issuer = await startIssuer(scanner.url, issuerDataDir);
});

after(async () => {
  await issuer.close();
  await scanner.close();
});

test('parseAsk accepts one non-empty prompt and nothing else', () => {
  assert.deepEqual(parseAsk('{"prompt":"hi"}'), { prompt: 'hi' });
  const cases: [string | undefined, string][] = [
    [undefined, 'body_too_large'],
    ['nope', 'body_not_json'],
    ['[1]', 'body_not_object'],
    ['{"prompt":"hi","user":"ore"}', 'body_must_be_prompt_only'],
    ['{"prompt":"   "}', 'prompt_empty'],
    ['{"prompt":42}', 'prompt_empty'],
    [JSON.stringify({ prompt: 'x'.repeat(4001) }), 'prompt_too_long'],
  ];
  for (const [raw, error] of cases) assert.deepEqual(parseAsk(raw), { error }, String(raw).slice(0, 30));
});

test('the agent flow: 402, pay, then one simulated answer per token', async () => {
  const s = await stack();
  try {
    const unpaid = await fetch(s.ask, post('hello'));
    assert.equal(unpaid.status, 402);
    assert.ok(unpaid.headers.get('www-authenticate')?.startsWith('PrivateToken'));

    for (let i = 0; i < 3; i++) {
      const res = await s.sdk.fetch(s.ask, post(`question ${i}`), payer);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.simulated, true);
      assert.match(body.answer, /^\[simulated\]/);
    }
    assert.equal(s.sdk.tokenCount(), PACK - 3);
    assert.equal(s.origin.stats().redeemed, 3);
    assert.ok(s.origin.stats().challenged >= 2, 'every 402 is counted');
  } finally {
    await s.close();
  }
});

test('a malformed body is refused before the token is spent', async () => {
  const s = await stack();
  try {
    assert.equal((await s.sdk.fetch(s.ask, post('first'), payer)).status, 200);
    const challenge = await s.sdk.acceptChallenge((await fetch(s.ask, { method: 'POST' })).headers.get('www-authenticate'));
    const auth = s.sdk.spend(challenge)!;
    const bad = await fetch(s.ask, { method: 'POST', headers: { authorization: auth }, body: '{"prompt":""}' });
    assert.equal(bad.status, 400);
    const good = await fetch(s.ask, { method: 'POST', headers: { authorization: auth }, body: '{"prompt":"now"}' });
    assert.equal(good.status, 200, 'the same token still works');
    const replay = await fetch(s.ask, { method: 'POST', headers: { authorization: auth }, body: '{"prompt":"again"}' });
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), { error: 'token_reused' });
  } finally {
    await s.close();
  }
});

test('a model failure after redemption is a 502 and the token stays spent', async () => {
  const failing: Responder = async () => { throw new UpstreamError(502, 'model unreachable'); };
  const s = await stack(failing);
  try {
    const res = await s.sdk.fetch(s.ask, post('q'), payer);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'model_unavailable');
    assert.equal(s.origin.stats().redeemed, 1);
  } finally {
    await s.close();
  }
});

test('info, unknown paths and wrong methods', async () => {
  const s = await stack();
  try {
    const info = await (await fetch(`${s.api.url}/`)).json();
    assert.equal(info.simulated, true);
    assert.match(info.price, /100 calls for 0\.001 TAZ/);
    assert.equal((await fetch(`${s.api.url}/admin`)).status, 404);
    assert.equal((await fetch(s.ask)).status, 405);
  } finally {
    await s.close();
  }
});

test('claudeResponder sends no caller identity and handles refusals and failures', async () => {
  const sent: unknown[] = [];
  const reply = (stop: string, text: string) => ({ beta: { messages: { create: async (body: unknown) => {
    sent.push(body);
    return { model: 'claude-opus-5-5', stop_reason: stop, content: [{ type: 'text', text }] };
  } } } }) as unknown as MessagesClient;

  const ok = await claudeResponder(reply('end_turn', ' A short answer. '))('What is Zcash?');
  assert.deepEqual(ok, { text: 'A short answer.', simulated: false, model: 'claude-opus-5-5' });
  const body = sent[0] as Record<string, unknown>;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'What is Zcash?' }]);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal('metadata' in body, false, 'no user id upstream');

  const refused = await claudeResponder(reply('refusal', ''))('q');
  assert.equal(refused.refused, true);

  const broken = { beta: { messages: { create: async () => { throw new Error('socket hang up'); } } } } as unknown as MessagesClient;
  await assert.rejects(claudeResponder(broken)('q'), (e: unknown) => e instanceof UpstreamError && e.status === 502);
});

test('without credentials the responder is the labeled canned one', async () => {
  const answer = await responderFromEnv({})('hello');
  assert.equal(answer.simulated, true);
  assert.equal(answer.model, null);
});

test('panel: both sides, no join key, the anonymity set, nothing external', async () => {
  const s = await stack();
  try {
    assert.equal((await s.sdk.fetch(s.ask, post('q'), payer)).status, 200);
    const stats = await panelStats({ origin: s.origin, issuerDataDir, scannerUrl: scanner.url, pack: PACK, simulated: true });
    assert.ok(stats.issuer.paid >= 1);
    assert.equal(stats.issuer.tokens_issued, stats.issuer.paid * PACK);
    assert.equal(stats.origin.redeemed, 1);
    assert.match(stats.anonymity_set.statement, /one of \d+ tokens from \d+ purchase/);
    for (const p of stats.issuer.purchases) assert.match(p.id, /^[0-9a-f]{8}\.\.\.$/);
    // The origin side carries counts only: no nonce, no token, no purchase.
    assert.deepEqual(Object.keys(stats.origin).sort(), ['challenged', 'redeemed', 'refused']);

    const page = await fetch(`${s.panel.url}/panel`);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.ok(!/(src|href)\s*=\s*["']?https?:/i.test(PANEL_PAGE), 'no external resources');
    assert.ok(!/@import|url\(/i.test(PANEL_PAGE), 'no external styles or fonts');
  } finally {
    await s.close();
  }
});

test('a browser on the web origin can read the 402, stats and health; others cannot', async () => {
  const s = await stack();
  try {
    const res = await fetch(s.ask, { method: 'POST', headers: { origin: WEB_ORIGIN } });
    assert.equal(res.status, 402);
    assert.equal(res.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /WWW-Authenticate, Fare-Offer, Retry-After/);
    const other = await fetch(s.ask, { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);

    const pre = await fetch(s.ask, {
      method: 'OPTIONS',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
    });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);

    // One redemption and one refusal, then the public counts.
    const challenge = await s.sdk.acceptChallenge(res.headers.get('www-authenticate'));
    await payer();
    const purchase = await s.sdk.order(challenge, { pack: PACK, price_zec: '0.001', issuer: issuer.url });
    await payer();
    await s.sdk.collect(purchase);
    const auth = s.sdk.spend(challenge)!;
    assert.equal((await fetch(s.ask, { ...post('one'), headers: { authorization: auth, 'content-type': 'application/json' } })).status, 200);
    assert.equal((await fetch(s.ask, { ...post('two'), headers: { authorization: auth, 'content-type': 'application/json' } })).status, 401);
    const stats = await (await fetch(`${s.api.url}/v1/stats`)).json();
    assert.deepEqual(Object.keys(stats).sort(), ['challenged', 'redeemed', 'refused', 'spent_by_key']);
    assert.equal(stats.redeemed, 1);
    assert.equal(stats.refused.token_reused, 1);
    assert.deepEqual(Object.values(stats.spent_by_key), [1]);
    assert.ok(!JSON.stringify(stats).includes(purchase.purchase_id));

    const health = await (await fetch(`${s.api.url}/health`)).json();
    assert.equal(health.model, 'simulated');
    assert.match(health.key_id, /^[0-9a-f]{64}$/);
    assert.ok(health.key_id.startsWith(Object.keys(stats.spent_by_key)[0]));
  } finally {
    await s.close();
  }
});

test('failingOn fails only prompts carrying the marker', async () => {
  const r = failingOn('#fail', cannedResponder());
  assert.equal((await r('fine')).simulated, true);
  await assert.rejects(r('please #fail'), UpstreamError);
});

test('demo sources log no request data', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['server.ts', 'panel.ts', 'llm.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), `${f} logs`);
    assert.ok(!/remoteAddress|user-agent|x-forwarded-for/i.test(src), `${f} reads client identity`);
  }
});
