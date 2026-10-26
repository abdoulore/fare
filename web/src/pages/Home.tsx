// Home: API providers lead. The sheet margin carries the offer, a red-framed stamp carries
// the integration, a live postmark proves the 402 is real.

import { Pane } from '../components/Pane.tsx';
import { Postmark } from '../components/Postmark.tsx';
import { Copy } from '../components/Copy.tsx';
import { API_URL } from '../lib/config.ts';
import { useLive402 } from '../lib/live402.ts';
import { useServerView } from '../lib/serverView.ts';
import { Link } from '../router.tsx';

export const SNIPPET = `import { createOrigin } from 'fare-origin';

const fare = createOrigin({
  originName: 'api.example.com',
  issuerName: 'issuer.example.com',
  issuerUrl: 'http://127.0.0.1:8787',
  pack: 100, priceZec: '0.001',
  dataDir: 'origin-data',
});

createServer(fare.protect(yourHandler));`;

const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, ' ');

function LivePostmark() {
  const live = useLive402();
  if (live.state === 'loading') return <Postmark top="API · LIVE" bottom="ASKING" size={128} center="···" label="Asking the live API" />;
  if (live.state === 'down') return <Postmark size={128} top="API · LIVE" bottom={stamp(live.at)} center="NO ANSWER" tone="refused" label="The live API did not answer" />;
  if (live.state === 'refused')
    return <Postmark size={128} top="RETURNED" bottom={live.reason.toUpperCase()} center="402" sub={stamp(live.at)} tone="refused" strike label={`The live API answered 402, but ${live.reason === 'key not listed' ? 'its key is not in the published directory' : 'its challenge is malformed'}`} />;
  const offer = live.offer ? `${live.offer.pack} FOR ${live.offer.price_zec} TAZ` : stamp(live.at);
  return (
    <Postmark
      top="LIVE API"
      bottom={offer}
      center="402"
      sub="KEY MATCHES"
      strike
      size={128}
      label={`Live check: the hosted API answered 402 Payment Required${live.offer ? `, ${live.offer.pack} calls for ${live.offer.price_zec} TAZ` : ''}, and its key matches the published directory`}
    />
  );
}

export function Home() {
  const { ledger, stats, key, spent } = useServerView(20_000);
  const paid = ledger?.rows.filter((r) => r.status === 'paid').length;
  return (
    <>
      <section className="field" aria-labelledby="pitch">
        <div className="wrap">
          <div className="hero">
            <div>
              <h1 id="pitch">Charge for your API without tying calls to payments.</h1>
              <p className="lede">
                Fare sells your API in packs of 100 calls, paid once in shielded ZEC. Each call carries a single-use token your API can verify but cannot match to the payment or
                to the caller's other calls.
              </p>
              <p className="hero-limit">
                Tokens unlink payments from calls. A caller's IP address, timing and what they ask can still connect them. <Link to="/proof#limits">What Fare does not hide</Link>
              </p>
              <div className="actions">
                <Link to="/developers" className="button primary">
                  Add Fare to your API
                </Link>
                <Link to="/app" className="button">
                  Try it with a demo payment
                </Link>
              </div>
            </div>
            <div className="hero-wrap">
              <LivePostmark />
            <div className="hero-stamp stamp" data-testid="hero-stamp">
              <div className="stamp-in">
              <div className="denomination">
                <b>Your API</b>
                <span className="mono">fare-origin</span>
              </div>
              <pre tabIndex={0} aria-label="Middleware example">
                <code>{SNIPPET}</code>
              </pre>
              <div className="row">
                <Copy text={SNIPPET} label="Copy the example" />
                <span className="live muted">The postmark is a live check of {new URL(API_URL).host}</span>
              </div>
              </div>
            </div>
            </div>
          </div>
          <p className="selvage">
            <span>Pane of 100</span>
            <span>0.001 TAZ</span>
            <span>Zcash testnet</span>
            <span>RFC 9578 tokens</span>
          </p>
        </div>
      </section>

      <section className="band" aria-labelledby="torn-h">
        <div className="wrap">
          <h2 id="torn-h">One sheet, torn in two</h2>
          <p className="lede">The issuer sells packs and sees payments. Your API serves calls and sees tokens. Nothing runs between them: no shared id, table or log.</p>
          <div className="torn">
            <div className="half">
              <p className="label">The issuer sees</p>
              <p className="big-num" data-testid="home-paid">{paid ?? '–'}</p>
              <p>paid purchases, each by index, amount and block height. Never a token.</p>
            </div>
            <div className="seam" aria-label="No link between purchases and calls">
              <span>no link</span>
            </div>
            <div className="half">
              <p className="label">Your API sees</p>
              <p className="big-num">{stats?.redeemed ?? '–'}</p>
              <p>calls served with a valid token, and {stats?.refused.token_reused ?? 0} replays refused. Never a purchase.</p>
            </div>
          </div>
          <div className="row">
            {key && key.issued > 0 ? (
              <div className="stack">
                <Pane issued={key.issued} spent={spent} label={`${key.issued} tokens issued under the current key, ${spent} spent`} />
                <p className="muted">
                  Every token under the current key looks the same: {key.issued} issued, {spent} spent. <Link to="/proof#ledger">See the live ledger</Link>
                </p>
              </div>
            ) : (
              <p className="muted">
                No tokens issued under the current key yet. <Link to="/proof#ledger">See the live ledger</Link>
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="flow-h">
        <div className="wrap">
          <h2 id="flow-h">How a call is kept apart from its payment</h2>
          <ol className="plain flow-steps">
            <li>
              <h3>A 402 with a price</h3>
              <p>Your API answers an unpaid call with 402 Payment Required: one pack, 100 calls, 0.001 TAZ, and the issuer key it accepts.</p>
            </li>
            <li>
              <h3>A pack, blinded</h3>
              <p>The buyer's client checks that key against the published directory, blinds 100 tokens and orders a pack. The issuer mints a fresh shielded address for it.</p>
            </li>
            <li>
              <h3>One payment, one confirmation</h3>
              <p>The buyer pays from shielded funds. A scanner holding only a viewing key spots the payment by address, without a memo, and the issuer signs the blinded tokens.</p>
            </li>
            <li>
              <h3>One token per call</h3>
              <p>Each call spends one token. Your API checks it and refuses a replay, and cannot tell which payment it came from.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="doors-h">
        <div className="wrap">
          <h2 id="doors-h">Where to go</h2>
          <ul className="doors">
            <li>
              <h3>Run an API</h3>
              <p>Wrap your handler, run the issuer and the scanner beside it, set the price. The packages install from the repository.</p>
              <Link to="/developers" className="button dev">
                Developers
              </Link>
            </li>
            <li>
              <h3>Call an API</h3>
              <p>Buy 100 calls on testnet, paid by Fare's demo wallet or your own, then ask questions with tokens made in your browser.</p>
              <Link to="/app" className="button primary">
                Open the app
              </Link>
            </li>
            <li>
              <h3>Check the claims</h3>
              <p>Real testnet transactions, the published viewing key, the live ledger, and what Fare does not hide.</p>
              <Link to="/proof" className="button">
                Proof
              </Link>
            </li>
          </ul>
          <p className="muted">
            What Fare does not hide: your IP and timing, a small anonymity set, and what you ask. <Link to="/proof#limits">Read the limits</Link>
          </p>
        </div>
      </section>
    </>
  );
}
