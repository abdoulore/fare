// From README.md and docs/SPEC.md. No claim here that those do not make.

const THREATS: [string, string, string][] = [
  ['Chain observer', 'A shielded transaction and its fee', 'Payer, amount, purchase address, which service'],
  ['lightwalletd operator (merchant side)', "The scanner's IP, block ranges, mempool snapshots", "Which transactions are the merchant's"],
  ['lightwalletd operator (payer side)', "The payer's IP, its sync and the transaction it broadcasts", 'The amount, the recipient, which purchase it pays'],
  ['Issuer', "Purchase id, price, payment status, 100 blinded messages, the client's IP at order time", 'The tokens those messages become'],
  ['API (origin)', "Each token, its arrival time, the request, the client's IP", 'The purchase behind a token; whether two calls share a buyer'],
  ['Model provider (when enabled)', 'The prompt', 'Who asked: no user id, address or token is sent'],
  ['Anyone with the published demo key', 'Every payment to the demo merchant: amount, index, height', 'Tokens, calls, payers'],
  ['Demo payer (this site)', 'The purchase address it pays, and the visitor IP that asked', 'The tokens, which are blinded in the browser'],
];

const RESIDUALS: [string, string][] = [
  ['Network metadata', 'An order and the first call from one IP, close in time, can be correlated. One confirmation (about 75 s) separates them. Fare does not route traffic.'],
  ['One operator, both sides', 'If one party runs the issuer and the API, network metadata on both sides is theirs to compare. This demo runs both.'],
  ['Small anonymity set', 'A token hides among the tokens issued under the same key. The server view shows the size.'],
  ['Key consistency', 'The client pins the key from its first directory fetch. Nothing outside checks that every client sees the same directory.'],
  ['Request content', 'The API reads what you ask. Fare unlinks identity, not content.'],
  ['Transparent funding', 'A payer who funds from a transparent balance exposes their own address. Fare flags it and cannot prevent it.'],
  ['Expiring tokens', "Unspent tokens stop working when their key retires, 24 h after the key's 7-day epoch ends."],
  ['Lost tokens', 'A token is spent before the request runs. If the model fails after that, the token is gone: a refund would link it to the caller.'],
  ['Reorgs', 'Tokens issue at one confirmation. A payment whose block is reorged out keeps its tokens; the merchant carries that loss.'],
];

export function How() {
  return (
    <>
      <h1>How it works</h1>
      <img className="arch" src="/architecture.png" alt="Fare architecture: buyer, issuer with scanner, and API origin, joined only by the public issuer directory." width={1344} height={1018} />

      <section className="stack" aria-labelledby="flow-h">
        <h2 id="flow-h">The flow</h2>
        <ol>
          <li>The API answers <code>402</code> with a Privacy Pass challenge and a price for a fixed pack: 100 calls for 0.001 TAZ.</li>
          <li>The client checks the challenge's key against the issuer key it pinned, blinds 100 nonces and orders a pack. Fare mints a fresh shielded-only address for that purchase.</li>
          <li>The payer pays it from shielded notes. The scanner matches the payment to the purchase by diversifier index, from compact blocks alone: no memo, no transaction lookup.</li>
          <li>After one confirmation the issuer blind-signs. The client unblinds 100 tokens (RFC 9578, type 2).</li>
          <li>Each call spends one token. The API verifies it but cannot tie it to the purchase, the payer, or the caller's other calls.</li>
        </ol>
      </section>

      <section className="stack" aria-labelledby="threat-h">
        <h2 id="threat-h">Who sees what</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col">Sees</th>
                <th scope="col">Cannot see</th>
              </tr>
            </thead>
            <tbody>
              {THREATS.map(([who, sees, not]) => (
                <tr key={who}>
                  <th scope="row">{who}</th>
                  <td>{sees}</td>
                  <td>{not}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="res-h">
        <h2 id="res-h">What Fare does not protect</h2>
        <dl className="kv">
          {RESIDUALS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="stack" aria-labelledby="sim-h">
        <h2 id="sim-h">What is real here</h2>
        <p>Payments are real testnet transactions. Detection, tokens and redemption are real. Answers are real only when the host has a model API key; otherwise each says "simulated".</p>
      </section>
    </>
  );
}
