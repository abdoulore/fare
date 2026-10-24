# fare-web

The Fare frontend: buy a pack of 100 calls in shielded testnet ZEC, ask questions with tokens made in your browser, and see what the server can and cannot see.

| Route | Shows |
| --- | --- |
| `/` | The pitch, the three steps, live counts and the current anonymity set |
| `/try` | Ask, buy, pay, wait, use. The real 402, blinding progress, the pay URI (demo payer or QR), live payment status, tokens left, replay refused |
| `/server` | The issuer's purchases (index, amount, height, status) and the API's counts either side of an empty "no link" column; the anonymity-set dot grid |
| `/proof` | The published incoming viewing key, the testnet txids and the workflow run behind each, and how to check them |
| `/how` | Architecture, flow, who sees what, residuals |

## Privacy properties of the page

- **Tokens are made here.** The browser runs `sdk/src/core.ts`: it pins the issuer directory's key, refuses a 402 naming any other, blinds 100 nonces, unblinds the signatures and stores the tokens in IndexedDB. The issuer only sees blinded requests; the API only sees tokens.
- **Nothing from a third party.** Fonts (IBM Plex, OFL) are bundled, there is no analytics and no CDN. The Content-Security-Policy allows this origin plus the API, issuer and payer URLs fixed at build time.
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

`e2e/stack.ts` runs the real issuer, origin, demo API and demo payer with a stub scanner and a stub wallet: a full payment walks a purchase through in_mempool and confirming to paid, a half payment to underpaid. Nothing there touches the chain.

## Known residuals of the hosted demo

- The blinding state lives in the tab. Closing it before the payment confirms loses the pack.
- One operator runs the issuer, the API and the demo payer on one host. See the README's residuals.
- `npm audit` flags `sjcl` (pulled in by `@cloudflare/privacypass-ts`) for missing point validation in its ECC code. Fare's tokens use RSA only, so that code path never runs.
