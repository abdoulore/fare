// /try: ask, buy, pay, wait, use. Tokens are blinded and unblinded in this browser; the
// issuer sees blinded requests, the API sees tokens, and neither sees both.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  b64url,
  FareCore,
  parseOffer,
  UnpinnedKeyError,
  type DirectoryKey,
  type MemoryFareClient,
  type Offer,
  type PendingPurchase,
  type WWWAuthenticateHeader,
} from '../../../sdk/src/core.ts';
import { Copy } from '../components/Copy.tsx';
import { Qr } from '../components/Qr.tsx';
import { demoPay, payerRefusal, type DemoPayment } from '../lib/api.ts';
import { API_URL, EXPLORER_TX } from '../lib/config.ts';
import { createClient, groupTokens, keyIdOf, openStore, swapChallengeKey, type TokenGroup } from '../lib/fare.ts';
import type { TokenStore } from '../lib/store.ts';
import { refusalText, STEPS, viewStatus, type StepView } from '../lib/status.ts';
import { Link } from '../router.tsx';

interface Probe {
  code: number;
  offer?: Offer;
  keyId: string;
  /** Set when the key matched the pinned, published one. */
  challenge?: WWWAuthenticateHeader;
  refused?: string;
}

interface Exchange {
  id: number;
  prompt: string;
  kind: 'answer' | 'refused' | 'model_failed' | 'error';
  text: string;
  simulated?: boolean;
  replay?: boolean;
}

const POLL_MS = 5_000;
const challengeId = (c: WWWAuthenticateHeader) => b64url(c.challenge.serialize());
const ask = (prompt: string, auth?: string) =>
  fetch(`${API_URL}/v1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ prompt }),
  });

function Txid({ txid }: { txid: string }) {
  return EXPLORER_TX ? (
    <a className="mono break" href={`${EXPLORER_TX}${txid}`} rel="noreferrer noopener" target="_blank">
      {txid}
    </a>
  ) : (
    <span className="mono break">{txid}</span>
  );
}

function elapsed(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Try() {
  const [store, setStore] = useState<TokenStore>();
  const [persistent, setPersistent] = useState(true);
  const [client, setClient] = useState<MemoryFareClient>();
  const [directory, setDirectory] = useState<DirectoryKey[]>([]);
  const [setupError, setSetupError] = useState<string>();
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [prompt, setPrompt] = useState('What does a shielded Zcash payment hide?');
  const [tamper, setTamper] = useState(false);
  const [probe, setProbe] = useState<Probe>();
  const [busy, setBusy] = useState(false);

  const [blinding, setBlinding] = useState<{ done: number; total: number; ms?: number }>();
  const [orderError, setOrderError] = useState<string>();
  const [purchase, setPurchase] = useState<PendingPurchase>();

  const [payment, setPayment] = useState<DemoPayment>();
  const [payError, setPayError] = useState<string>();
  const [paying, setPaying] = useState(false);
  const [waitFrom, setWaitFrom] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<StepView>();
  const [warning, setWarning] = useState<string>();
  const [issued, setIssued] = useState<number>();

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [lastAuth, setLastAuth] = useState<string>();
  const [groups, setGroups] = useState<TokenGroup[]>([]);
  const [counterTick, setCounterTick] = useState(0);
  const nextId = useRef(1);

  // Open the store, load the client and pin the issuer key from the published directory.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { store, persistent } = await openStore();
        const c = await createClient(store);
        await c.pin();
        const dir = await c.directory();
        if (!alive) return;
        setStore(store);
        setPersistent(persistent);
        setClient(c);
        setDirectory(dir);
      } catch (e) {
        if (alive) setSetupError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refreshGroups = useCallback(async () => {
    if (!client) return;
    setGroups(await groupTokens(client.snapshot().tokens, directory));
  }, [client, directory]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  const tokens = client?.tokenCount() ?? 0;
  const challengeKey = probe?.challenge ? challengeId(probe.challenge) : undefined;
  const usable = client && challengeKey ? client.tokenCount(challengeKey) : 0;

  // Step 4: poll the issuer until the purchase is paid or can never be.
  useEffect(() => {
    if (!client || !purchase || issued !== undefined) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await client.poll(purchase);
        if (!alive) return;
        const view = viewStatus(s.status);
        setStatus(view);
        if (s.status === 'paid') {
          if (s.warning) setWarning(s.warning);
          const n = await client.finish(purchase, s);
          if (!alive) return;
          setIssued(n);
          setCounterTick((t) => t + 1);
          await refreshGroups();
          rerender();
          return;
        }
        if (FareCore.final(s)) return;
      } catch (e) {
        if (!alive) return;
        setStatus({ step: 0, label: 'issuer unreachable', tone: 'wait', final: false, detail: (e as Error).message });
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, purchase, issued, refreshGroups]);

  // The wait timer.
  useEffect(() => {
    if (waitFrom === undefined || issued !== undefined || status?.final) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitFrom, issued, status]);

  async function spendAndAsk(c: MemoryFareClient, challenge: WWWAuthenticateHeader, text: string): Promise<void> {
    const auth = await c.spend(challenge);
    if (!auth) return;
    setCounterTick((t) => t + 1);
    rerender();
    setLastAuth(auth);
    const res = await ask(text, auth).catch(() => undefined);
    const body = res ? ((await res.json().catch(() => ({}))) as { answer?: string; simulated?: boolean; error?: string; detail?: string }) : {};
    const id = nextId.current++;
    let ex: Exchange;
    if (res?.status === 200) ex = { id, prompt: text, kind: 'answer', text: body.answer ?? '', simulated: body.simulated };
    else if (res?.status === 401) ex = { id, prompt: text, kind: 'refused', text: `401 ${body.error}: ${refusalText(body.error ?? '')}` };
    else if (res && res.status >= 500 && body.error === 'model_unavailable')
      ex = {
        id,
        prompt: text,
        kind: 'model_failed',
        text: `${res.status} model_unavailable. Your token was spent before the model ran. Fare cannot refund it: a refund would link the token to you.`,
      };
    else ex = { id, prompt: text, kind: 'error', text: res ? `${res.status} ${body.error ?? ''}` : 'The API is not reachable. Your token was spent.' };
    setExchanges((list) => [ex, ...list]);
    await refreshGroups();
  }

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    if (!client || busy || !prompt.trim()) return;
    setBusy(true);
    try {
      const res = await ask(prompt);
      if (res.status !== 402) {
        setProbe({ code: res.status, keyId: '', refused: `Expected 402 without a token, got ${res.status}.` });
        return;
      }
      let header = res.headers.get('www-authenticate') ?? '';
      if (tamper) header = await swapChallengeKey(header);
      const offer = parseOffer(res.headers.get('fare-offer'));
      const presented = /token-key="?([A-Za-z0-9_-]+)/.exec(header)?.[1] ?? '';
      const keyId = presented ? await keyIdOf(presented) : '';
      try {
        const challenge = await client.acceptChallenge(header);
        setProbe({ code: 402, offer, keyId, challenge });
        if (client.tokenCount(challengeId(challenge)) > 0) await spendAndAsk(client, challenge, prompt);
      } catch (err) {
        const why =
          err instanceof UnpinnedKeyError
            ? 'This key is not in the issuer directory this browser pinned. A per-visitor key would let the API recognise you, so Fare refuses before ordering anything.'
            : (err as Error).message;
        setProbe({ code: 402, offer, keyId, refused: why });
      }
    } catch {
      setProbe({ code: 0, keyId: '', refused: 'The API is not reachable.' });
    } finally {
      setBusy(false);
    }
  }

  async function onBuy() {
    if (!client || !probe?.challenge || !probe.offer) return;
    setOrderError(undefined);
    setBusy(true);
    const t0 = performance.now();
    setBlinding({ done: 0, total: probe.offer.pack });
    try {
      let last = 0;
      const p = await client.order(probe.challenge, probe.offer, (done, total) => {
        if (done === total || done - last >= 5) {
          last = done;
          setBlinding({ done, total });
        }
      });
      setBlinding({ done: probe.offer.pack, total: probe.offer.pack, ms: Math.round(performance.now() - t0) });
      setPurchase(p);
      setStatus(viewStatus('pending'));
    } catch (e) {
      setOrderError((e as Error).message);
      setBlinding(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function onDemoPay(mode: 'full' | 'half') {
    if (!purchase) return;
    setPayError(undefined);
    setPaying(true);
    setWaitFrom(Date.now());
    try {
      setPayment(await demoPay(purchase.pay_uri, mode));
    } catch (e) {
      setPayError(payerRefusal((e as Error).message));
      setWaitFrom(undefined);
    } finally {
      setPaying(false);
    }
  }

  async function onUse(e: FormEvent) {
    e.preventDefault();
    if (!client || !probe?.challenge || busy || !prompt.trim()) return;
    setBusy(true);
    try {
      await spendAndAsk(client, probe.challenge, prompt);
    } finally {
      setBusy(false);
    }
  }

  async function onReplay() {
    if (!lastAuth || busy) return;
    setBusy(true);
    try {
      const res = await ask('replay of my last token', lastAuth).catch(() => undefined);
      const body = res ? ((await res.json().catch(() => ({}))) as { error?: string; answer?: string }) : {};
      const id = nextId.current++;
      const ex: Exchange =
        res?.status === 401
          ? { id, prompt: 'Replay of my last token', kind: 'refused', text: `401 ${body.error}: ${refusalText(body.error ?? '')}`, replay: true }
          : { id, prompt: 'Replay of my last token', kind: 'error', text: res ? `Unexpected ${res.status}` : 'The API is not reachable.', replay: true };
      setExchanges((list) => [ex, ...list]);
    } finally {
      setBusy(false);
    }
  }

  async function onForget() {
    if (!client || !store) return;
    await client.forget();
    await store.clear();
    await client.pin();
    setGroups([]);
    setLastAuth(undefined);
    rerender();
  }

  function reset() {
    setPurchase(undefined);
    setPayment(undefined);
    setPayError(undefined);
    setWaitFrom(undefined);
    setStatus(undefined);
    setIssued(undefined);
    setBlinding(undefined);
    setWarning(undefined);
  }

  if (setupError) {
    return (
      <div className="refusal" role="alert">
        <strong>Cannot start.</strong> {setupError}
      </div>
    );
  }

  const asked = probe !== undefined;
  const challengeOk = Boolean(probe?.challenge);
  const ordered = purchase !== undefined;
  const paid = issued !== undefined;
  const canUse = usable > 0;
  const dead = status?.final === true;
  const stepClass = (n: number) => {
    const reached = [true, challengeOk, ordered, ordered && (payment !== undefined || status !== undefined), paid || canUse][n - 1];
    const finished = [challengeOk, ordered, payment !== undefined || (status?.step ?? 0) > 0, paid, false][n - 1];
    return finished ? 'done' : reached ? 'active' : 'locked';
  };

  return (
    <>
      <h1>Try it</h1>
      <p className="lede">
        Buy 100 calls for 0.001 TAZ (testnet), then ask questions. Your tokens are made in this browser; the server signs them without seeing them.
      </p>
      {!client && <p aria-live="polite">Pinning the issuer key…</p>}

      <ol className="steps">
        <li className={canUse ? 'done' : stepClass(1)}>
          <h2>Ask</h2>
          <form onSubmit={onAsk} className="stack">
            <div>
              <label htmlFor="prompt">Question</label>
              <textarea id="prompt" value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} />
            </div>
            <div className="row">
              <button type="submit" className={canUse ? undefined : 'primary'} disabled={!client || busy}>
                {canUse ? 'Ask again without a token' : 'Ask without a token'}
              </button>
              <label className="row muted" htmlFor="tamper">
                <input id="tamper" type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
                Simulate a malicious API that swaps the challenge key
              </label>
            </div>
          </form>
          {probe && (
            <div className="panel stack" data-testid="probe" aria-live="polite">
              <div className="row">
                <span className="badge accent mono">{probe.code === 0 ? 'no answer' : `${probe.code} Payment Required`}</span>
                {probe.challenge && <span className="badge paid">key matches the published directory</span>}
                {probe.refused && <span className="badge refused">refused</span>}
              </div>
              {probe.offer && (
                <dl className="kv">
                  <dt>Offer</dt>
                  <dd className="mono">
                    {probe.offer.pack} calls for {probe.offer.price_zec} TAZ
                  </dd>
                  <dt>Issuer key id</dt>
                  <dd className="mono break">{probe.keyId}</dd>
                </dl>
              )}
              {probe.refused && (
                <div className="refusal" role="alert" data-testid="key-refused">
                  <strong>Refused.</strong> {probe.refused}
                </div>
              )}
            </div>
          )}
        </li>

        <li className={canUse && !ordered ? 'done' : stepClass(2)}>
          <h2>Buy</h2>
          {canUse && !ordered ? (
            <p className="muted">You already hold tokens for this API.</p>
          ) : (
            <div className="stack">
              <button type="button" className="primary" onClick={() => void onBuy()} disabled={!challengeOk || ordered || busy}>
                Buy {probe?.offer?.pack ?? 100} calls
              </button>
              {blinding && (
                <div aria-live="polite">
                  <progress max={blinding.total} value={blinding.done} aria-label="Blinding tokens" />
                  <p className="muted mono">
                    blinded {blinding.done} of {blinding.total} nonces in this browser{blinding.ms !== undefined ? `, ${blinding.ms} ms` : ''}
                  </p>
                </div>
              )}
              {orderError && (
                <div className="refusal" role="alert">
                  <strong>Order refused.</strong> {orderError}
                </div>
              )}
              {purchase && (
                <div className="panel" data-testid="order">
                  <dl className="kv">
                    <dt>Pay to</dt>
                    <dd className="mono break">{purchase.pay_uri.slice(6, purchase.pay_uri.indexOf('?'))}</dd>
                    <dt>Amount</dt>
                    <dd className="mono">{probe?.offer?.price_zec} TAZ</dd>
                    <dt>Expires</dt>
                    <dd className="mono">{new Date(purchase.expires_at).toUTCString()}</dd>
                  </dl>
                  <p className="note">
                    A fresh shielded-only address, made for this purchase alone. The purchase id stays in this tab, and so does the blinding state: keep the tab open until your
                    tokens arrive.
                  </p>
                </div>
              )}
            </div>
          )}
        </li>

        <li className={canUse && !ordered ? 'done' : stepClass(3)}>
          <h2>Pay</h2>
          {purchase && !paid && !dead && (
            <div className="pay-options">
              <div className="panel stack">
                <h3>Use the demo payer</h3>
                <p>
                  <strong>Paid by Fare's demo wallet.</strong> In real use the payer is you, and Fare never sees your wallet.
                </p>
                <div className="row">
                  <button type="button" className="primary" onClick={() => void onDemoPay('full')} disabled={paying || payment !== undefined}>
                    {paying ? 'Paying… (building the proof)' : 'Pay 0.001 TAZ with the demo payer'}
                  </button>
                  <button type="button" onClick={() => void onDemoPay('half')} disabled={paying || payment !== undefined}>
                    Pay half (shows underpaid)
                  </button>
                </div>
                {payment && (
                  <div className="ok" data-testid="demo-paid">
                    <strong>Sent {payment.amount_zec} TAZ.</strong> Paid by the demo wallet, not by you.
                    {payment.txids.map((t) => (
                      <div key={t}>
                        txid <Txid txid={t} />
                      </div>
                    ))}
                  </div>
                )}
                {payError && (
                  <div className="refusal" role="alert">
                    <strong>Demo payer refused.</strong> {payError}
                  </div>
                )}
              </div>
              <div className="panel stack">
                <h3>Pay from your own wallet</h3>
                <Qr text={purchase.pay_uri} label="QR code of the payment request" />
                <p className="mono break">{purchase.pay_uri}</p>
                <div className="row">
                  <Copy text={purchase.pay_uri} label="Copy payment request" />
                  <button type="button" className="link" onClick={() => setWaitFrom((w) => w ?? Date.now())}>
                    I paid it
                  </button>
                </div>
                <p className="muted">Pay from a shielded testnet balance, in a wallet that supports Ironwood (NU6.3). No memo needed; the address identifies the purchase.</p>
              </div>
            </div>
          )}
          {paid && <p className="muted">Paid.</p>}
        </li>

        <li className={stepClass(4)}>
          <h2>Wait</h2>
          {status && (
            <div className="panel" aria-live="polite" data-testid="status">
              {status.step >= 0 ? (
                <div className="track" aria-hidden="true">
                  {STEPS.map((s, i) => (
                    <span key={s} className={i < status.step ? 'reached' : i === status.step ? (status.tone === 'paid' ? 'paidnow' : 'now') : undefined}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>
                <span className={`badge ${status.tone === 'paid' ? 'paid' : status.tone === 'refused' ? 'refused' : 'accent'}`} data-testid="status-label">
                  {status.label}
                </span>{' '}
                {status.detail}
              </p>
              {waitFrom !== undefined && !paid && !dead && (
                <p className="mono muted">
                  waiting {elapsed(waitFrom, now)} · one confirmation takes about 75 s
                </p>
              )}
              {dead && (
                <div className="refusal" role="alert" data-testid="dead">
                  <strong>No tokens.</strong> {status.detail}{' '}
                  <button type="button" className="link" onClick={reset}>
                    Start a new purchase
                  </button>
                </div>
              )}
              {warning && (
                <div className="refusal" role="alert">
                  <strong>Flagged.</strong> This payment spent transparent inputs, which exposed the payer's own address on chain.
                </div>
              )}
            </div>
          )}
        </li>

        <li className={canUse ? 'active' : 'locked'}>
          <h2>Use</h2>
          <div className="stack">
            <div className="row">
              <div>
                <div key={counterTick} className="counter tick" data-testid="tokens-left" aria-live="polite">
                  {usable}
                </div>
                <div className="muted">tokens left for this API</div>
              </div>
            </div>
            {paid && <p className="ok"><strong>{issued} tokens unblinded in this browser.</strong> The issuer signed them without seeing them.</p>}
            <form onSubmit={onUse} className="row">
              <button type="submit" className="primary" disabled={!canUse || busy}>
                Ask with one token
              </button>
              <button type="button" onClick={() => void onReplay()} disabled={!lastAuth || busy}>
                Replay my last token
              </button>
            </form>
            {exchanges.length > 0 && (
              <ul className="answers" data-testid="answers">
                {exchanges.map((x) => (
                  <li key={x.id}>
                    <div className="q">{x.prompt}</div>
                    {x.kind === 'answer' ? (
                      <p>
                        {x.simulated && <span className="badge sim">simulated</span>} {x.text.replace(/^\[simulated\]\s*/, '')}
                      </p>
                    ) : (
                      <div className={`refusal${x.replay && x.id === exchanges[0].id ? ' shake' : ''}`} role="alert" data-testid={x.replay ? 'replay-refused' : 'call-refused'}>
                        <strong>{x.kind === 'model_failed' ? 'Model failed.' : 'Refused.'}</strong> {x.text}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      </ol>

      <section className="panel stack" aria-labelledby="mine">
        <h2 id="mine">Tokens in this browser</h2>
        <p className="mono" data-testid="tokens-total">
          {tokens} unspent
        </p>
        {groups.map((g) => (
          <p key={g.keyId} className="mono muted">
            {g.count} under key {g.keyId.slice(0, 12)},{' '}
            {g.retiresAt ? `usable until ${new Date(g.retiresAt * 1000).toUTCString()}` : 'key no longer listed'}
          </p>
        ))}
        <p className="muted">
          Stored in this browser's IndexedDB{persistent ? '' : ' (unavailable here, so only for this tab)'}. They leave it one at a time, each inside a single call.
        </p>
        <div className="row">
          <button type="button" onClick={() => void onForget()} disabled={!client}>
            Forget my tokens
          </button>
          <Link to="/server">See what the server saw</Link>
        </div>
      </section>
    </>
  );
}

