# AGENTS.md

Instructions for any coding agent working in this repo (Claude Code, Codex, Cursor and others). Read this file first, then `docs/SPEC.md`.

## What you are building

Fare: pay once in shielded ZEC, then call an API with Privacy Pass tokens nobody can link back to the payer, including the API itself. Entry for ZECATHON 2026 (thezecathon.com), Shielded Payments track. Owner: Ore.

## Deadline

Submissions close **Oct 28, 2026, 23:59 UTC** (Oct 29, 00:59 Lagos). Target: submitted by Oct 28, 20:00 Lagos.

## Rules that can disqualify the entry

1. One person registers and submits: Ore.
2. All code written during the build window (Sep 28 to Oct 28, 2026). Libraries are fine; existing products are not. Do not copy code from other repos (nerdcash/zcash-payment-service, CipherPay, CipherScan, other Zecathon entries). Read them as reference only.
3. Open source at submission.
4. One submission, one track: Shielded Payments.

Judges score four things. **Privacy:** does it actually preserve privacy; leaks are disqualifying, not deductions. **Usefulness:** would someone use this on Monday. **Execution:** does it run; working beats ambitious. **Originality:** built for this hackathon, not repackaged.

## How the owner works

- **No em dashes anywhere:** code, comments, docs, commit messages, UI copy. Use commas, colons, periods or parentheses.
- **Review before build.** Architectural judgment calls go to the owner as a short question with your recommendation. Do not decide them yourself. Implementation details inside locked decisions are yours.
- **Canary rule.** Prove each primitive with real data before building on it. Gates are below.
- **Never demo only the happy path.** Every feature ships with its refusal cases and tests.
- **On-chain proof required.** The demo uses real testnet txids, not mocks.
- **Research before asking** when a fact can be verified (crate source, RFCs, official docs).
- **Writing:** direct, short, factual, no speculative claims. Label anything simulated as simulated, in the UI and in the README.

## Status (Oct 24)

| Part | State |
| --- | --- |
| `scanner/` (Rust) | Built. 33 tests green, clippy clean. Watch-only verifier (`init --uivk`) added Oct 26. `serve` proven on testnet Oct 24 ([run](https://github.com/abdoulore/fare/actions/runs/40091932215)): a purchase minted over HTTP went pending, in_mempool, paid after `fare-wallet` paid it in tx `9a6e1bf355929f15ccf13035d00c8e6dea01e56145d6ea4dbb068d71bdb24740` (height 4,535,836). |
| `wallet/` (Rust) | Built Oct 24. 26 tests green, clippy clean. Paid both canary purchases on testnet. |
| `token-canary/` (Node) | Passed 11 of 11 checks with 100 tokens. Native signing measured. |
| `issuer/` (TypeScript) | Built Oct 24. 19 tests green, typecheck clean. Native signing, 7-day epoch keys. |
| `sdk/` (TypeScript) | Built Oct 24. 12 tests green against the real issuer with a stub scanner. Follows key rotation through the directory (Oct 25). |
| `origin/` (TypeScript) | Built Oct 25. 11 tests green, end to end with the real issuer and SDK. |
| `demo/` (TypeScript) | Built Oct 25. LLM proxy behind the origin, agent paying with `fare-wallet`, loopback panel. 9 tests. Whole stack run on testnet ([run](https://github.com/abdoulore/fare/actions/runs/40096150452)): the agent hit a 402, paid 0.001 TAZ in tx `2e97c74b44bce98c4b6707928c78df62e6b630b042146b824dea833b964ae5b8`, got 100 tokens once it confirmed, made 5 calls (answers simulated: no model key secret), and a replayed token got `401 token_reused`. Panel: 1 paid purchase, 100 tokens issued, 6 redeemed, 1 refused, "one of 100 tokens from 1 purchase". |
| Failure paths, testnet | Oct 26 ([run](https://github.com/abdoulore/fare/actions/runs/40098320054)): paid (+4, tx `b01a1fc0...a4df`, 100 tokens, a call served), underpaid (+5, tx `0c3e538b...058d`, no signatures), paid twice (+6, txs `60d3f691...ebf3` and `d3529ffb...a652`, 200000 zat recorded, still exactly 100 tokens). A watch-only verifier set up from the published incoming viewing key alone listed all four payments by index. Every SPEC failure-path row names its proving test. |
| Demo viewing key | Published in README (owner approved Oct 26). |

## Gates

1. **Zcash canary, testnet. Passed Oct 24.** `.github/workflows/testnet-canary.yml` with `pay: true`, [run 4](https://github.com/abdoulore/fare/actions/runs/40084407257):
   - `canary` paid by `fare-wallet` in tx `fd1e9ee3f90c0e3bd8bf874e86352ab8fb085158190c5242a27e0afa623af9d9` at height 4,535,557. `CANARY PASS` names the same txid, matched by diversifier index base+0 from compact blocks only.
   - `underpay` paid 0.0005 in tx `0346de58cdaa73d7285e7e91448effa2c437978b44cfdf1bc72a4cf9b866652b` at height 4,535,562 and stays `underpaid (short 0.0005 ZEC)`.
   - `fare-scanner check` printed `CHECK PASS`. Scan: 8 blocks, 9 Ironwood actions, 0 unattributed, transparent inputs checked, no transaction lookups.
   - Payer: birthday 4,533,526, funds in Ironwood, fee 0.0001 per payment, one transaction each.
2. **Token canary.** Passed Oct 23 (`token-canary/canary.mjs`).

## Locked decisions

Do not change these without the owner.

| Decision | Choice |
| --- | --- |
| Track | Shielded Payments |
| Tokens | Privacy Pass publicly verifiable tokens, Blind RSA 2048, PSS (RFC 9578 type 2) |
| Issue tokens at | 1 confirmation (about 75 s). Never from the mempool alone |
| Payment matching | Fresh shielded-only address per purchase, matched by diversifier index. No memo, no transaction lookups |
| Demo payer | `fare-wallet`, a headless testnet payer (owner, Oct 24). Consumer wallets are not used: Noir's testnet build signs with the pre-Ironwood branch id |
| Proof for judges | Demo merchant's incoming viewing key published |
| Networks | Testnet for the canary and the demo (owner, Oct 24). Offline fixtures for development. Server: `testnet.zec.rocks` |
| Issuer signing | Native OpenSSL blind RSA, each signature verified against the public key before release (owner, Oct 24) |
| Pack and price | One pack: 100 calls for 0.001 TAZ. The issuer refuses any other N (owner, Oct 24) |
| Demo API | LLM proxy. With no model API key on the demo host, a canned responder labeled "simulated" in the UI and README (owner, Oct 24) |
| Issuer key epoch | Rotates every 7 days; the previous key stays valid for a 24 h grace window (owner, Oct 24) |

## Open decisions

None. All four were decided Oct 24 and moved to Locked decisions.

## Repository layout

```
fare/
  AGENTS.md            this file
  CLAUDE.md            loads this file for Claude Code
  README.md            project overview
  docs/SPEC.md         full build spec (live version linked inside)
  docs/architecture.png
  scanner/             Rust: per-purchase addresses and payment detection
    src/keys.rs        seed, UFVK, address minting, PURCHASE_INDEX_BASE = 2^40
    src/scan.rs        trial decryption of compact blocks (Detector)
    src/store.rs       state.json, Purchase, Payment, Status
    src/lwd.rs         lightwalletd: tip, block range, mempool; nothing targeted
    src/zec.rs         exact ZEC parsing, no floats
    src/service.rs     fetch and commit a scan, mint, the follow loop
    src/http.rs        serve: loopback-only mint and status routes
    src/main.rs        CLI: init, mint, scan, status, check, serve, viewing-key
    tests/attribution.rs   real note encryption through the scanner
    tests/check.rs         the canary verdict
    tests/serve.rs         serve handlers, reorg rescan, loopback rule
    tests/watch_only.rs    verifying with the published incoming viewing key
    tests/invariants.rs    source checks that fail the build on leaks
  wallet/              Rust: fare-wallet, headless testnet payer
    src/request.rs     which zcash: URIs it pays (one shielded recipient, no memo, under --max-zec)
    src/seed.rs        seed from FARE_PAYER_SEED only
    src/wallet.rs      database, sync, balance, address, propose, build, broadcast
    src/cache.rs       in-memory BlockCache for sync::run
    tests/             refusals, CLI, source invariants
  issuer/              TypeScript (Node 22 type stripping, no build step)
    src/app.ts         directory, POST and GET /fare/purchases
    src/keys.ts        one key per 7-day epoch, 24 h grace, stored in issuer-data/keys
    src/sign.ts        native blind RSA with verify-before-release
    src/store.ts       purchases: id, epoch, blinded requests, pay URI, expiry
    src/scanner.ts     client for fare-scanner serve
  sdk/                 TypeScript client: pin, 402 handling, order, collect, spend
  origin/              TypeScript middleware: 402 challenge, invariant 9 checks, spent-nonce store
  demo/                TypeScript: LLM proxy (src/server.ts, src/llm.ts), agent (src/agent.ts), panel (src/panel.ts)
  token-canary/        Node: Privacy Pass proof (canary.mjs, native-sign.mjs)
  .github/workflows/   ci.yml, testnet-canary.yml, testnet-wallet.yml, testnet-serve.yml, testnet-demo.yml, testnet-failure-paths.yml
```

The panel lives in `demo/src/panel.ts`, not a separate `panel/` package.

## Commands

```
cd scanner
cargo build --release
cargo test                       # must stay green
cargo clippy --all-targets       # must stay clean

./target/release/fare-scanner init --network test [--server URL] [--ufvk KEY] [--birthday H]
./target/release/fare-scanner mint --zec 0.001 [--label X]
./target/release/fare-scanner scan [--mempool] [--check-transparent] [--from H]
./target/release/fare-scanner status
./target/release/fare-scanner check --paid LABEL [--paid ...] --underpaid LABEL [...]
./target/release/fare-scanner viewing-key
./target/release/fare-scanner --dir verify init --network test --uivk KEY --birthday H   # watch-only verifier
./target/release/fare-scanner serve [--listen 127.0.0.1:7077] [--interval 15] [--reorg-depth 10]

cd wallet                        # FARE_PAYER_SEED in the environment, testnet phrase only
cargo test && cargo clippy --all-targets -- -D warnings
./target/release/fare-wallet init --birthday H
./target/release/fare-wallet sync | balance | address
./target/release/fare-wallet pay "zcash:<UA>?amount=0.001" --max-zec 0.002 [--wait-secs N]

cd issuer && npm ci && npm test && npm run typecheck
npm start                        # ISSUER_LISTEN, ISSUER_DATA, SCANNER_URL

cd sdk && npm ci --prefix ../issuer && npm ci && npm test
cd origin && npm ci --prefix ../issuer && npm ci --prefix ../sdk && npm ci && npm test
cd demo && npm ci && npm run api          # API 127.0.0.1:8080, panel 127.0.0.1:8790/panel
cd demo && CALLS=5 npm run agent          # pays with fare-wallet, then replays a token

cd token-canary
npm install
node canary.mjs                  # N=100 by default
node native-sign.mjs
```

## Privacy invariants

Non-negotiable. Each one needs a test. Extend the tests, never weaken them.

1. The scanner holds a viewing key only. Never read the seed file after `init`. Never commit `fare-data/` or any seed.
2. No targeted lookups. Use only `GetLatestBlock`, `GetBlockRange` and `GetMempoolTx`. Never `GetTransaction`, `TxFilter`, or any address query (`get_taddress*`, `get_address_utxos*`). `tests/invariants.rs` enforces this.
3. No memos. Pay URIs are exactly `zcash:<UA>?amount=<price>`. Payments are matched by diversifier index.
4. Purchase addresses carry an Orchard-type receiver only (no transparent, no Sapling). A fresh index per purchase, counted up from `PURCHASE_INDEX_BASE` (2^40), never reused.
5. Fixed pack sizes. The issuer rejects any other N.
6. One issuer key per epoch, published at `/.well-known/private-token-issuer-directory`. The SDK pins it and aborts on any key the directory does not list. On rotation it re-reads the directory and follows only a key listed there. Never per-user or per-purchase keys.
7. The issuer never sees tokens; the origin never sees purchases. No shared table, id or log between them. The panel shows both sides with no join key.
8. Never log client IPs, user agents or request timing next to purchase ids or token nonces. Each side keeps only what it needs.
9. Tokens bind to a challenge with an empty redemption context and the origin's name. The origin checks key id, challenge digest, signature and spent set, and only then serves.
10. No tokens for mempool-only payments. 1 confirmation minimum.
11. Payments funded from transparent inputs are flagged, never silently accepted (`scan --check-transparent`).
12. No analytics, trackers, third-party fonts or CDNs in any page served to buyers.

## Verified protocol facts

Already checked against crate source and official docs (sources in `docs/SPEC.md`). Do not re-derive.

**Zcash and Ironwood**

- NU6.3 (Ironwood) activated on mainnet at block 3,428,143 (Jul 28, 2026) and on testnet at 4,134,000. New shielded notes go to Ironwood; Orchard is withdraw-only.
- Ironwood reuses the Orchard key and receiver structure. One Orchard incoming viewing key decrypts both pools.
- Note plaintext lead byte: `0x03` for Ironwood (`NoteVersion::V3`), `0x02` for Orchard (`V2`). `orchard::note_encryption::IronwoodDomain` accepts only `0x03`; `OrchardDomain` only `0x02`.
- Compact blocks: `CompactTx.ironwood_actions` (proto tag 9) holds Ironwood actions; `CompactTx.actions` holds Orchard. Each compact action carries 52 bytes of ciphertext: lead byte, diversifier, value, rseed. No memo.
- `BlockRange.pool_types` empty means shielded pools only. Add `Transparent` to get `vin`, which is how transparent funding is flagged. Older servers may refuse pool filters; the scanner falls back.
- Crates: `orchard` 0.16.0, `zcash_client_backend` 0.25.0 (features `lightwalletd-tonic`, `lightwalletd-tonic-tls-webpki-roots`, `lightwalletd-tonic-transport`), `zcash_keys` 0.17.0, `zcash_protocol` 0.11.0, `zcash_note_encryption` 0.5.1, `zip32` 0.3.0, `tonic` 0.14. UFVK and UIVK `encode` return `Result`.
- `Rho::from_nf_old` is crate-private. Use `Rho::from_bytes(&nf.to_bytes())`.
- Default lightwalletd: testnet `https://testnet.zec.rocks:443`; mainnet `https://lightwalletd.mainnet.cipherscan.app:443`. CipherScan's testnet server presents a certificate for `api.testnet.cipherscan.app` (Oct 24), so it fails TLS.
- Claude Code cloud sandboxes cannot reach lightwalletd (the scanner and wallet connect directly and DNS is blocked). Anything that talks to the chain runs on a GitHub Actions runner.

**Payer wallet (`zcash_client_sqlite` 0.23.0, `zcash_proofs` 0.31.0)**

- `sync::run(client, params, cache, db, batch)` needs a `BlockCache`. `zcash_client_sqlite` 0.23 implements only `BlockSource` (for `BlockDb` and `FsBlockDb`), so `wallet/src/cache.rs` provides an in-memory one.
- `sync::run` refreshes UTXOs by address only with the `transparent-inputs` feature. The wallet leaves it off.
- `propose_standard_transfer_to_address` returns `Error::InsufficientFunds { available, required }`, and `Error::ScanRequired` before the first scan.
- After NU6.3, `propose_transfer` plans payments funded from Orchard notes as ZIP 318 canonical crossings itself.
- `LocalTxProver::bundled()` (feature `bundled-prover`) needs no parameter download. The release binary is about 73 MB.

**Privacy Pass (`@cloudflare/privacypass-ts` 0.9.0)**

- Use `publicVerif` with `BlindRSAMode.PSS`, RSA 2048, e = 65537. Token type 2.
- One `Client` instance per token: it holds that token's blinding state.
- `header_to_token` parses a `WWW-Authenticate` challenge and runs issuance. It does not parse `Authorization`. Use `AuthorizationHeader.parse(BLIND_RSA, header)` and `new AuthorizationHeader(token).toString()`, and `WWWAuthenticateHeader` for the 402 challenge.
- `Origin.verify` checks the signature only. The origin must check key id, challenge digest (SHA-256 of the serialized challenge) and the spent set itself.
- Sizes: token 354 bytes, `Authorization` header about 491 characters, `WWW-Authenticate` about 538.
- Speed on Node 22: client blind about 31 ms, library sign 300 ms, native sign 0.42 ms, verify about 0.2 ms.
- Native blind signing is one RSA private operation with no padding: `crypto.privateDecrypt({ key, padding: RSA_NO_PADDING }, blindedMsg)`, then `publicEncrypt` with no padding must give back the blinded message before the signature is released. See `token-canary/native-sign.mjs`. Approved by the owner Oct 24.

## API contract

From the spec. Keep these shapes.

- Origin, no token: `402` with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` and `Fare-Offer: {"pack": N, "price_zec": "...", "issuer": "<url>"}`.
- `GET /.well-known/private-token-issuer-directory` in RFC 9578 format: `issuer-request-uri` plus `token-keys` entries of `{token-type: 2, token-key: <base64url SPKI>, not-before}`.
- `POST /fare/purchases` with `{pack, blinded: [base64url, ...N]}` returns `201 {purchase_id, pay_uri, expires_at}`. Each `blinded` entry is a whole serialized `TokenRequest` (259 bytes), so the issuer knows the key. `purchase_id` is 128 random bits, hex (the scanner's id). `expires_at` is ISO 8601, 24 h out.
- Purchase refusals are `400 {error}`: `wrong_pack`, `wrong_count`, `malformed_request`, `duplicate_request`, `unknown_key`, `unknown_field`, `body_not_json`; `413 body_too_large`; `503 scanner_unavailable`.
- `GET /fare/purchases/{id}` returns `{status}` (`pending`, `in_mempool`, `confirming`, `underpaid`, `expired`); once paid, `{status: "paid", signatures: [base64url, ...N]}` in request order, plus `warning: "funded_from_transparent_inputs"` when flagged. A paid purchase whose key retired is `410 {status: "key_retired"}`.
- Redemption: `Authorization: PrivateToken token="<base64url>"`. Failures return `401` with one of `token_reused`, `bad_signature`, `unknown_key`, `wrong_challenge`, `expired_epoch`.
- Scanner sidecar (`fare-scanner serve`): loopback only. `POST /mint {price_zat}` returns `201 {purchase_id, index, address, pay_uri}`; `GET /purchases/{id}` returns `{status, received_zat, payments, price_zat, leaky_funding, scanned_to, required_confirmations}`. `status` is one of `pending`, `in_mempool`, `confirming`, `paid`, `underpaid`. Ids are 128 bits, hex. Errors are `{error}` with 400 or 404.

## Next tasks, after gate 1

**Oct 24: issuance**

1. `fare-scanner serve` with a follow loop: scan from a saved cursor every 15 s and rescan the last 10 blocks for reorgs. Done when a purchase created over HTTP flips to `paid` after a real payment, with handler tests.
2. `issuer/`: purchases API, epoch key, issuer directory, signing as approved. Done when signatures are returned only after `paid`, a wrong N is refused, and unit tests cover both.
3. `sdk/`: pin key, blind, order, poll, finalize, store tokens. Done when the full flow runs against a local issuer with a stubbed scanner status, plus an unpinned-key abort test.

**Oct 25: redemption.** Origin middleware with the checks in invariant 9, the demo API and agent loop, the server-view panel with anonymity-set size.

**Oct 26: failure paths and the testnet run.** Every row of "Failure paths" in `docs/SPEC.md` becomes a test or a scripted demo step. Testnet run with paid, underpaid and second-payment purchases, paid by `fare-wallet`. Publish the demo viewing key (`fare-scanner viewing-key`).

**Oct 27: proof and polish.** README with a real-versus-mocked table, threat model and residuals (done Oct 27). CI runs every package: scanner, wallet, issuer, sdk, origin, demo, token canaries.

**Oct 28: ship.** Demo video, submission text, repo public.

## Definition of done for the submission

- CI green, clippy clean.
- README: what is real, what is mocked, how to run, residuals.
- Testnet txids for a paid purchase, an underpaid purchase and a second payment, with testnet explorer screenshots showing nothing visible.
- Demo video: pay, detect, issue, N calls, replay refused, panel shows no link between purchases and calls.
- Repo public, every commit dated inside the build window.

## Git

- Small commits, each saying what changed and why. No em dashes.
- Never commit `fare-data/`, `fare-wallet-data/`, wallet databases, seed files, `.env`, keys, `node_modules/` or `target/`.
- Never log the payer seed, a spending key or a full viewing key.

## Ask the owner before

- Changing a locked decision or a privacy invariant.
- Adding a dependency that phones home, or any hosted service.
- Spending real ZEC. The project runs on testnet; the owner dispatches the workflows that pay.
- Publishing anything: repo visibility, viewing keys, demo URLs.
