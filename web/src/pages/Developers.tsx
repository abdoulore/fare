// /developers: how an API provider adds Fare. Every command and signature here matches the
// code in this repository; packages install from the repo (pre-release, not on npm).

import { CodeBlock } from '../components/CodeBlock.tsx';
import { Link } from '../router.tsx';

const SECTIONS: [string, string][] = [
  ['parts', 'What you run'],
  ['quick-start', 'Quick start'],
  ['your-api', 'Your API'],
  ['clients', 'Clients and agents'],
  ['contract', 'HTTP contract'],
  ['operating', 'Operating it'],
  ['guarantees', 'What your users get'],
  ['status', 'Status'],
];

const INSTALL = `git clone https://github.com/abdoulore/fare.git

# 1. Scanner: watches the chain with a viewing key only
cd fare/scanner && cargo build --release
./target/release/fare-scanner init --network test          # or --ufvk <your key>
./target/release/fare-scanner serve                        # loopback 127.0.0.1:7077

# 2. Issuer: sells packs, signs blinded tokens once paid
cd ../issuer && npm ci
ISSUER_LISTEN=127.0.0.1:8787 SCANNER_URL=http://127.0.0.1:7077 npm start

# 3. Your API: add the origin middleware from the repo
cd ../../your-api && npm install ../fare/origin`;

const PROTECT = `import { createServer } from 'node:http';
import { createOrigin } from 'fare-origin';

const fare = createOrigin({
  originName: 'api.example.com',       // bound into every challenge
  issuerName: 'issuer.example.com',    // shown to clients in the challenge
  issuerUrl: 'http://127.0.0.1:8787',  // where keys are read from
  publicIssuerUrl: 'https://issuer.example.com', // advertised in Fare-Offer
  pack: 100,
  priceZec: '0.001',
  dataDir: 'origin-data',              // spent-token store
});

createServer(fare.protect((req, res) => {
  // Runs only for a request with a valid, unspent token.
  res.end(JSON.stringify({ answer: 'paid call' }));
})).listen(8080);`;

const REDEEM = `// Validate the request first, then spend the token, as the demo API does.
if (!req.headers.authorization) {
  res.writeHead(402, await fare.challengeHeaders()).end();
  return;
}
const body = parse(await readBody(req));       // refuse bad input before spending
const verdict = await fare.redeem(req.headers.authorization);
if (!verdict.ok) return res.writeHead(401).end(JSON.stringify({ error: verdict.reason }));`;

const AGENT = `// npm install ../fare/sdk
import { FareClient } from 'fare-sdk';

const fare = new FareClient({ issuerUrl: 'https://issuer.example.com', stateFile: 'fare-state.json' });
await fare.pin();                                // pin the directory key once

const res = await fare.fetch('https://api.example.com/v1/ask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'hello' }),
}, async (payUri, offer) => {
  // Pay payUri from a shielded balance, e.g. with fare-wallet:
  // fare-wallet pay "$payUri" --max-zec 0.001
});`;

export function Developers() {
  return (
    <>
      <div className="wrap doc-head dev">
        <h1>Accept Fare on your API</h1>
        <p className="lede">
          Wrap your handler, run an issuer and a scanner beside it, and every call to your API is paid for with a single-use token you can verify but cannot trace to a buyer.
        </p>
        <p className="selvage">
          <span className="dev-rule">Developers</span>
          <span>Pre-release</span>
          <span>Zcash testnet</span>
        </p>
      </div>

      <div className="wrap doc">
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
          <section id="parts" aria-labelledby="parts-h">
            <h2 id="parts-h">What you run</h2>
            <p>Three parts, each knowing only what it needs:</p>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Does</th>
                    <th scope="col">Knows</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Origin middleware</th>
                    <td>Answers unpaid calls with 402 and a price; checks each token's key id, challenge, signature and spent set, then runs your handler.</td>
                    <td>Tokens and the requests they arrive with. Never a purchase.</td>
                  </tr>
                  <tr>
                    <th scope="row">Issuer</th>
                    <td>Publishes its key, takes orders of 100 blinded requests, signs them after one confirmation.</td>
                    <td>Purchases and blinded requests. Never a token.</td>
                  </tr>
                  <tr>
                    <th scope="row">Scanner</th>
                    <td>Mints a fresh shielded address per purchase and spots payments in compact blocks by address index.</td>
                    <td>A viewing key. No seed, no memo, no transaction lookups.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The issuer and the origin share no table, id or log. The only thing they share is the issuer's public key, read from{' '}
              <code>/.well-known/private-token-issuer-directory</code>.
            </p>
          </section>

          <section id="quick-start" aria-labelledby="qs-h">
            <h2 id="qs-h">Quick start</h2>
            <p>The packages are pre-release and install from the repository, not from npm. You need Rust, Node 22 and a machine that can reach a Zcash lightwalletd.</p>
            <CodeBlock code={INSTALL} label="Copy commands" />
            <p className="muted">
              <code>init</code> without <code>--ufvk</code> writes a seed file: move it offline, the scanner never reads it again. For a whole host with TLS and systemd units, see{' '}
              <a href="https://github.com/abdoulore/fare/blob/main/deploy/README.md">deploy/README.md</a>.
            </p>
          </section>

          <section id="your-api" aria-labelledby="api-h">
            <h2 id="api-h">Your API</h2>
            <p>The simplest integration wraps a node:http handler. Your code runs only after the token passed every check.</p>
            <CodeBlock code={PROTECT} label="Copy example" />
            <h3>Validate before you charge</h3>
            <p>To refuse malformed requests without spending the caller's token, answer the 402 yourself and redeem after validating:</p>
            <CodeBlock code={REDEEM} label="Copy example" />
            <p>
              <code>redeem</code> checks, in order, the key id, the challenge digest, the signature and the spent set, and marks the token spent only when everything passed.
            </p>
          </section>

          <section id="clients" aria-labelledby="clients-h">
            <h2 id="clients-h">Clients and agents</h2>
            <p>
              The SDK handles the 402, pins the issuer key, blinds and orders a pack, waits for payment, unblinds the tokens and spends one per call. Your agent supplies the payment.
            </p>
            <CodeBlock code={AGENT} label="Copy example" />
            <p>
              In a browser, <code>sdk/src/core.ts</code> runs the same flow with no Node imports; <Link to="/app">the app</Link> uses it and keeps tokens in IndexedDB.
            </p>
          </section>

          <section id="contract" aria-labelledby="contract-h">
            <h2 id="contract-h">HTTP contract</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Answer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">Your API, no token</td>
                    <td>
                      <code>402</code> with <code>WWW-Authenticate: PrivateToken challenge=…, token-key=…</code> and <code>Fare-Offer: {'{"pack":100,"price_zec":"0.001","issuer":"…"}'}</code>
                    </td>
                  </tr>
                  <tr>
                    <td className="mono">Your API, with token</td>
                    <td>
                      <code>Authorization: PrivateToken token="…"</code>. Your handler's answer, or <code>401</code> with one of the refusals below
                    </td>
                  </tr>
                  <tr>
                    <td className="mono">GET /.well-known/private-token-issuer-directory</td>
                    <td>RFC 9578 directory: the current key, and the previous one during its 24 h grace</td>
                  </tr>
                  <tr>
                    <td className="mono">POST /fare/purchases</td>
                    <td>
                      <code>{'{pack, blinded: [100 TokenRequests]}'}</code> → <code>201 {'{purchase_id, pay_uri, expires_at}'}</code>
                    </td>
                  </tr>
                  <tr>
                    <td className="mono">GET /fare/purchases/{'{id}'}</td>
                    <td>
                      <code>{'{status}'}</code>: pending, in_mempool, confirming, underpaid, expired; once paid, <code>{'{status: "paid", signatures: [100]}'}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3>Refusals</h3>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Means</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['401 token_reused', 'This token was already spent. Each token works once.'],
                    ['401 bad_signature', 'The token does not verify against the issuer key.'],
                    ['401 unknown_key', 'The token names a key the directory never listed.'],
                    ['401 wrong_challenge', 'The token was issued for another API.'],
                    ['401 expired_epoch', 'The token key has retired.'],
                    ['400 wrong_pack, wrong_count', 'An order for anything but one pack of 100.'],
                    ['400 duplicate_request, malformed_request, unknown_key', 'An order the issuer will not sign.'],
                    ['503 scanner_unavailable', 'The issuer cannot reach its scanner; nothing is guessed.'],
                  ].map(([code, means]) => (
                    <tr key={code}>
                      <td className="mono">{code}</td>
                      <td>{means}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="operating" aria-labelledby="op-h">
            <h2 id="op-h">Operating it</h2>
            <ul>
              <li>One pack size, 100 calls for 0.001 TAZ. The issuer refuses any other count.</li>
              <li>Tokens are signed after one confirmation (about 75 s), never from the mempool.</li>
              <li>Issuer keys rotate every 7 days; the previous key stays valid for 24 hours. Clients follow a rotation only through the directory.</li>
              <li>The scanner listens on loopback only and logs nothing about requests. Keep it off the public network.</li>
              <li>
                Browser clients need CORS. The issuer reads <code>WEB_ORIGINS</code>; your API must also allow those origins and expose <code>WWW-Authenticate</code> and{' '}
                <code>Fare-Offer</code>, or browsers cannot read the 402. <code>issuer/src/cors.ts</code> does both and the demo API uses it.
              </li>
              <li>Payments funded from transparent inputs are flagged in the purchase status, never silently accepted.</li>
              <li>A token spent on a request that then fails cannot be refunded: a refund would link it to the caller.</li>
            </ul>
          </section>

          <section id="guarantees" aria-labelledby="g-h">
            <h2 id="g-h">What your users get</h2>
            <p>
              Your API can verify every call and refuse every replay, yet cannot tie a call to the purchase that paid for it, or one call to another. The issuer sees purchases and
              cannot tie them to tokens.
            </p>
            <h3>What they do not get</h3>
            <ul>
              <li>Protection from network metadata: an order and a first call from one IP, close in time, can be correlated. Fare does not route traffic.</li>
              <li>A large crowd by default: a token hides among the tokens issued under the same key, so a new API starts with a small set.</li>
              <li>Hidden requests: your API reads what callers send.</li>
              <li>Separation of operators: if you run both the issuer and the API, network metadata on both sides is yours to compare.</li>
            </ul>
            <p>
              <Link to="/proof#limits">The full list, with the evidence</Link>
            </p>
          </section>

          <section id="status" aria-labelledby="s-h">
            <h2 id="s-h">Status</h2>
            <p>
              Pre-release, built for ZECATHON 2026. Runs on Zcash testnet; mainnet has not been run. Packages are not published to npm. The API contract above is what the code in
              the repository implements, with a test for every refusal.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
