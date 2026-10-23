# Fare

Pay once in shielded ZEC. Then every API call carries a token nobody can link back to you, including the API.

Built for ZECATHON 2026, Shielded Payments track.

![Fare architecture](docs/architecture.png)

## Start here

| File | For |
| --- | --- |
| `docs/SPEC.md` | The full build spec: decisions, flow, privacy model, failure paths, plan |
| `AGENTS.md` | Instructions for coding agents: rules, invariants, verified facts, API contract, next tasks |
| `scanner/README.md` | Running the scanner and the mainnet canary |
| `token-canary/README.md` | The Privacy Pass proof and signing benchmark |

## Status

| Part | State |
| --- | --- |
| `scanner/` (Rust) | Built, 11 tests green, mainnet canary pending |
| `token-canary/` (Node) | Passed: 100 tokens, 11 of 11 checks |
| Issuer (TypeScript) | Oct 24, after the canary |
| Origin middleware and client SDK (TypeScript) | Oct 24 to 25 |
| Demo API, agent, server-view panel | Oct 25 |

## How it works

1. The API answers `402` with a Privacy Pass challenge and a price for a fixed pack of calls.
2. The client blinds N tokens and orders a pack. Fare mints a fresh shielded-only address for that purchase.
3. The payer pays from Zodl. The scanner matches the payment to the purchase by diversifier index, from compact blocks alone.
4. The issuer blind-signs. The client unblinds N tokens (RFC 9578, type 2).
5. Each call spends one token. The API can verify it but cannot tie it to the purchase or to the caller's other calls.

## Never commit

`fare-data/` holds `SEED-MOVE-OFFLINE.txt`. It is git-ignored. Move the seed offline after `init`.
