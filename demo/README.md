# fare-demo

An LLM proxy sold for Fare tokens, an agent that pays for it and calls it, and the server-view panel.

| Part | File | What it does |
| --- | --- | --- |
| Demo API | `src/server.ts`, `src/llm.ts` | `POST /v1/ask {prompt}` behind the origin: 402 without a token, one token per answer |
| Agent | `src/agent.ts` | Asks a series of questions through the SDK, buys a pack on the first 402 and pays it with `fare-wallet`, then replays a token to show it refused |
| Panel | `src/panel.ts` | Loopback-only page: the issuer's purchases beside the origin's redemption counts, and the anonymity set |
| Demo payer | `src/payer.ts`, `src/payer-main.ts` | For the hosted frontend: `POST /pay {pay_uri, mode}` pays a purchase with `fare-wallet`, in full or half; `GET /health` reports its balance |

The API also answers `GET /v1/stats` (redemption and refusal counts per key, counts only) and `GET /health` (real or simulated answers, current key id), and allows the origins in `WEB_ORIGINS` through CORS with the 402's headers exposed.

## The demo payer

Owner decision D3: the hosted demo can pay for a visitor, so anyone can try the flow without an Ironwood testnet wallet. The page says so on every payment: "Paid by Fare's demo wallet."

- It is a separate service, not a route on the origin, so the origin still never sees a purchase. It sees a purchase address and the visitor's IP; never a purchase id or a token.
- It pays only `zcash:utest1...?amount=0.001` (the pack price), in full or half (`mode: "half"` demonstrates underpaid); each address once; 5 packs an hour in total (`PAYER_MAX_PER_HOUR`) and 2 per visitor; one payment at a time.
- Below one pack of balance it reports `empty` and refuses with `demo_payer_empty`.
- Client addresses are kept only as salted SHA-256 hashes in memory, for the per-visitor cap. Nothing is logged.

## Model answers: real or simulated

With `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) set, answers come from Claude through the Anthropic SDK: model `claude-opus-5-5` (override with `FARE_MODEL`), effort `low`, at most 1024 output tokens, and server-side refusal fallback (`fallbacks: "default"`). Without credentials, a canned responder answers, and every answer, the API's `/` page, the startup log and the panel say **simulated** (owner decision, Oct 24).

The model provider sees the prompt, as with any LLM API. It does not see who asked: no user id, no client address and no token goes upstream.

## Run it

```
# scanner sidecar, issuer, demo (each in its own terminal)
cd scanner && ./target/release/fare-scanner serve
cd issuer && npm start
cd demo && npm ci && npm run api          # API on 127.0.0.1:8080, panel on 127.0.0.1:8790/panel

# agent: pays with fare-wallet (FARE_PAYER_SEED in the environment, testnet only)
cd demo && CALLS=5 npm run agent
```

Chain access needs a machine that can reach lightwalletd; see `AGENTS.md`.

## Rules

- The request body is validated before the token is redeemed, so a malformed request costs nothing. A model failure after redemption returns 502 and the token stays spent: it cannot be unspent without linking it to the caller.
- `PANEL_LISTEN` must be loopback: the panel shows both sides. The page loads nothing from outside the server (a `default-src 'none'` content security policy, no fonts, no CDN).
- Nothing logs request data.

## Tests

```
npm ci --prefix ../issuer && npm ci --prefix ../sdk && npm ci --prefix ../origin && npm ci
npm test       # 18 tests: API, body-before-token, replay, model failure, responder, panel, CORS, stats, payer
```
