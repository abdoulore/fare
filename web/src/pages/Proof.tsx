import { Copy } from '../components/Copy.tsx';
import { CHECK_COMMANDS, PROOF, UIVK } from '../content/proof.ts';
import { EXPLORER_TX } from '../lib/config.ts';

export function Proof() {
  return (
    <>
      <h1>Proof</h1>
      <p className="lede">
        Every payment below is a real testnet transaction, paid by <code>fare-wallet</code> and detected by <code>fare-scanner</code> from compact blocks. All went to purchase
        addresses of one demo merchant, whose incoming viewing key is published here.
      </p>

      <section className="panel stack" aria-labelledby="key-h">
        <h2 id="key-h">Demo merchant's incoming viewing key</h2>
        <p className="mono break" data-testid="uivk">{UIVK}</p>
        <Copy text={UIVK} label="Copy viewing key" />
        <p className="muted">It reveals incoming payments to this demo account only: amount, height, address index. It cannot spend, and it reveals nothing about tokens or calls.</p>
      </section>

      <section className="stack" aria-labelledby="tx-h">
        <h2 id="tx-h">Transactions</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Index</th>
                <th scope="col" className="num">TAZ</th>
                <th scope="col" className="num">Height</th>
                <th scope="col">Txid</th>
                <th scope="col">Shows</th>
                <th scope="col">Run</th>
              </tr>
            </thead>
            <tbody>
              {PROOF.map((r) => (
                <tr key={r.txid}>
                  <td className="mono">+{r.index}</td>
                  <td className="mono num">{r.amount}</td>
                  <td className="mono num">{r.height}</td>
                  <td className="mono break">
                    {EXPLORER_TX ? (
                      <a href={`${EXPLORER_TX}${r.txid}`} rel="noreferrer noopener" target="_blank">
                        {r.txid.slice(0, 10)}…{r.txid.slice(-6)}
                      </a>
                    ) : (
                      <span title={r.txid}>{r.txid.slice(0, 10)}…{r.txid.slice(-6)}</span>
                    )}
                  </td>
                  <td>{r.shows}</td>
                  <td>
                    <a href={r.run} rel="noreferrer noopener" target="_blank">{r.runLabel}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">An explorer shows each of these as a shielded transaction: a fee and no sender, recipient, amount or memo.</p>
      </section>

      <section className="stack" aria-labelledby="check-h">
        <h2 id="check-h">Check it yourself</h2>
        <p>With the published key only, no seed and nothing from us:</p>
        <pre>{CHECK_COMMANDS}</pre>
        <p className="muted">
          <code>init --uivk</code> makes a watch-only verifier: it holds no seed and refuses to mint. <code>status</code> lists every payment to the key by purchase index.
          The scan needs a machine that can reach <code>testnet.zec.rocks</code>.
        </p>
      </section>
    </>
  );
}
