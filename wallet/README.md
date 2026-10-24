# fare-wallet

Headless testnet payer for Fare. It pays a Fare purchase URI from shielded notes and prints the txid. The demo agent uses it, and the testnet canary pays through it.

It exists because consumer wallets were not ready: Noir Wallet's testnet build signs with the pre-Ironwood consensus branch id, so testnet nodes reject its transactions (`transaction uses an incorrect consensus branch id`).

## Commands

```
cargo build --release
alias fw=./target/release/fare-wallet

export FARE_PAYER_SEED="<24-word testnet phrase>"   # never a phrase that holds mainnet funds
fw init --birthday <height>        # creates account 0 of the seed, or confirms it exists
fw sync                            # scans to the chain tip
fw balance                         # per pool: Ironwood, Orchard, Sapling, transparent
fw address                         # address to fund it (Orchard-type receiver only)
fw pay "zcash:<UA>?amount=0.001" --max-zec 0.002 [--wait-secs 600]
```

Global options: `--dir` (default `fare-wallet-data`), `--server` (default `https://testnet.zec.rocks:443`), `--network` (only `test` is accepted).

`pay` syncs first. `--wait-secs` keeps syncing while notes are still pending, such as change from a payment a minute ago, so a second payment can follow the first.

## Seed rules

- The seed comes only from the environment variable `FARE_PAYER_SEED`. It is never printed, written to disk or logged, and errors about it never quote a word.
- In GitHub Actions it is the repository secret `FARE_PAYER_SEED`, passed only to the `init` and `pay` steps.
- The wallet database (`fare-wallet-data/wallet.sqlite`) holds what `zcash_client_sqlite` stores: viewing keys, notes, transactions. No seed. A test reads every byte of the database and checks.
- Account 0 of the phrase, the same account other wallets derive, so a testnet phrase from another wallet brings its funds.
- Testnet only. `--network main` is refused.

## What `pay` refuses

| Case | Result |
| --- | --- |
| Recipient with no shielded receiver (transparent, TEX) | Refused before anything else runs |
| Memo in the URI | Refused; Fare URIs never carry one |
| Label, message or any other parameter | Refused |
| More than one recipient, no amount, zero amount | Refused |
| Amount above `--max-zec` | Refused |
| Malformed URI, or an address for another network | Refused |
| Seed that does not own the wallet database | Refused |
| Not enough spendable shielded value | `insufficient funds: X ZEC spendable, Y ZEC needed with the fee` |
| Server rejects the transaction | The server's message and error code, exit 1 |

Before sending, `pay` prints the amount, the recipient and the fee.

## How it pays

Library calls only (`zcash_client_backend` 0.25, `zcash_client_sqlite` 0.23, `zcash_proofs` 0.31):

1. `init`: one `GetTreeState` at `birthday - 1`, then `import_account_hd` for account 0.
2. `sync`: `zcash_client_backend::sync::run`. It requests subtree roots, the latest block, block ranges and tree states by height. All wholesale.
3. `propose_standard_transfer_to_address` with the ZIP 317 fee and one confirmation. Transaction version follows the target height, so v6 after NU6.3. Change goes to the wallet's own shielded pool.
4. `create_proposed_transactions` with `LocalTxProver::bundled()`, so no parameter download.
5. The stored transaction is read back from the local database and sent with `SendTransaction`.

The wallet is built without the `transparent-inputs` feature, so it cannot spend transparent funds and makes no address-based UTXO queries. `tests/invariants.rs` fails the build if that feature or a targeted lightwalletd call appears.

`zcash_client_sqlite` 0.23 has no `BlockCache` implementation, which `sync::run` needs. `src/cache.rs` is an in-memory one: blocks live only until they are scanned.

## Notes still in Orchard

After NU6.3, Orchard accepts no new value. A payment funded from Orchard notes crosses the turnstile into Ironwood. `zcash_client_backend` 0.25 plans such payments itself (ZIP 318 canonical crossings), so `pay` has no separate migrate step. `balance` shows where the funds sit. Not yet observed on chain.

## What is real

| Part | State |
| --- | --- |
| URI checks, seed handling, mainnet refusal | Real, tested offline |
| Insufficient funds | Real: tested against a wallet that has scanned empty compact blocks through the same cache sync uses |
| Sync, balance, address, pay on testnet | Real code; runs on a GitHub runner. Not yet run against the chain |

## Tests

```
cargo test
cargo clippy --all-targets -- -D warnings
```

26 tests: every refusal above, seed errors that never quote a word, no seed in the database, the block cache, the CLI refusing before it reads the seed or the network, and four source invariants.
