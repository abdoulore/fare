# fare-scanner

Detects shielded ZEC payments to per-purchase addresses. Holds a viewing key only. Reads whole compact blocks. Never looks up a transaction, never needs a memo.

## How it matches a payment

Each purchase gets a fresh shielded-only address at its own diversifier index, counted up from 2^40 so it never collides with addresses a wallet hands out. Every compact Orchard-type action carries the first 52 bytes of the note plaintext: lead byte, diversifier, value, rseed. Trial decryption with the incoming viewing key recovers the receiving address, and the address gives back its index. Index j is purchase j. No memo, no full transaction, no server learns which transaction is ours.

Ironwood (NU6.3) reuses the Orchard key and receiver structure. Compact blocks carry Ironwood actions in their own list, `ironwood_actions`. The scanner decrypts that list under `IronwoodDomain` (note lead byte `0x03`) and the legacy list under `OrchardDomain` (`0x02`), so a note is never counted in the wrong pool.

## Commands

```
cargo build --release
alias fare=./target/release/fare-scanner

fare init --network main          # new seed in fare-data/SEED-MOVE-OFFLINE.txt; move it offline
fare init --ufvk <key>            # or bring an existing unified full viewing key
fare mint --zec 0.001             # fresh address + ZIP-321 pay URI, no memo
fare scan --mempool --check-transparent
fare status                       # last scan, no network
fare check --paid canary --underpaid underpay   # exit 1 unless statuses match, no network
fare viewing-key                  # incoming-only key to publish for the demo account
```

`--server <url>` on `init` picks the lightwalletd. Default: `testnet.zec.rocks` on testnet, CipherScan on mainnet. CipherScan's testnet server currently presents a certificate for another host name.

## Verify with a published key (watch-only)

```
fare --dir verify init --network test --uivk <unified incoming viewing key> --birthday <height>
fare --dir verify scan --from <height> --check-transparent
fare --dir verify status
```

`--uivk` takes the incoming viewing key a merchant publishes (`fare viewing-key`). It yields the same purchase addresses and detects the same payments as the full key, but holds no seed and refuses to mint: a verifier must not hand out the merchant's indices. `status` lists each payment by purchase index (`+N`) with amount, height and txid. A full viewing key passed as `--uivk` is refused.

## serve (the issuer's sidecar)

```
fare serve [--listen 127.0.0.1:7077] [--interval 15] [--reorg-depth 10]
curl -X POST localhost:7077/mint -d '{"price_zat":100000}'
curl localhost:7077/purchases/<purchase_id>
```

- Loopback only: any other listen address is refused, because the sidecar has no authentication.
- `POST /mint` saves the purchase before answering. Ids are 128 random bits, hex.
- `GET /purchases/{id}` gives `status` (`pending`, `in_mempool`, `confirming`, `paid`, `underpaid`), `received_zat`, `payments`, `leaky_funding`.
- The follow loop scans from the saved cursor every `--interval` seconds, rescanning the last `--reorg-depth` blocks. Payments in that window are forgotten and re-recorded, so one a reorg removed disappears instead of lingering.
- It logs heights and counts only: no request data, no purchase ids.
- Proven on testnet Oct 24 (`.github/workflows/testnet-serve.yml`, [run](https://github.com/abdoulore/fare/actions/runs/40091932215)): a purchase minted over HTTP went `pending`, `in_mempool`, `paid` within 30 s of `fare-wallet` paying it in tx `9a6e1bf355929f15ccf13035d00c8e6dea01e56145d6ea4dbb068d71bdb24740`.

## Canary (testnet)

The canary runs on a GitHub runner: `.github/workflows/testnet-canary.yml` with `pay: true`. It rebuilds the merchant from its viewing key (secret `FARE_TESTNET_UFVK`), mints `canary` and `underpay`, pays them 0.001 and 0.0005 from `fare-wallet` (see `wallet/README.md`), scans, then runs:

```
fare check --paid canary --underpaid underpay
```

`scan` always exits 0; `check` is what fails the run. Pass = a green run with `CANARY PASS` naming the payer's txid and `underpay` at `underpaid (short 0.0005 ZEC)`.

If the scan reports zero Ironwood actions over hundreds of blocks, the server is not serving Ironwood data: point `--server` at another Ironwood-ready lightwalletd.

## Privacy rules, enforced by tests

| Rule | Test |
| --- | --- |
| No single-transaction or address lookups | `tests/invariants.rs` fails the build on `GetTransaction`, `TxFilter`, address queries |
| The seed is written once and never read | `tests/invariants.rs` |
| Pay URIs carry no memo | `tests/invariants.rs` |
| Minted addresses have no transparent or Sapling receiver | `tests/attribution.rs` |
| A published incoming key cannot load as a full viewing key | `tests/attribution.rs` |

## What is real

Real: key derivation, address minting, note encryption and decryption, compact block parsing, attribution, status logic. `tests/attribution.rs` builds genuinely encrypted Ironwood and Orchard notes and wraps them in the same protobuf lightwalletd returns.

The live network path is proven on testnet: the [canary](https://github.com/abdoulore/fare/actions/runs/40084407257) (gate 1), `serve`, and the [failure-paths run](https://github.com/abdoulore/fare/actions/runs/40098320054).

## Tests

```
cargo test
```

33 tests: watch-only verification (4), serve handlers and reorg rescans (9), the canary verdict across 8 cases (pass, pending, mempool only, underpaid listed as paid, paid listed as underpaid, unknown label, repeated label, no scan yet), exact ZEC parsing, attribution across 8 cases (exact, underpaid, Orchard list, foreign key, wrong-pool note, wallet's own address, transparent-funded, note hidden between decoys), mempool then confirmation then overpayment, address round trip, key encoding, seed generation, four source invariants.
