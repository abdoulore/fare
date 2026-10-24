import { Dots } from '../components/Dots.tsx';
import { Link } from '../router.tsx';
import { useServerView } from './Server.tsx';

export function Landing() {
  const { ledger, stats, key, spent } = useServerView(20_000);
  const paid = ledger?.rows.filter((r) => r.status === 'paid').length;
  return (
    <>
      <section className="hero">
        <h1>Pay once in shielded ZEC. Every call after that carries a token nobody can link back to you, including us.</h1>
        <p className="lede">Fare sells an API in packs of 100 calls. Your browser makes the tokens; the server signs them blind, then checks each one once.</p>
        <div className="row">
          <Link to="/try" className="button primary">
            Try it on testnet
          </Link>
          <Link to="/how">How it works</Link>
        </div>
      </section>

      <ol className="flow" aria-label="Three steps">
        <li>
          <b>1 · Buy</b>
          Your browser blinds 100 tokens and orders a pack. Fare mints a fresh shielded address for this purchase alone.
        </li>
        <li>
          <b>2 · Pay</b>
          Pay 0.001 TAZ from shielded funds. After one confirmation the issuer signs the blinded tokens without seeing them.
        </li>
        <li>
          <b>3 · Call</b>
          Each call spends one token. The API checks it and refuses a replay, but cannot tell whose it is.
        </li>
      </ol>

      <section className="grid2" aria-label="Live server view">
        <div className="panel">
          <h2>Right now</h2>
          <dl className="kv">
            <dt>Paid purchases</dt>
            <dd className="mono">{paid ?? '–'}</dd>
            <dt>Calls served</dt>
            <dd className="mono">{stats?.redeemed ?? '–'}</dd>
            <dt>Replays refused</dt>
            <dd className="mono">{stats?.refused.token_reused ?? '–'}</dd>
            <dt>Shared identifier</dt>
            <dd>none</dd>
          </dl>
          <p>
            <Link to="/server">What the server sees</Link>
          </p>
        </div>
        <div className="panel">
          <h2>Current anonymity set</h2>
          {!key ? (
            <p className="muted">Loading.</p>
          ) : key.issued === 0 ? (
            <p className="muted">No tokens issued under the current key yet. The first pack you buy makes a set of 100.</p>
          ) : (
            <Dots issued={Math.min(key.issued, 300)} spent={Math.min(spent, 300)} />
          )}
          {key && (
            <p className="muted mono">
              {key.issued} tokens, {spent} spent
            </p>
          )}
        </div>
      </section>
    </>
  );
}
