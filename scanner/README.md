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
fare viewing-key                  # incoming-only key to publish for the demo account
```

`--server <url>` on `init` picks the lightwalletd. Default: CipherScan's public server for the network.

## Canary (mainnet)

1. `fare init --network main`, then move the seed file offline.
2. `fare mint --zec 0.001 --label canary`
3. Pay the printed address from a shielded balance in Zodl. Wait about 3 minutes.
4. `fare scan --mempool --check-transparent`. Pass = `CANARY PASS` with the same txid Zodl shows.
5. `fare mint --zec 0.001 --label underpay`, pay 0.0005, `fare scan`. Pass = `underpaid (short 0.0005 ZEC)`.

If the scan reports zero Ironwood actions over hundreds of blocks, the server is not serving Ironwood data: rerun `init` in a new directory with `--server`.

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

Not yet proven: the live network path. That is the canary.

## Tests

```
cargo test
```

11 tests: exact ZEC parsing, attribution across 8 cases (exact, underpaid, Orchard list, foreign key, wrong-pool note, wallet's own address, transparent-funded, note hidden between decoys), mempool then confirmation then overpayment, address round trip, key encoding, seed generation, three source invariants.
