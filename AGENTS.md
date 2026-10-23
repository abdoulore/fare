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
- **On-chain proof required.** The final demo uses real mainnet txids, not mocks.
- **Research before asking** when a fact can be verified (crate source, RFCs, official docs).
- **Writing:** direct, short, factual, no speculative claims. Label anything simulated as simulated, in the UI and in the README.

## Status (Oct 23)

| Part | State |
| --- | --- |
| `scanner/` (Rust) | Built. 11 tests green, clippy clean. Testnet canary pending: the owner runs it. |
| `token-canary/` (Node) | Passed 11 of 11 checks with 100 tokens. Native signing measured. |
| Issuer, origin, SDK, demo API, panel | Not started. Blocked on gate 1. |

## Gates

1. **Zcash canary** (owner runs it on testnet for now, `init --network test`). Pass: `CANARY PASS` with the same txid the paying wallet shows, plus a second purchase that stays `underpaid`. Until it passes, do not start issuer, origin or SDK work. Fixing scanner bugs the canary reveals is allowed.
2. **Token canary.** Passed Oct 23 (`token-canary/canary.mjs`).

## Locked decisions

Do not change these without the owner.

| Decision | Choice |
| --- | --- |
| Track | Shielded Payments |
| Tokens | Privacy Pass publicly verifiable tokens, Blind RSA 2048, PSS (RFC 9578 type 2) |
| Issue tokens at | 1 confirmation (about 75 s). Never from the mempool alone |
| Payment matching | Fresh shielded-only address per purchase, matched by diversifier index. No memo, no transaction lookups |
| Demo payer | Ore paying from Zodl. Headless agent wallet is a stretch goal |
| Demo API | An LLM or search proxy an agent calls in a loop |
| Proof for judges | Demo merchant's incoming viewing key published |
| Networks | Offline fixtures and testnet for development and the canary (owner, Oct 23). Final run on mainnet unless the owner changes it |

## Open decisions

Ask the owner before implementing. Recommendation in bold.

| Decision | Options | Recommendation |
| --- | --- | --- |
| Issuer signing | Library JavaScript (300 ms per token) or native OpenSSL (0.42 ms, byte-identical output) | **Native, with verify-before-release** |
| Pack size and price | One fixed pack, or several | **One pack of 100 calls**; the owner sets the price |
| Demo API | LLM proxy or search proxy | Owner's call |
| Issuer key epoch | Daily or weekly rotation | **7 days, with a 24 h grace window for the previous key** |

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
    src/main.rs        CLI: init, mint, scan, status, viewing-key
    tests/attribution.rs   real note encryption through the scanner
    tests/invariants.rs    source checks that fail the build on leaks
  token-canary/        Node: Privacy Pass proof (canary.mjs, native-sign.mjs)
```

Planned, create as needed: `issuer/` (TypeScript: purchases API, epoch keys, issuer directory), `origin/` (TypeScript: 402 middleware, verify, spent-nonce store), `sdk/` (TypeScript client), `demo/` (demo API and agent loop), `panel/` (server-view panel).

## Commands

```
cd scanner
cargo build --release
cargo test                       # must stay green
cargo clippy --all-targets       # must stay clean

./target/release/fare-scanner init --network main [--server URL] [--ufvk KEY] [--birthday H]
./target/release/fare-scanner mint --zec 0.001 [--label X]
./target/release/fare-scanner scan [--mempool] [--check-transparent] [--from H]
./target/release/fare-scanner status
./target/release/fare-scanner viewing-key

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
6. One issuer key per epoch, published at `/.well-known/private-token-issuer-directory`. The SDK pins it and aborts on any other key. Never per-user or per-purchase keys.
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
- Default lightwalletd: `https://lightwalletd.mainnet.cipherscan.app:443`, `https://lightwalletd.testnet.cipherscan.app:443`.

**Privacy Pass (`@cloudflare/privacypass-ts` 0.9.0)**

- Use `publicVerif` with `BlindRSAMode.PSS`, RSA 2048, e = 65537. Token type 2.
- One `Client` instance per token: it holds that token's blinding state.
- `header_to_token` parses a `WWW-Authenticate` challenge and runs issuance. It does not parse `Authorization`. Use `AuthorizationHeader.parse(BLIND_RSA, header)` and `new AuthorizationHeader(token).toString()`, and `WWWAuthenticateHeader` for the 402 challenge.
- `Origin.verify` checks the signature only. The origin must check key id, challenge digest (SHA-256 of the serialized challenge) and the spent set itself.
- Sizes: token 354 bytes, `Authorization` header about 491 characters, `WWW-Authenticate` about 538.
- Speed on Node 22: client blind about 31 ms, library sign 300 ms, native sign 0.42 ms, verify about 0.2 ms.
- Native blind signing is one RSA private operation with no padding: `crypto.privateDecrypt({ key, padding: RSA_NO_PADDING }, blindedMsg)`, then `publicEncrypt` with no padding must give back the blinded message before the signature is released. See `token-canary/native-sign.mjs`. Use it only after the owner approves native signing.

## API contract

From the spec. Keep these shapes.

- Origin, no token: `402` with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` and `Fare-Offer: {"pack": N, "price_zec": "...", "issuer": "<url>"}`.
- `GET /.well-known/private-token-issuer-directory` in RFC 9578 format: `issuer-request-uri` plus `token-keys` entries of `{token-type: 2, token-key: <base64url SPKI>, not-before}`.
- `POST /fare/purchases` with `{pack, blinded: [base64url, ...N]}` returns `201 {purchase_id, pay_uri, expires_at}`. `purchase_id` is 128 random bits, hex.
- `GET /fare/purchases/{id}` returns `{status}`; once paid, `{status: "paid", signatures: [base64url, ...N]}` in request order.
- Redemption: `Authorization: PrivateToken token="<base64url>"`. Failures return `401` with one of `token_reused`, `bad_signature`, `unknown_key`, `wrong_challenge`, `expired_epoch`.
- Scanner sidecar (`fare-scanner serve`, to build): bind `127.0.0.1` only. `POST /mint {price_zat}` returns `{purchase_id, index, address, pay_uri}`; `GET /purchases/{id}` returns `{status, received_zat, payments}`. Scanner ids are 64-bit today; move to 128-bit when building `serve`.

## Next tasks, after gate 1

**Oct 24: issuance**

1. `fare-scanner serve` with a follow loop: scan from a saved cursor every 15 s and rescan the last 10 blocks for reorgs. Done when a purchase created over HTTP flips to `paid` after a real payment, with handler tests.
2. `issuer/`: purchases API, epoch key, issuer directory, signing as approved. Done when signatures are returned only after `paid`, a wrong N is refused, and unit tests cover both.
3. `sdk/`: pin key, blind, order, poll, finalize, store tokens. Done when the full flow runs against a local issuer with a stubbed scanner status, plus an unpinned-key abort test.

**Oct 25: redemption.** Origin middleware with the checks in invariant 9, the demo API and agent loop, the server-view panel with anonymity-set size.

**Oct 26: failure paths and mainnet.** Every row of "Failure paths" in `docs/SPEC.md` becomes a test or a scripted demo step. Mainnet run with paid, underpaid and second-payment purchases. Publish the demo viewing key (`fare-scanner viewing-key`).

**Oct 27: proof and polish.** README with a real-versus-mocked table and the residuals, CI (cargo test, clippy, Node tests).

**Oct 28: ship.** Demo video, submission text, repo public.

## Definition of done for the submission

- CI green, clippy clean.
- README: what is real, what is mocked, how to run, residuals.
- Mainnet txids for a paid purchase, an underpaid purchase and a second payment, with CipherScan screenshots showing nothing visible.
- Demo video: pay, detect, issue, N calls, replay refused, panel shows no link between purchases and calls.
- Repo public, every commit dated inside the build window.

## Git

- Small commits, each saying what changed and why. No em dashes.
- Never commit `fare-data/`, seed files, `.env`, keys, `node_modules/` or `target/`.

## Ask the owner before

- Changing a locked decision or a privacy invariant.
- Adding a dependency that phones home, or any hosted service.
- Spending real ZEC. The owner runs mainnet payments.
- Publishing anything: repo visibility, viewing keys, demo URLs.
