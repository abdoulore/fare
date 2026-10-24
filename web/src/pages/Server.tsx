// /server: what each side holds, drawn side by side with the join column left empty.
// Purchase ids never appear: they fetch signatures (owner decision D4).

import { useEffect, useState } from 'react';

import { Dots } from '../components/Dots.tsx';
import { formatZat, ledger as fetchLedger, originStats, type Ledger, type OriginStats } from '../lib/api.ts';

export function useServerView(intervalMs = 10_000) {
  const [ledger, setLedger] = useState<Ledger>();
  const [stats, setStats] = useState<OriginStats>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [l, s] = await Promise.allSettled([fetchLedger(), originStats()]);
      if (!alive) return;
      if (l.status === 'fulfilled') setLedger(l.value);
      if (s.status === 'fulfilled') setStats(s.value);
      setError(l.status === 'rejected' || s.status === 'rejected' ? 'Part of the server view is unreachable.' : undefined);
    };
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  const key = ledger?.keys[0];
  const spent = key && stats ? (stats.spent_by_key[key.key_id.slice(0, 16)] ?? 0) : 0;
  return { ledger, stats, error, key, spent };
}

const STATUS_CLASS: Record<string, string> = { paid: 'paid', underpaid: 'refused' };

export function Server() {
  const { ledger, stats, error, key, spent } = useServerView();
  const refusals = stats ? Object.entries(stats.refused).filter(([, n]) => n > 0) : [];
  return (
    <>
      <h1>What the server sees</h1>
      <p className="lede">
        The issuer sees purchases: payment status and blinded requests. The API sees tokens and calls. They share no id, table or log, and blind signatures keep a
        token from being matched to the purchase that paid for it. Network metadata can still be correlated: see below. These are the live counts from the demo
        services.
      </p>
      {error && <p className="refusal" role="status">{error}</p>}

      <div className="ledger">
        <section className="panel" aria-labelledby="issuer-h">
          <h2 id="issuer-h">Issuer: purchases</h2>
          <p className="muted">Index, amount, height and status. All but status are visible to anyone with the published viewing key.</p>
          <div className="scroll">
            <table data-testid="issuer-table">
              <thead>
                <tr>
                  <th scope="col">Index</th>
                  <th scope="col" className="num">Received</th>
                  <th scope="col" className="num">Height</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger?.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No purchases yet.</td>
                  </tr>
                )}
                {[...(ledger?.rows ?? [])].reverse().map((r, i) => (
                  <tr key={`${r.index}-${i}`}>
                    <td className="mono">+{r.index}</td>
                    <td className="mono num">{formatZat(r.received_zat)}</td>
                    <td className="mono num">{r.height?.toLocaleString('en-US') ?? '–'}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status === 'no_record' ? 'earlier run' : r.status.replace('_', ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledger?.scanned_to != null && <p className="muted mono">scanned to {ledger.scanned_to.toLocaleString('en-US')}</p>}
        </section>

        <div className="gap" aria-label="No link between purchases and calls" data-testid="no-link">
          no link
        </div>

        <section className="panel" aria-labelledby="origin-h">
          <h2 id="origin-h">API: calls</h2>
          <p className="muted">Counts only. Each token's nonce is kept to refuse a replay, nothing else.</p>
          <dl className="kv" data-testid="origin-stats">
            <dt>Served</dt>
            <dd className="mono">{stats?.redeemed ?? '–'}</dd>
            <dt>402 challenges</dt>
            <dd className="mono">{stats?.challenged ?? '–'}</dd>
            {Object.entries(stats?.spent_by_key ?? {}).map(([k, n]) => (
              <div key={k} className="contents">
                <dt>Spent under key {k.slice(0, 12)}</dt>
                <dd className="mono">{n}</dd>
              </div>
            ))}
          </dl>
          <h3>Refused</h3>
          {refusals.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <dl className="kv">
              {refusals.map(([why, n]) => (
                <div key={why} className="contents">
                  <dt className="mono">{why}</dt>
                  <dd className="mono">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <section className="stack" aria-labelledby="set-h">
        <h2 id="set-h">The anonymity set</h2>
        {key ? (
          <>
            <p>
              A token hides among every token issued under the same key: <span className="mono">{key.issued}</span> from <span className="mono">{key.packs}</span>{' '}
              {key.packs === 1 ? 'purchase' : 'purchases'} under key <span className="mono">{key.key_id.slice(0, 12)}</span>, <span className="mono">{spent}</span> spent (dimmed).
            </p>
            <Dots issued={key.issued} spent={spent} />
          </>
        ) : (
          <p className="muted">Loading.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="res-h">
        <h2 id="res-h">What this does not hide</h2>
        <ul>
          <li><b>IP and timing.</b> An order and a first call from one address, close in time, can be correlated. Use Tor or a proxy if that matters.</li>
          <li><b>A small set.</b> With few purchases under a key, a token hides among few others. The dots above are the whole set.</li>
          <li><b>Request content.</b> The API reads what you ask, and so does the model provider when answers are real.</li>
          <li><b>One operator.</b> This demo runs the issuer and the API on one server, so whoever runs it sees the network side of both.</li>
          <li><b>The demo payer.</b> When Fare's demo wallet pays, Fare runs the payer and sees which purchase address it paid. Pay from your own wallet to avoid that.</li>
        </ul>
      </section>
    </>
  );
}
