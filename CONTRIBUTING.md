# Contributing to Fare

Fare's whole value is a privacy claim, so every change is held to it. Read [`docs/SPEC.md`](docs/SPEC.md) for the design first, then this file. Two reference documents sit beside them:

- [`docs/api.md`](docs/api.md): the HTTP contract between the client, the issuer, the origin and the scanner.
- [`docs/protocol.md`](docs/protocol.md): Zcash, Ironwood and Privacy Pass facts the code relies on, each checked against crate source, the RFCs or official docs.

## Repository layout

```
scanner/        Rust: per-purchase addresses and payment detection (fare-scanner)
  src/keys.rs     seed, UFVK, address minting, PURCHASE_INDEX_BASE = 2^40
  src/scan.rs     trial decryption of compact blocks
  src/store.rs    state.json, purchases, payments, status
  src/lwd.rs      lightwalletd: tip, block range, mempool; nothing targeted
  src/zec.rs      exact ZEC parsing, no floats
  src/service.rs  fetch and commit a scan, mint, the follow loop
  src/http.rs     serve: loopback-only mint and status routes
  src/main.rs     CLI: init, mint, scan, status, check, serve, viewing-key
  tests/          note encryption through the scanner, the canary verdict, serve,
                  watch-only verification, source invariants
wallet/         Rust: fare-wallet, a headless testnet payer
  src/request.rs  which zcash: URIs it pays (one shielded recipient, no memo, under --max-zec)
  src/seed.rs     seed from FARE_PAYER_SEED only
  src/wallet.rs   database, sync, balance, address, propose, build, broadcast
  src/cache.rs    in-memory block cache for sync
issuer/         TypeScript: directory, purchases API, epoch keys, native blind signing
sdk/            TypeScript client: src/core.ts runs in browsers; src/index.ts adds a Node file store
origin/         TypeScript middleware: 402 challenge, redemption checks, spent-nonce store
demo/           TypeScript: LLM proxy behind the origin, paying agent, panel, demo payer
web/            Vite and React frontend; e2e/stack.ts is the local stack Playwright runs against
deploy/         one-VPS deployment: Caddyfile, systemd units, setup.sh, env templates
token-canary/   Node: the Privacy Pass proof (canary.mjs, native-sign.mjs)
docs/           design, API contract, protocol notes, testnet evidence
```

TypeScript packages run on Node 22 type stripping, with no build step except `web/`.

## Build and test

```
cd scanner && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings
cd wallet  && cargo test --locked && cargo clippy --all-targets --locked -- -D warnings

# from the repository root; each package installs the ones it imports from
npm ci --prefix issuer && npm run typecheck --prefix issuer && npm test --prefix issuer
npm ci --prefix sdk    && npm run typecheck --prefix sdk    && npm test --prefix sdk
npm ci --prefix origin && npm run typecheck --prefix origin && npm test --prefix origin
npm ci --prefix demo   && npm run typecheck --prefix demo   && npm test --prefix demo
npm ci --prefix web    && npm run typecheck --prefix web    && npm test --prefix web
cd web && npx playwright install chromium && npx playwright test && npm run design:check

cd token-canary && npm ci && node canary.mjs && node native-sign.mjs
```

CI (`.github/workflows/ci.yml`) runs all of these on every push. Tests stay green and clippy stays clean. `npx playwright test` builds the site and starts `web/e2e/stack.ts` (the real issuer, origin and demo API with a stub scanner and a stub wallet) itself.

Running the services:

```
./target/release/fare-scanner init --network test [--server URL] [--ufvk KEY] [--birthday H]
./target/release/fare-scanner mint --zec 0.001 [--label X]
./target/release/fare-scanner scan [--mempool] [--check-transparent] [--from H]
./target/release/fare-scanner status
./target/release/fare-scanner check --paid LABEL [--paid ...] --underpaid LABEL [...]
./target/release/fare-scanner viewing-key
./target/release/fare-scanner --dir verify init --network test --uivk KEY --birthday H   # watch-only verifier
./target/release/fare-scanner serve [--listen 127.0.0.1:7077] [--interval 15] [--reorg-depth 10]

./target/release/fare-wallet init --birthday H          # FARE_PAYER_SEED set, testnet phrase only
./target/release/fare-wallet sync | balance | address
./target/release/fare-wallet pay "zcash:<UA>?amount=0.001" --max-zec 0.002 [--wait-secs N]

cd issuer && npm start                     # ISSUER_LISTEN, ISSUER_DATA, SCANNER_URL
cd demo && npm run api                     # API 127.0.0.1:8080, panel 127.0.0.1:8790/panel
cd demo && CALLS=5 npm run agent           # pays with fare-wallet, then replays a token
cd demo && npm run payer                   # demo payer on 127.0.0.1:8791 (FARE_PAYER_SEED, testnet)
cd web && npm run dev                      # against a local issuer, API and payer
```

### Chain access

The scanner and the wallet talk to lightwalletd directly (default `https://testnet.zec.rocks:443`). Environments that block outbound DNS or gRPC cannot reach it; the `testnet-*.yml` workflows run every chain-facing step on GitHub runners instead. They need the repository secrets `FARE_TESTNET_UFVK` (the merchant viewing key) and `FARE_PAYER_SEED` (a testnet-only phrase), and optionally `ANTHROPIC_API_KEY`.

## Privacy invariants

Non-negotiable. Each one has a test; extend the tests, never weaken them. Code comments refer to these by number.

1. The scanner holds a viewing key only. It never reads the seed file after `init`. `fare-data/` and seeds are never committed.
2. No targeted lookups. Only `GetLatestBlock`, `GetBlockRange` and `GetMempoolTx`. Never `GetTransaction`, `TxFilter`, or any address query (`get_taddress*`, `get_address_utxos*`). `scanner/tests/invariants.rs` enforces this.
3. No memos. Pay URIs are exactly `zcash:<UA>?amount=<price>`. Payments are matched by diversifier index.
4. Purchase addresses carry an Orchard-type receiver only (no transparent, no Sapling). A fresh index per purchase, counted up from `PURCHASE_INDEX_BASE` (2^40), never reused.
5. Fixed pack sizes. The issuer rejects any other N.
6. One issuer key per epoch, published at `/.well-known/private-token-issuer-directory`. The SDK pins it and aborts on any key the directory does not list. On rotation it re-reads the directory and follows only a key listed there. Never per-user or per-purchase keys.
7. The issuer never sees tokens; the origin never sees purchases. No shared table, id or log between them. The panel shows both sides with no join key.
8. Never log client IPs, user agents or request timing next to purchase ids or token nonces. Each side keeps only what it needs.
9. Tokens bind to a challenge with an empty redemption context and the origin's name. The origin checks key id, challenge digest, signature and spent set, and only then serves.
10. No tokens for mempool-only payments. One confirmation minimum.
11. Payments funded from transparent inputs are flagged, never silently accepted (`scan --check-transparent`).
12. No analytics, trackers, third-party fonts or CDNs in any page served to buyers.

The frontend adds its own: blinding and unblinding happen only in the browser, purchase ids never appear in public views or next to IPs, and no payer seed or merchant viewing key goes into a client bundle.

## How changes are made

- **Design decisions** are listed in `docs/SPEC.md`. Open an issue before changing one, or before changing an invariant.
- **Refusals ship with features.** Every feature comes with its refusal cases and tests, not only the happy path. `docs/SPEC.md` lists each failure path with the test that proves it.
- **Prove primitives on real data.** Anything that touches the chain is proven on testnet, with real txids, before anything is built on it.
- **Label simulations.** Anything simulated says so, in the UI and in the docs. Demo answers without a model key are labelled "simulated" on every answer.
- **Dependencies.** No dependency that phones home, and no hosted service, without an issue first.
- **Spending.** The project runs on testnet. Workflows that pay are dispatched by a maintainer.

## Writing style

Direct, short and factual. No speculative claims. No em dashes anywhere (code, comments, docs, commit messages, UI copy): use commas, colons, periods or parentheses.

## Git

- Small commits, each saying what changed and why.
- Never commit `fare-data/`, `fare-wallet-data/`, `issuer-data/`, `origin-data/`, wallet databases, seed files, `.env`, keys, `node_modules/` or `target/`. `.gitignore` covers them; keep it that way.
- Never log the payer seed, a spending key or a full viewing key. The demo's published key is an incoming viewing key, which can see payments but not spend.

## Dev-only tools

**impeccable** (Apache-2.0) checks `web/` for design and accessibility defects at development time. It never ships to buyers:

- It is a pinned `devDependency` of `web/` (`impeccable` 4.7.0). The app imports nothing from it and the built site contains no trace of it.
- Telemetry is off twice: `IMPECCABLE_NO_TELEMETRY=1` wherever it runs, and `"telemetry": false` in `web/.impeccable/config.json`. `detect` runs offline. Do not run its `init` or `live` commands.
- `npm run design:check` in `web/` (and CI's web job) scans the source and `/`, `/app`, `/developers` and `/proof` rendered on the local e2e stack at 1280 and 375 px. It must stay clean.
- Waivers go in `web/.impeccable/config.json` with a reason; remove a waiver when the design it covered is gone.
- `web/DESIGN.md`, `web/PRODUCT.md` and `web/.impeccable/` describe the design system as built. They are development files, never served. Keep them factual and update them when the system changes.
- Running as root, Chromium needs `--no-sandbox`: point `IMPECCABLE_BROWSER` at a wrapper that adds it. CI runners do not need this.
