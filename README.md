# Fare

Pay once in shielded ZEC. Then every API call carries a token nobody can link back to you, including the API.

Built for ZECATHON 2026, Shielded Payments track. Runs on Zcash testnet.

![Fare architecture](docs/architecture.png)

## How it works

1. The API answers `402` with a Privacy Pass challenge and a price for a fixed pack: 100 calls for 0.001 TAZ.
2. The client checks the challenge's key against the issuer key it pinned, blinds 100 nonces and orders a pack. Fare mints a fresh shielded-only address for that purchase.
3. The payer pays it from shielded notes (in the demo, `fare-wallet`). The scanner matches the payment to the purchase by diversifier index, from compact blocks alone: no memo, no transaction lookup.
4. After one confirmation the issuer blind-signs. The client unblinds 100 tokens (RFC 9578, type 2).
5. Each call spends one token. The API verifies it but cannot tie it to the purchase, the payer, or the caller's other calls.

## Testnet proof

Every payment below is a real testnet transaction, paid by `fare-wallet` and detected by `fare-scanner` from compact blocks. All went to purchase addresses of one demo merchant, whose **incoming viewing key is published here** so anyone can check them:

```
uivktest160nugcs8fnvmx98nuqy982yadezp0uk8h8chq47uq74q3rqgynurv0tfc77vvsmn38f6nn25mtnyq0rkvjamsujht3yacjp8uvtacatxwgatjy54f3g4el376ur2t7f55d4f5dhjxmalvay2xvh4ycfgz032z692hgcenqa9wn5ua5van6n9xqguutnsurjccpsmstrnd3xcjvwxtnnqv7wa5y060rcg7e3h2wt7ycrskv4nt2a
```

It reveals incoming payments to this demo account only: amount, height, address index. It cannot spend, and it reveals nothing about tokens or API calls.

| Index | Amount (TAZ) | Height | Txid | What it shows | Run |
| --- | --- | --- | --- | --- | --- |
| +0 | 0.001 | 4,535,557 | `fd1e9ee3f90c0e3bd8bf874e86352ab8fb085158190c5242a27e0afa623af9d9` | Canary: paid, matched by index | [canary](https://github.com/abdoulore/fare/actions/runs/40084407257) |
| +1 | 0.0005 | 4,535,562 | `0346de58cdaa73d7285e7e91448effa2c437978b44cfdf1bc72a4cf9b866652b` | Canary: underpaid, stays underpaid | [canary](https://github.com/abdoulore/fare/actions/runs/40084407257) |
| +2 | 0.001 | 4,535,836 | `9a6e1bf355929f15ccf13035d00c8e6dea01e56145d6ea4dbb068d71bdb24740` | Minted over HTTP by `serve`: pending, in mempool, paid | [serve](https://github.com/abdoulore/fare/actions/runs/40091932215) |
| +3 | 0.001 | (in the verifier's listing) | `2e97c74b44bce98c4b6707928c78df62e6b630b042146b824dea833b964ae5b8` | Whole stack: 402, pay, 100 tokens, 5 calls, replay refused | [demo](https://github.com/abdoulore/fare/actions/runs/40096150452) |
| +4 | 0.001 | 4,536,048 | `b01a1fc002e2ff71a6b8438b5f403eda48bdd948a9936b0f01d6e819dc7fa4df` | Paid: 100 tokens, a call succeeds | [failure paths](https://github.com/abdoulore/fare/actions/runs/40098320054) |
| +5 | 0.0005 | 4,536,052 | `0c3e538be90d9a5bfa60463314a6cd2dd06a092a62486c8dd0f9f39a7a26058d` | Underpaid: no signatures issued | [failure paths](https://github.com/abdoulore/fare/actions/runs/40098320054) |
| +6 | 0.001 | 4,536,054 | `60d3f691c7b71deb4f7eb890f3e2967971c78ced8cf287d62b1d271c7b30ebf3` | Second payment, first of two | [failure paths](https://github.com/abdoulore/fare/actions/runs/40098320054) |
| +6 | 0.001 | 4,536,061 | `d3529ffb9e1cedcc2cdc0bdb3216de385a0e255db60912ef31d6b700532ba652` | Second payment: still exactly 100 tokens | [failure paths](https://github.com/abdoulore/fare/actions/runs/40098320054) |

### Check it yourself

With the published key only, no seed and nothing from us:

```
cd scanner && cargo build --release
./target/release/fare-scanner --dir verify init --network test --uivk <key above> --birthday 4535550
./target/release/fare-scanner --dir verify scan --from 4535550 --check-transparent
./target/release/fare-scanner --dir verify status
```

`init --uivk` makes a watch-only verifier: it holds no seed and refuses to mint. `status` lists every payment to the key by purchase index, with amount, height and txid. The [failure-paths run](https://github.com/abdoulore/fare/actions/runs/40098320054) does exactly this on a fresh runner and lists +4, +5 and +6 as above.

The scan needs a machine that can reach `testnet.zec.rocks`. Block explorer screenshots of these transactions are still to be added.

## Status (Oct 26)

| Part | State |
| --- | --- |
| `scanner/` (Rust) | Payment detection, `serve` sidecar, watch-only verifier. 33 tests, clippy clean |
| `wallet/` (Rust) | `fare-wallet`, headless testnet payer. 26 tests, clippy clean |
| `issuer/` (TypeScript) | Purchases API, 7-day epoch keys, native blind signing. 19 tests |
| `sdk/` (TypeScript) | Pin, 402 handling, order, collect, spend, follows key rotation. 12 tests |
| `origin/` (TypeScript) | 402 challenge, invariant 9 redemption checks, spent-nonce store. 11 tests |
| `demo/` (TypeScript) | LLM proxy behind the origin, paying agent, loopback panel. 9 tests |
| `token-canary/` (Node) | Privacy Pass proof: 100 tokens, 11 of 11 checks |

CI runs every test on every push. The testnet workflows (`.github/workflows/testnet-*.yml`) run the chain-facing parts on GitHub runners.

Demo answers are **simulated** unless the demo host has a model API key: the API, the agent output and the panel all say so.

## Start here

| File | For |
| --- | --- |
| `docs/SPEC.md` | The build spec: decisions, flow, privacy model, failure paths and the test that proves each |
| `AGENTS.md` | Rules, invariants, verified facts, API contract |
| `scanner/README.md` | The scanner, `serve`, and the canary |
| `wallet/README.md` | The headless payer: commands, seed rules, refusals |
| `issuer/README.md`, `sdk/README.md`, `origin/README.md` | The token side |
| `demo/README.md` | Running the whole thing |

## Never commit

`fare-data/` holds `SEED-MOVE-OFFLINE.txt`. It is git-ignored. Move the seed offline after `init`. The payer seed lives only in the `FARE_PAYER_SEED` environment variable.
