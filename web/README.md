# fare-web

The Fare frontend: buy a pack of 100 calls in shielded testnet ZEC, ask questions with tokens made in your browser, and see what the server can and cannot see.

| Route | For | Shows |
| --- | --- | --- |
| `/` | Everyone, API providers first | The offer, a stamp with the middleware example and a live postmark of the hosted API's 402, what each side sees, how a call stays unlinkable, doors to the three sections |
| `/app` | Buyers and agents | Buy a sheet of 100 calls (demo payer or QR), live payment status, a receipt, the ask box beside your own pane of stamps, replay refused, refusal tests in a disclosure |
| `/developers` | API providers | What you run, quick start from the repo, wrapping a handler, validating before redeeming, the SDK for agents, the HTTP contract and refusals, operating notes, residuals |
| `/proof` | Verifiers | The live ledger with the "no link" perforation and the anonymity pane, testnet transactions with explorer evidence, the published viewing key and verifier, who sees what, limits |

`/try`, `/server` and `/how` from the first version redirect to `/app`, `/proof#ledger` and `/proof#who-sees-what`.

The look is "Sheet of stamps" (owner decision, Oct 25): a pack is a sheet of 100 stamps, each call cancels one with a postmark that names no sender. The direction contract is in `.impeccable/surfaces/src-app-tsx.md`; `PRODUCT.md` is the product record impeccable reads. Both are development files and are never served.

## Privacy properties of the page

- **Tokens are made here.** The browser runs `sdk/src/core.ts`: it pins the issuer directory's key, refuses a 402 naming any other, blinds 100 nonces, unblinds the signatures and stores the tokens in IndexedDB. The issuer only sees blinded requests; the API only sees tokens.
- **Nothing from a third party.** Fonts (Big Shoulders Display, Atkinson Hyperlegible Next, Martian Mono; all OFL) are bundled, there is no analytics and no CDN. The Content-Security-Policy allows this origin plus the API, issuer and payer URLs fixed at build time.
- **No purchase ids in public.** The purchase id stays in the tab that made it. The server view shows index offsets only.
- **The demo payer says it paid.** When it pays, the page says so, and the server view lists it as a residual.

## Run it

```
npm ci
npm test                      # Vitest: status mapping, CSP, pinning, IndexedDB storage and spending
npx playwright test           # builds, starts e2e/stack.ts, runs 22 browser tests
npm run dev                   # http://127.0.0.1:5173 against local services
```

`npm run dev` and `npm run build` read `VITE_API_URL`, `VITE_ISSUER_URL`, `VITE_PAYER_URL` (defaults: `127.0.0.1` ports 8080, 8787, 8791) and optionally `VITE_EXPLORER_TX`, a prefix txids are appended to for explorer links (default `https://testnet.zecblock.com/tx/`). Start the issuer with `WEB_ORIGINS=http://127.0.0.1:5173`, and the demo API and payer likewise, or the browser cannot read their responses.

`npm run design:check` runs impeccable's detector (a dev-only devDependency, telemetry off, never in the build) on the source and on `/`, `/app`, `/developers` and `/proof` at 1280 and 375 px. Waivers and their reasons live in `.impeccable/config.json`.

`e2e/stack.ts` runs the real issuer, origin, demo API and demo payer with a stub scanner and a stub wallet: a full payment walks a purchase through in_mempool and confirming to paid, a half payment to underpaid. Nothing there touches the chain.

## Known residuals of the hosted demo

- The blinding state lives in the tab. Closing it before the payment confirms loses the pack.
- One operator runs the issuer, the API and the demo payer on one host. See the README's residuals.
- `npm audit` flags `sjcl` (pulled in by `@cloudflare/privacypass-ts`) for missing point validation in its ECC code. Fare's tokens use RSA only, so that code path never runs.
