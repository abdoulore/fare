// /app: the buyer's working screen. The price is checked on load; buying is three steps
// (buy, pay, wait); once tokens exist the screen is an ask box beside the buyer's own pane
// of stamps, each spent token cancelled. The cryptography and the refusal tests sit in
// their own disclosures, away from the normal path.
// Tokens are blinded and unblinded in this browser; the issuer sees blinded requests, the
// API sees tokens, and neither sees both. An order is saved in this browser before it is
// paid, so a reload or a closed tab resumes it; other tabs are told when tokens change.

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
  b64url,
  FareCore,
  parseOffer,
  UnpinnedKeyError,
  type DirectoryKey,
  type Offer,
  type PendingPurchase,
  type WWWAuthenticateHeader,
} from '../../../sdk/src/core.ts';
import { Copy } from '../components/Copy.tsx';
import { Pane } from '../components/Pane.tsx';
import { Postmark } from '../components/Postmark.tsx';
import { Qr } from '../components/Qr.tsx';
import { demoPay, payerRefusal, type DemoPayment } from '../lib/api.ts';
import { API_URL, EXPLORER_TX } from '../lib/config.ts';
import { createClient, groupTokens, keyIdOf, keyRetiresAt, openStore, swapChallengeKey, type TokenGroup } from '../lib/fare.ts';
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

const utc = (unixSeconds: number) => new Date(unixSeconds * 1000).toUTCString().replace(':00 GMT', ' UTC');

function elapsed(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Use() {
  const [persistent, setPersistent] = useState(true);
  const [client, setClient] = useState<FareCore>();
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

  const [elsewhere, setElsewhere] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [replay, setReplay] = useState<Exchange>();

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [lastAuth, setLastAuth] = useState<string>();
  const [groups, setGroups] = useState<TokenGroup[]>([]);
  const [counterTick, setCounterTick] = useState(0);
  const nextId = useRef(1);
  const [confirmForget, setConfirmForget] = useState(false);
  const payHeading = useRef<HTMLHeadingElement>(null);
  const waitHeading = useRef<HTMLHeadingElement>(null);
  const useHeading = useRef<HTMLHeadingElement>(null);

  // Open the store, load the client, pin the issuer key from the published directory, and
  // resume the newest saved order, if any. Another tab's changes refresh this one.
  const changedElsewhere = useRef<() => void>(() => undefined);
  useEffect(() => {
    let alive = true;
    let stop = () => undefined as void;
    void (async () => {
      try {
        const { store, persistent } = await openStore();
        const c = await createClient(store);
        await c.pin();
        const dir = await c.directory();
        if (!alive) return;
        stop = store.onChange(() => changedElsewhere.current());
        setPersistent(persistent);
        setClient(c);
        setDirectory(dir);
        const saved = c.pendingPurchases().at(-1);
        if (saved) {
          setPurchase(saved);
          setStatus(viewStatus('pending'));
          setResumed(true);
        }
      } catch (e) {
        if (alive) setSetupError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const refreshGroups = useCallback(async () => {
    if (!client) return;
    setGroups(await groupTokens(client.snapshot().tokens, directory));
  }, [client, directory]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  changedElsewhere.current = () => {
    if (!client) return;
    void client.refresh().then(() => {
      setCounterTick((t) => t + 1);
      rerender();
      void refreshGroups();
    });
  };

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
          // 0: another tab collected this order first; its tokens are already stored.
          if (n === 0) {
            await client.refresh();
            setElsewhere(true);
          }
          setIssued(n || purchase.blinds.length);
          setCounterTick((t) => t + 1);
          requestAnimationFrame(() => useHeading.current?.focus());
          await refreshGroups();
          rerender();
          return;
        }
        if (FareCore.final(s)) {
          await client.drop(purchase);
          return;
        }
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

  async function spendAndAsk(c: FareCore, challenge: WWWAuthenticateHeader, text: string): Promise<void> {
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

  /** Asks for a call with no token and checks the 402's key; returns the accepted challenge. */
  async function fetchChallenge(c: FareCore, text: string, swapKey: boolean): Promise<WWWAuthenticateHeader | undefined> {
    try {
      const res = await ask(text);
      if (res.status !== 402) {
        setProbe({ code: res.status, keyId: '', refused: `Expected 402 without a token, got ${res.status}.` });
        return undefined;
      }
      let header = res.headers.get('www-authenticate') ?? '';
      if (swapKey) header = await swapChallengeKey(header);
      const offer = parseOffer(res.headers.get('fare-offer'));
      const presented = /token-key="?([A-Za-z0-9_-]+)/.exec(header)?.[1] ?? '';
      const keyId = presented ? await keyIdOf(presented) : '';
      try {
        const challenge = await c.acceptChallenge(header);
        setProbe({ code: 402, offer, keyId, challenge });
        return challenge;
      } catch (err) {
        const why =
          err instanceof UnpinnedKeyError
            ? 'This key is not in the issuer directory this browser pinned. A per-visitor key would let the API recognise you, so Fare refuses before ordering anything.'
            : (err as Error).message;
        setProbe({ code: 402, offer, keyId, refused: why });
        return undefined;
      }
    } catch {
      setProbe({ code: 0, keyId: '', refused: 'The API is not reachable.' });
      return undefined;
    }
  }

  // Ask the API once without a token on load: that 402 is the price, and its key is checked
  // against the directory before anything can be ordered. Nothing is spent.
  const autoProbed = useRef(false);
  useEffect(() => {
    if (!client || autoProbed.current) return;
    autoProbed.current = true;
    void fetchChallenge(client, 'price check', false);
  }, [client]);

  /** The refusal test: ask without a token again, with the key swapped if `tamper` is on. */
  async function onProbe() {
    if (!client || busy) return;
    setBusy(true);
    try {
      await fetchChallenge(client, 'price check', tamper);
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
      requestAnimationFrame(() => payHeading.current?.focus());
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
      requestAnimationFrame(() => waitHeading.current?.focus());
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
      setReplay(
        res?.status === 401
          ? { id, prompt: 'Replay of my last token', kind: 'refused', text: `401 ${body.error}: ${refusalText(body.error ?? '')}`, replay: true }
          : { id, prompt: 'Replay of my last token', kind: 'error', text: res ? `Unexpected ${res.status}` : 'The API is not reachable.', replay: true },
      );
    } finally {
      setBusy(false);
    }
  }

  async function onForget() {
    if (!client) return;
    setConfirmForget(false);
    await client.forget();
    await client.pin();
    setGroups([]);
    setLastAuth(undefined);
    rerender();
  }

  function submitOnModEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  function reset() {
    // A dead order (expired, underpaid) is forgotten; a paid one already left the store.
    if (purchase && status?.final && client) void client.drop(purchase);
    setElsewhere(false);
    setResumed(false);
    setPurchase(undefined);
    setPayment(undefined);
    setPayError(undefined);
    setWaitFrom(undefined);
    setStatus(undefined);
    setIssued(undefined);
    setBlinding(undefined);
    setWarning(undefined);
  }

  // With IndexedDB the order survives a closed tab; without it, warn before leaving.
  const awaitingTokens = purchase !== undefined && issued === undefined && status?.final !== true;
  useEffect(() => {
    if (!awaitingTokens || persistent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [awaitingTokens, persistent]);

  if (setupError) {
    return (
      <div className="wrap app-head">
        <div className="refusal" role="alert">
          <strong>Cannot start.</strong> {setupError}
        </div>
      </div>
    );
  }

  const challengeOk = Boolean(probe?.challenge);
  const ordered = purchase !== undefined;
  const paid = issued !== undefined;
  const canUse = usable > 0;
  const dead = status?.final === true;
  const seenOnChain = (status?.step ?? 0) >= 1;
  const buying = !canUse || (ordered && !paid);
  const stepClass = (n: number) => {
    const reached = [true, ordered, ordered && (payment !== undefined || seenOnChain || resumed)][n - 1];
    const finished = [ordered, payment !== undefined || seenOnChain, paid][n - 1];
    if (n === 3 && dead) return 'dead';
    return finished ? 'done' : reached ? 'active' : 'locked';
  };
  // The buyer's own sheet: whole panes of 100, spent stamps cancelled.
  const sheetSize = Math.max(100, Math.ceil(tokens / 100) * 100);
  const pack = probe?.offer?.pack ?? 100;
  const price = probe?.offer?.price_zec ?? '0.001';
  // Tokens are accepted while their key is listed: its 7-day epoch plus 24 h of grace.
  const worksUntil = probe?.challenge ? keyRetiresAt(b64url(probe.challenge.tokenKey), directory) : undefined;

  const probePanel = probe && (
    <div className="stack probe" data-testid="probe" aria-live="polite">
      <div className="row">
        <span className="tag">{probe.code === 0 ? 'no answer' : `${probe.code} Payment Required`}</span>
        {probe.challenge && <span className="tag paid">key matches the published directory</span>}
        {probe.refused && <span className="tag refused">returned</span>}
      </div>
      {probe.offer && (
        <dl className="kv">
          <dt>Offer</dt>
          <dd className="mono">
            {probe.offer.pack} calls for {probe.offer.price_zec} TAZ
          </dd>
          <dt>Issuer key</dt>
          <dd className="mono break">{probe.keyId}</dd>
        </dl>
      )}
    </div>
  );
  const keyRefusal = probe?.refused && (
    <div className="refusal" role="alert" data-testid="key-refused">
      <strong>Returned.</strong> {probe.refused}
    </div>
  );

  return (
    <>
      <div className="masthead buyer">
        <div className="wrap">
          <h1>100 API calls, paid once</h1>
          <p className="lede">
            Pay {price} TAZ once and ask this API {pack} questions. Each call spends one token made in your browser: the API can check it, but cannot tie it to your
            payment or to your other calls.
          </p>
          <p className="selvage">
            <span>App</span>
            <span>Zcash testnet</span>
            <span>Tokens stay in this browser</span>
          </p>
          {!client && <p aria-live="polite">Checking the price and the issuer key…</p>}
        </div>
      </div>

      <div className="wrap app-grid">
        <div className="stack">
          {buying && (
            <section className="panel" aria-labelledby="buy-h">
              <h2 id="buy-h">Buy {pack} calls</h2>
              <dl className="offer" data-testid="offer">
                <div>
                  <dt>Price</dt>
                  <dd>{price} TAZ, paid once</dd>
                </div>
                <div>
                  <dt>Calls</dt>
                  <dd>{pack}, one token each</dd>
                </div>
                <div>
                  <dt>Tokens work until</dt>
                  <dd data-testid="works-until">{worksUntil ? utc(worksUntil) : probe?.refused ? 'not offered' : 'checking…'}</dd>
                </div>
              </dl>
              <p className="muted">
                Zcash testnet: TAZ has no value. Tokens are tied to this week's issuer key, so they stop working on the date above, whenever you buy.
              </p>
              {keyRefusal}
              <ol className="steps">
                <li className={stepClass(1)}>
                  <h3>Buy</h3>
                  <div className="stack">
                    <button type="button" className="primary" onClick={() => void onBuy()} disabled={!challengeOk || ordered || busy}>
                      Buy {pack} calls
                    </button>
                    {blinding && !ordered && (
                      <div aria-live="polite">
                        <progress max={blinding.total} value={blinding.done} aria-label="Preparing your tokens" />
                        <p className="muted">
                          Preparing your {blinding.total} tokens in this browser: {blinding.done} of {blinding.total}
                        </p>
                      </div>
                    )}
                    {orderError && (
                      <div className="refusal" role="alert">
                        <strong>Order refused.</strong> {orderError}
                      </div>
                    )}
                    {purchase && (
                      <div data-testid="order">
                        <p>
                          {resumed ? 'Your order from your last visit.' : 'Order placed.'} Pay within 24 hours, by {new Date(purchase.expires_at).toUTCString().replace(':00 GMT', ' UTC')}.
                        </p>
                        {!paid && (
                          <p className="muted">
                            {persistent
                              ? 'You can close this page: the order is saved in this browser, and your tokens are collected when you come back.'
                              : 'Keep this tab open until your tokens arrive: this browser cannot save the order.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
                <li className={stepClass(2)}>
                  <h3 ref={payHeading} tabIndex={-1}>
                    Pay
                  </h3>
                  {purchase && !paid && !dead && !seenOnChain && (
                    <div className="stack">
                      {resumed && payment === undefined && <p className="muted">If you already paid, there is nothing to do: the payment is picked up from the chain.</p>}
                      <p>
                        <strong>Fare's demo wallet can pay for you.</strong> In real use you pay from your own wallet, and Fare never sees it.
                      </p>
                      <div className="row">
                        <button type="button" className="primary" onClick={() => void onDemoPay('full')} disabled={paying || payment !== undefined}>
                          {paying ? 'Paying… (building the proof)' : `Pay ${price} TAZ with the demo payer`}
                        </button>
                      </div>
                      {payError && (
                        <div className="refusal" role="alert">
                          <strong>Demo payer refused.</strong> {payError}
                        </div>
                      )}
                      <details className="more">
                        <summary>Pay from your own wallet instead</summary>
                        <div className="row">
                          <Qr text={purchase.pay_uri} label="QR code of the payment request" />
                          <div className="stack">
                            <p className="mono break">{purchase.pay_uri}</p>
                            <div className="row">
                              <Copy text={purchase.pay_uri} label="Copy payment request" />
                              <button type="button" className="link" onClick={() => setWaitFrom((w) => w ?? Date.now())}>
                                I paid it
                              </button>
                            </div>
                            <p className="muted">
                              From a shielded testnet balance, in a wallet that supports Ironwood (NU6.3). The address is fresh, for this purchase alone; no memo is needed.
                            </p>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                  {payment && !paid && (
                    <div className="ok" data-testid="demo-paid">
                      <strong>Sent {payment.amount_zec} TAZ.</strong> Paid by the demo wallet, not by you.
                      {payment.txids.map((t) => (
                        <div key={t}>
                          txid <Txid txid={t} />
                        </div>
                      ))}
                    </div>
                  )}
                  {payment && (paid || dead) && (
                    <p className="mono muted" data-testid="payment-receipt">
                      sent {payment.amount_zec} TAZ by the demo wallet{payment.txids.length > 0 ? ', txid ' : ''}
                      {payment.txids.map((t) => (
                        <Txid key={t} txid={t} />
                      ))}
                    </p>
                  )}
                </li>
                <li className={stepClass(3)}>
                  <h3 ref={waitHeading} tabIndex={-1}>
                    Wait for one confirmation
                  </h3>
                  {status && (payment !== undefined || waitFrom !== undefined || resumed || seenOnChain || dead) && (
                    <div data-testid="status">
                      {status.step >= 0 && (
                        <div className="track" aria-hidden="true">
                          {STEPS.map((s, i) => (
                            <span key={s} className={i < status.step ? 'reached' : i === status.step ? (status.tone === 'paid' ? 'paidnow' : 'now') : undefined}>
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      <p aria-live="polite">
                        <span className={`tag ${status.tone === 'paid' ? 'paid' : status.tone === 'refused' ? 'refused' : ''}`} data-testid="status-label">
                          {status.label}
                        </span>{' '}
                        {status.detail}
                      </p>
                      {waitFrom !== undefined && !paid && !dead && (
                        <p className="mono muted" aria-live="off">
                          waiting {elapsed(waitFrom, now)} · about 75 s per confirmation
                        </p>
                      )}
                      {dead && (
                        <div className="refusal" role="alert" data-testid="dead">
                          <strong>No tokens from this purchase.</strong>{' '}
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
              </ol>
              <details className="more">
                <summary>What happens in your browser</summary>
                <div className="stack">
                  <p>
                    Before anything is ordered, the API's 402 is checked: its issuer key must be the one the issuer publishes, so the API cannot hand you a key of your own.
                  </p>
                  {probePanel}
                  {blinding && (
                    <p className="muted mono">
                      blinded {blinding.done} of {blinding.total} in this browser{blinding.ms !== undefined ? `, ${blinding.ms} ms` : ''}
                    </p>
                  )}
                  <p className="muted">
                    Your browser makes {pack} random tokens and blinds them. The issuer signs the blinded tokens once the payment has one confirmation, and your browser unblinds the
                    signatures. The issuer never sees a token, so no call can be matched to this payment.
                  </p>
                </div>
              </details>
            </section>
          )}

          <section className="panel" aria-labelledby="use-h">
            <h2 id="use-h" ref={useHeading} tabIndex={-1}>
              Ask
            </h2>
            {paid && (
              <p className="ok">
                <strong>
                  {elsewhere ? `${issued} calls ready, collected in another tab.` : `${issued} calls ready.`}
                </strong>{' '}
                Your browser unblinded the tokens; the issuer never saw them.
              </p>
            )}
            {!canUse && !paid && <p className="muted">Your questions go here once you hold tokens.</p>}
            <form onSubmit={onUse} className="stack">
              {canUse && (
                <div>
                  <label htmlFor="prompt-use">Question</label>
                  <textarea id="prompt-use" value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} onKeyDown={submitOnModEnter} />
                </div>
              )}
              <div className="row">
                <button type="submit" className="primary" disabled={!canUse || busy}>
                  Ask with one token
                </button>
              </div>
            </form>
            {exchanges.length > 0 && (
              <ul className="answers" data-testid="answers">
                {exchanges.map((x) => (
                  <li key={x.id}>
                    <div className="q">{x.prompt}</div>
                    {x.kind === 'answer' ? (
                      <p>
                        {x.simulated && <span className="tag sim">simulated</span>} {x.text.replace(/^\[simulated\]\s*/, '')}
                      </p>
                    ) : (
                      <div className="refusal" role="alert" data-testid="call-refused">
                        <strong>{x.kind === 'model_failed' ? 'Model failed.' : 'Refused.'}</strong> {x.text}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="more refusals">
            <summary>Test the refusals</summary>
            <div className="stack">
              <p>Fare shows what it refuses, not only what works. None of these is part of normal use.</p>
              <div className="stack">
                <h3>Replay a spent token</h3>
                <p className="muted">Sends the last token again. The API answers 401 token_reused: each token works once.</p>
                <div className="row">
                  <button type="button" onClick={() => void onReplay()} disabled={!lastAuth || busy}>
                    Replay my last token
                  </button>
                </div>
                {replay?.kind === 'refused' && (
                  <div key={replay.id} className="bounce">
                    <Postmark top="ALREADY CANCELLED" bottom="TOKEN REUSED" center="401" tone="refused" strike size={110} label="Replay refused: this token was already spent" />
                  </div>
                )}
                {replay && (
                  <div className="refusal" role="alert" data-testid="replay-refused">
                    <strong>{replay.kind === 'refused' ? 'Already cancelled.' : 'Replay.'}</strong> {replay.text}
                  </div>
                )}
              </div>
              <div className="stack">
                <h3>A malicious API</h3>
                <label className="check" htmlFor="tamper">
                  <input id="tamper" type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
                  Simulate a malicious API that swaps the challenge key
                </label>
                <p className="muted">Then ask without a token: the browser refuses before ordering, because a key the directory does not list could single you out.</p>
                <div className="row">
                  <button type="button" onClick={() => void onProbe()} disabled={!client || busy}>
                    Ask without a token
                  </button>
                </div>
              </div>
              <div className="stack">
                <h3>Underpay</h3>
                <p className="muted">Pays half the price: the purchase stays postage due and no tokens are signed.</p>
                {purchase && !paid && !dead && payment === undefined && !seenOnChain ? (
                  <div className="row">
                    <button type="button" onClick={() => void onDemoPay('half')} disabled={paying}>
                      Pay half (shows underpaid)
                    </button>
                  </div>
                ) : (
                  <p className="muted">Available after you place an order and before you pay it.</p>
                )}
              </div>
            </div>
          </details>
        </div>

        <aside className="stack" aria-label="Your tokens">
          <section className="panel" aria-labelledby="mine">
            <h2 id="mine">Your sheet</h2>
            <div className="counter" aria-live="polite" aria-atomic="true">
              <span key={counterTick} className="tick" data-testid="tokens-left">
                {usable}
              </span>
            </div>
            <p className="muted">calls left on this API</p>
            {tokens > 0 ? (
              <Pane large issued={sheetSize} spent={sheetSize - tokens} label={`Your sheet: ${tokens} unspent of ${sheetSize}`} />
            ) : (
              <Pane large blank issued={100} spent={0} label={paid ? 'No tokens left' : 'An empty sheet: 100 stamps, signed once your payment confirms'} />
            )}
            <p className="mono" data-testid="tokens-total">
              {tokens} unspent
            </p>
            {groups.map((g) => (
              <p key={g.keyId} className="muted">
                {g.retiresAt ? `Work until ${utc(g.retiresAt)}` : 'Their key is no longer listed: the API will refuse them.'}
                {groups.length > 1 ? ` (${g.count} under key ${g.keyId.slice(0, 12)})` : ''}
              </p>
            ))}
            <p className="muted">
              Kept in this browser's IndexedDB{persistent ? ', shared by its tabs' : ' (unavailable here, so only for this tab)'}. They leave it one at a time, each inside a single call.
            </p>
            <div className="row">
              {confirmForget ? (
                <span className="confirm" role="group" aria-label="Confirm forgetting tokens">
                  <span>
                    Delete {tokens} unspent {tokens === 1 ? 'token' : 'tokens'}? They cannot be recovered.
                  </span>
                  <button type="button" onClick={() => void onForget()}>
                    Delete them
                  </button>
                  <button type="button" onClick={() => setConfirmForget(false)}>
                    Keep them
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmForget(true)} disabled={!client || tokens === 0}>
                  Forget my tokens
                </button>
              )}
            </div>
          </section>
          {!buying && ordered && paid && (
            <section className="panel" aria-labelledby="receipt-h" data-testid="receipt">
              <h2 id="receipt-h">Receipt</h2>
              <p>
                <span className="tag paid" data-testid="status-label">
                  {status?.label ?? 'paid'}
                </span>{' '}
                {issued} tokens signed after one confirmation.
              </p>
              {payment && (
                <p className="mono muted" data-testid="payment-receipt">
                  sent {payment.amount_zec} TAZ by the demo wallet{payment.txids.length > 0 ? ', txid ' : ''}
                  {payment.txids.map((t) => (
                    <Txid key={t} txid={t} />
                  ))}
                </p>
              )}
              {warning && (
                <div className="refusal" role="alert">
                  <strong>Flagged.</strong> This payment spent transparent inputs, which exposed the payer's own address on chain.
                </div>
              )}
              <button type="button" className="link" onClick={reset}>
                Buy another sheet
              </button>
            </section>
          )}
          {!buying && (
            <>
              {keyRefusal}
              {probePanel && (
                <details className="more">
                  <summary>The 402 this sheet answered</summary>
                  {probePanel}
                </details>
              )}
            </>
          )}
          <p className="muted">
            <Link to="/proof#ledger">See what the server saw</Link>
          </p>
        </aside>
      </div>
    </>
  );
}
