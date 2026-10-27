# Product

<!-- impeccable:product-schema 1 -->

Development-only product record for design work on `web/`. Written by hand from facts in README.md, CONTRIBUTING.md and docs/SPEC.md; impeccable's init flow was not run. Never shipped to the site.

## Platform

web

## Users

- **API providers** (lead audience): developers who run an HTTP API and want to charge for it without accounts, cards or knowing who calls. They add origin middleware to their API and run an issuer and a scanner beside it.
- **Buyers and agents**: people, or software agents acting for them, who want to call a paid API without creating an account or linking their calls to their payment. They pay once from a shielded Zcash balance and spend one token per call.
- **Verifiers**: ZECATHON 2026 judges and technical skeptics who need to check that the privacy claim holds and that the payments are real.

## Product Purpose

Fare sells access to an API in fixed packs (100 calls for 0.001 TAZ on testnet) paid in shielded ZEC, then redeems each call with a single-use Privacy Pass token. Success: a provider can verify every call and refuse every replay, yet nobody, the provider included, can link a call to the purchase that paid for it, or one call to another.

## Positioning

Pay once in shielded ZEC; every call after that carries a token that nobody, the API included, can match to the payment. IP address, timing and request content are not hidden by the tokens. The mechanism nobody else combines: a fresh shielded-only address per purchase, matched from compact blocks by diversifier index with a viewing key only (no memo, no transaction lookup), and RFC 9578 blind RSA tokens blinded and unblinded in the buyer's own browser or client.

## Operating Context

- Buyer flow: the API answers HTTP 402 with a challenge and an offer; the client checks the issuer key against the published directory, blinds 100 nonces, orders a pack, pays the purchase address, waits one confirmation (about 75 s), unblinds 100 tokens, spends one per call. Replays are refused with 401 token_reused.
- Provider stack: origin middleware (TypeScript, node:http), issuer service (purchases API, 7-day epoch keys, native blind signing), scanner sidecar (Rust, viewing key only, loopback), optional demo payer. Packages install from the GitHub repo; they are not published to npm (pre-release).
- Agents use the TypeScript SDK (`sdk/`), which handles the 402, pinning, ordering, payment callback and spending.
- Verification: a published incoming viewing key lets anyone list every payment to the demo merchant with `fare-scanner init --uivk`; testnet txids are viewable on a public explorer (ZecBlock).
- Everything runs on Zcash testnet (TAZ has no value). The hosted demo is https://fare.moonrider.online.

## Capabilities and Constraints

- One pack size: 100 calls for 0.001 TAZ. Issuer refuses any other N.
- Tokens issue only after one confirmation, never from the mempool.
- Issuer keys rotate every 7 days with a 24 h grace window; clients pin the directory key and refuse any other.
- Demo API answers are simulated unless the host has a model API key; every simulated answer is labeled.
- The hosted demo includes a rate-limited demo payer (Fare's own testnet wallet) so visitors without an Ironwood wallet can try it; pages must say Fare paid when it does.
- Privacy invariants in CONTRIBUTING.md are binding: no analytics, trackers, third-party fonts or CDNs on any page; no purchase ids in public views; the issuer never sees tokens and the origin never sees purchases.
- Terminology: pack, purchase, token, issuer, origin (the provider's API), scanner, viewing key, TAZ, shielded, 402.

## Brand Commitments

- Name: Fare. Mark: a vermilion perforated stamp holding the two dots, one filled, one an outline.
- Voice: direct, short, factual. No hype words, no speculative claims, no em dashes anywhere.
- Simulated things are labeled "simulated"; testnet is stated wherever value appears.
- The sheet-of-stamps identity (Oct 25) replaced the earlier "Quiet ledger" look; `DESIGN.md` records it as built.

## Evidence on Hand

- Real testnet transactions to the demo merchant (README proof table), with explorer screenshots in `docs/explorer/` and hosted-run screenshots in `docs/hosted/`.
- The published incoming viewing key (README, /proof).
- Live, id-free counts: the issuer ledger (`/fare/ledger`) and the API's redemption stats (`/v1/stats`), and the anonymity set per key.
- GitHub Actions runs for the canary, serve, demo and failure-path proofs.
- Absent, never to be fabricated: customers, testimonials, usage numbers beyond the live counts, mainnet deployments, prices other than the one pack, benchmarks other than the measured timings in docs/protocol.md.

## Product Principles

1. Prove, don't claim: every privacy statement links to something a visitor can check.
2. Say what it does not hide: IP and timing correlation, a small anonymity set, request content, one operator running both sides, the demo payer.
3. Refusals are features: every flow shows its refusal cases (replay, underpaid, unlisted key).
4. Nothing leaves the page that does not have to: no third-party requests, tokens stay in the buyer's browser.
5. Honest status: testnet, simulated and pre-release are labeled where they apply.

## Accessibility & Inclusion

WCAG 2.1 AA, verified by axe in both colour schemes; works at 375 px; full keyboard path through the buyer flow; reduced motion respected.
