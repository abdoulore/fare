// /proof: everything a verifier needs, each claim next to its evidence. Purchase ids never
// appear: they fetch signatures.

import { Architecture } from '../components/Architecture.tsx';
import { CardTable } from '../components/CardTable.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Copy } from '../components/Copy.tsx';
import { Pane } from '../components/Pane.tsx';
import { CHECK_COMMANDS, PROOF, UIVK } from '../content/proof.ts';
import { formatZat } from '../lib/api.ts';
import { EXPLORER_TX } from '../lib/config.ts';
import { useServerView } from '../lib/serverView.ts';

const SECTIONS: [string, string][] = [
  ['ledger', 'Live ledger'],
  ['transactions', 'Testnet transactions'],
  ['verify', 'Check it yourself'],
  ['who-sees-what', 'Who sees what'],
  ['limits', 'What Fare does not hide'],
];

const THREATS: [string, string, string][] = [
  ['Chain observer', 'A shielded transaction and its fee', 'Payer, amount, purchase address, which service'],
  ['lightwalletd operator, merchant side', "The scanner's IP, block ranges, mempool snapshots", "Which transactions are the merchant's"],
  ['lightwalletd operator, payer side', "The payer's IP, its sync and the transaction it broadcasts", 'The amount, the recipient, which purchase it pays'],
  ['Issuer', "Purchase id, price, payment status, 100 blinded messages, the client's IP at order time", 'The tokens those messages become'],
  ['API (origin)', "Each token, its arrival time, the request, the client's IP", 'The purchase behind a token; whether two calls share a buyer'],
  ['Model provider (when enabled)', 'The prompt', 'Who asked: no user id, address or token is sent'],
  ['Anyone with the published demo key', 'Every payment to the demo merchant: amount, index, height', 'Tokens, calls, payers'],
  ['Demo payer (this site)', 'The purchase address it pays, and the visitor IP that asked', 'The tokens, which are blinded in the browser'],
];

const LIMITS: [string, string][] = [
  ['Network metadata', 'An order and the first call from one IP, close in time, can be correlated. One confirmation (about 75 s) separates them. Fare does not route traffic: use Tor or a proxy if this matters.'],
  ['One operator, both sides', 'If one party runs the issuer and the API, network metadata on both sides is theirs to compare. This demo runs both.'],
  ['Small anonymity set', 'A token hides among the tokens issued under the same key. The live pane above is the whole set.'],
  ['Key consistency', 'The client pins the key from its first directory fetch. Nothing outside checks that every client sees the same directory.'],
  ['Request content', 'The API reads what you ask, and so does the model provider when answers are real. Fare unlinks identity, not content.'],
  ['Transparent funding', 'A payer who funds from a transparent balance exposes their own address. Fare flags it and cannot prevent it.'],
  ['The demo payer', "When Fare's demo wallet pays, Fare runs the payer and sees which purchase address it paid. Pay from your own wallet to avoid that."],
  ['Lost tokens', 'A token is spent before the request runs. If the model fails after that, the token is gone: a refund would link it to the caller.'],
  ['Reorgs', 'Tokens issue at one confirmation. A payment whose block is later reorged out keeps its tokens; the merchant carries that loss.'],
];

const STATUS_TAG: Record<string, string> = { paid: 'paid', underpaid: 'refused' };
const STATUS_TEXT: Record<string, string> = { no_record: 'earlier run', underpaid: 'postage due', in_mempool: 'in mempool' };

export function Proof() {
  const { ledger, stats, error, key, spent } = useServerView();
  const refusals = stats ? Object.entries(stats.refused).filter(([, n]) => n > 0) : [];
  return (
    <>
      <div className="masthead ink">
        <div className="wrap">
          <h1>Check the claims</h1>
          <p className="lede">Real testnet payments, a key you can verify them with, the live counts from both sides, and what Fare does not hide.</p>
          <p className="selvage">
            <span>Proof</span>
            <span>Every claim beside its evidence</span>
          </p>
        </div>
      </div>

      <div className="wrap doc ink">
        <nav className="toc" aria-label="On this page">
          <ol>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div>
          <section id="ledger" aria-labelledby="ledger-h">
            <h2 id="ledger-h">Live ledger</h2>
            <p>
              The issuer sees purchases: payment status and blinded requests. The API sees tokens and calls. They share no id, table or log, and blind signatures keep a token from
              being matched to the purchase that paid for it. These are the live counts from the demo services.
            </p>
            {error && (
              <p className="refusal" role="status">
                {error}
              </p>
            )}
            <div className="torn ledger">
              <div className="half">
                <p className="label">Issuer: purchases</p>
                <p className="muted">Index, amount and height are visible to anyone with the published viewing key; status is the issuer's.</p>
                <div className="scroll">
                  <table data-testid="issuer-table">
                    <thead>
                      <tr>
                        <th scope="col">Index</th>
                        <th scope="col" className="num">
                          TAZ
                        </th>
                        <th scope="col" className="num">
                          Height
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger?.rows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="muted">
                            No purchases yet.
                          </td>
                        </tr>
                      )}
                      {[...(ledger?.rows ?? [])].reverse().map((r, i) => (
                        <tr key={`${r.index}-${i}`}>
                          <td className="mono">+{r.index}</td>
                          <td className="mono num">{formatZat(r.received_zat)}</td>
                          <td className="mono num">{r.height?.toLocaleString('en-US') ?? '–'}</td>
                          <td>
                            <span className={`tag ${STATUS_TAG[r.status] ?? ''}`}>{STATUS_TEXT[r.status] ?? r.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ledger?.scanned_to != null && <p className="muted mono">scanned to {ledger.scanned_to.toLocaleString('en-US')}</p>}
              </div>
              <div className="seam" aria-label="No link between purchases and calls" data-testid="no-link">
                <span>no link</span>
              </div>
              <div className="half">
                <p className="label">API: calls</p>
                <p className="muted">Counts only. Each token's nonce is kept to refuse a replay, nothing else.</p>
                <dl className="kv" data-testid="origin-stats">
                  <dt>Served</dt>
                  <dd className="mono">{stats?.redeemed ?? '–'}</dd>
                  <dt>402 challenges</dt>
                  <dd className="mono">{stats?.challenged ?? '–'}</dd>
                  {Object.entries(stats?.spent_by_key ?? {}).map(([k, n]) => (
                    <div key={k} className="contents">
                      <dt>
                        Spent under key <span className="mono">{k.slice(0, 12)}</span>
                      </dt>
                      <dd className="mono">{n}</dd>
                    </div>
                  ))}
                  {refusals.map(([why, n]) => (
                    <div key={why} className="contents">
                      <dt>
                        Refused: <span className="mono">{why}</span>
                      </dt>
                      <dd className="mono">{n}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <h3>The anonymity set</h3>
            {key && key.issued === 0 ? (
              <p className="muted">No tokens issued under the current key yet. The first pack bought makes a set of 100.</p>
            ) : key ? (
              <>
                <p>
                  A token hides among every token issued under the same key: <span className="mono">{key.issued}</span> from <span className="mono">{key.packs}</span>{' '}
                  {key.packs === 1 ? 'purchase' : 'purchases'} under key <span className="mono">{key.key_id.slice(0, 12)}</span>, <span className="mono">{spent}</span> spent (cancelled).
                </p>
                <Pane issued={key.issued} spent={spent} />
              </>
            ) : (
              <p className="muted">Loading.</p>
            )}
          </section>

          <section id="transactions" aria-labelledby="tx-h">
            <h2 id="tx-h">Testnet transactions</h2>
            <p>
              Every payment below is a real testnet transaction to a purchase address of the demo merchant, detected by the scanner from compact blocks. On a public explorer each one
              is a shielded transaction with 2 actions and a 0.0001 TAZ fee, and nothing else: paid, underpaid and second payments look the same.
            </p>
            <CardTable
              head={['Index', 'TAZ', 'Height', 'Txid', 'Shows', 'Run']}
              inline
              num={[1, 2]}
              mono={[0, 1, 2, 3]}
              rows={PROOF.map((r) => {
                const short = `${r.txid.slice(0, 10)}…${r.txid.slice(-6)}`;
                return {
                  key: r.txid,
                  cells: [
                    `+${r.index}`,
                    r.amount,
                    r.height,
                    EXPLORER_TX ? (
                      <a href={`${EXPLORER_TX}${r.txid}`} rel="noreferrer noopener" target="_blank">
                        {short}
                      </a>
                    ) : (
                      <span title={r.txid}>{short}</span>
                    ),
                    r.shows,
                    <a href={r.run} rel="noreferrer noopener" target="_blank">
                      {r.runLabel}
                    </a>,
                  ],
                };
              })}
            />
            <figure>
              <img src="/proof/underpaid-on-explorer.png" alt="The underpaid purchase (+5) on the ZecBlock testnet explorer: block 4,536,052, fee 0.0001 TAZ, 9,166 bytes, 2 Ironwood actions, and no sender, recipient or amount." width={1280} height={960} loading="lazy" />
              <figcaption>The underpaid purchase (+5) on a public testnet explorer: block, fee, size and two encrypted actions. The paid ones look identical.</figcaption>
            </figure>
          </section>

          <section id="verify" aria-labelledby="verify-h">
            <h2 id="verify-h">Check it yourself</h2>
            <p>The demo merchant's incoming viewing key is published. It shows incoming payments to this demo account only, cannot spend, and reveals nothing about tokens or calls.</p>
            <p className="mono break" data-testid="uivk">
              {UIVK}
            </p>
            <div className="after-copy">
              <Copy text={UIVK} label="Copy viewing key" />
            </div>
            <p>With that key alone, no seed and nothing from us, a watch-only scanner lists every payment by purchase index:</p>
            <CodeBlock code={CHECK_COMMANDS} title="Terminal" label="Copy commands" />
            <p className="muted">
              <code>init --uivk</code> refuses to mint. The scan needs a machine that can reach <code>testnet.zec.rocks</code>.
            </p>
          </section>

          <section id="who-sees-what" aria-labelledby="who-h">
            <h2 id="who-h">Who sees what</h2>
            <Architecture />
            <CardTable head={['Who', 'Sees', 'Cannot see']} rowHeader rows={THREATS.map(([who, sees, not]) => ({ key: who, cells: [who, sees, not] }))} />
          </section>

          <section id="limits" aria-labelledby="limits-h">
            <h2 id="limits-h">What Fare does not hide</h2>
            <dl className="kv wide">
              {LIMITS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Answers on this site are simulated unless the host has a model key, and say so on every answer. Payments, detection, tokens and redemption are real.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
