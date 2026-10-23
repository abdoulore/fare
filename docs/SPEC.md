# Fare: Build Spec

Oct 23, 2026 · Ore

Live version: https://claude.ai/artifact/BU5JV4NPxikhGXofRmdHxF

## Summary and locked decisions

Fare sells API access for shielded ZEC and redeems it with unlinkable tokens: the provider verifies every call but cannot tie a call to the purchase, the payer, or the caller's other calls. Submissions close Oct 28, 2026 at 23:59 UTC (00:59 Lagos the next day).

| Decision | Locked choice |
| --- | --- |
| Track | Shielded Payments |
| Tokens | Privacy Pass publicly verifiable tokens, Blind RSA 2048 (RFC 9578 type 2) |
| Issue tokens at | 1 confirmation (about 75 s) |
| Payment matching | Fresh shielded address per purchase, matched by diversifier index. No memo, no txid lookups |
| Demo payer | Ore paying from Zodl. Headless agent wallet is a stretch goal |
| Demo API | An LLM or search proxy an agent calls in a loop |
| Proof for judges | Demo merchant viewing key published, so anyone can verify every purchase |
| Networks | Offline fixtures and testnet for development and the canary (owner, Oct 23). Final run on mainnet unless the owner changes it |

## Architecture

Four parts, two languages: a Rust scanner that only ever holds a viewing key, and TypeScript for everything token-shaped.

![Fare architecture: buyer side, provider side, chain](architecture.png)

| Component | Language | Built on | Holds |
| --- | --- | --- | --- |
| Scanner | Rust | `orchard` 0.16, `zcash_client_backend` 0.25, `zcash_keys` 0.17 | Unified viewing key only |
| Issuer | TypeScript | `@cloudflare/privacypass-ts` for the protocol, native OpenSSL for the RSA signature | RSA signing key per epoch, purchase records |
| Origin middleware | TypeScript | `privacypass-ts` verify | Issuer public key, spent-nonce set |
| Client SDK | TypeScript | `privacypass-ts` client | Pinned issuer key, unspent tokens |

The merchant's seed never touches the server. `fare-scanner init` writes it to a local file you move offline; the running scanner reads only the viewing key.

## Flow

One shielded payment buys a pack; every call afterwards spends one token. Tokens use an empty redemption context, so a whole pack can be minted in advance and spent later.

1. **Challenge.** Client calls the API with no token. Origin answers `402` with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` and a `Fare-Offer` header: pack size, price, issuer URL.
2. **Key check.** Client compares `token-key` with the key it pinned from `/.well-known/private-token-issuer-directory`. Mismatch: abort. This blocks a per-user key.
3. **Order.** Client generates N nonces, blinds them, and sends `POST /fare/purchases {pack, blinded[N]}`. Issuer stores the blinded messages, has the scanner mint the next diversified address, and returns `{purchase_id, pay_uri, expires_at}`. `pay_uri` is `zcash:<shielded-only UA>?amount=<price>` with no memo.
4. **Pay.** Payer pays `pay_uri` from Zodl, from shielded balance.
5. **Detect.** Scanner trial-decrypts each block's `ironwood_actions` with the viewing key. A hit at diversifier index j marks purchase j paid once it has 1 confirmation and value at or above the price.
6. **Issue.** Client polls `GET /fare/purchases/{id}`. When paid, the issuer blind-signs the stored messages and returns `{status: "paid", signatures[N]}`. The purchase id is a random 128-bit capability; the signatures are useless without the client's blinding factors.
7. **Finalize.** Client unblinds N signatures into N RFC 9578 type 2 tokens and stores them.
8. **Redeem.** Each call carries `Authorization: PrivateToken token=...`. Origin verifies the signature against the epoch key, rejects a nonce it has seen, records the nonce, serves `200`.

## Privacy model

No party holds both ends: the issuer sees purchases and blinded messages, the origin sees tokens, and nothing joins the two.

| Who | Sees | Cannot see |
| --- | --- | --- |
| Chain observer | A fully shielded v6 transaction and its fee | Payer, amount, purchase address, which service |
| lightwalletd operator | Scanner IP, block range requested, mempool snapshots | Which transactions are the merchant's |
| Issuer | Purchase id, price, amount and height paid, N blinded messages, client IP at order | The tokens those messages become |
| Origin | Each token, its arrival time, request content, client IP | The purchase behind a token; whether two calls share a buyer |
| Judges, with the demo viewing key | Every purchase: amount, index, height | Tokens, calls, payers |

**Leak checklist (each one demoed or tested):**

- [ ] Shielded-only address: Orchard-type receiver only, no transparent or Sapling receiver.
- [ ] Fresh diversifier index per purchase, counted up from 2^40 and never reused.
- [ ] No memo in `pay_uri`; the scanner never calls `GetTransaction`. A test fails the build if that call appears.
- [ ] Fixed pack sizes; the issuer rejects any other N.
- [ ] One issuer key per epoch at the well-known URL; the client pins it and refuses any other.
- [ ] Payments funded from transparent inputs are flagged in the panel.
- [ ] Server-view panel: purchases and redemptions side by side, no join key, live anonymity-set size.

**Residuals, stated in the README:**

- **IP and timing.** An order and a redemption from one IP seconds apart can be correlated. The SDK waits a random delay before first use and can redeem through a separate proxy or Tor; Fare does not solve network privacy.
- **Small anonymity set.** A token hides only among tokens from the same epoch key. Early on that set is small; the panel shows its size.
- **Request content.** The origin still reads what you ask. Fare unlinks identity, not content.
- **Transparent funding.** A payer who funds from transparent balance exposes their own address. Fare flags it but cannot prevent it.

## Failure paths

Every row below is either a test that runs in CI or a step in the demo video, so judges see the system refuse things, not just accept them.

| Case | Expected behavior | Proven by |
| --- | --- | --- |
| Underpayment | Purchase stays `underpaid`, shortfall shown, no tokens | Scanner test; mainnet pay of half the price |
| Overpayment or a second payment | `paid`, extra recorded, still exactly N tokens | Scanner test |
| Payment seen only in mempool | `in mempool`, no tokens until 1 confirmation | Live demo with `--mempool` |
| Payment to a non-purchase address of the same key | Counted as unattributed, never issues tokens | Scanner test |
| Payment to a different key | Not detected at all | Scanner test |
| Old-format note inside the Ironwood list | Rejected by the Ironwood domain | Scanner test |
| Payment funded from transparent inputs | `paid`, flagged as leaky funding in the panel | Scanner test |
| Token reused | `401 token_reused` | Origin test; replay live in the video |
| Token signed by another key | `401 bad_signature` | Origin test |
| Token from a retired epoch | Rejected after the grace window | Origin test |
| Origin presents an unpinned key | Client aborts before ordering | SDK test |
| Reorg drops a paid block | Tokens already issued stand; rescan marks the payment missing in the panel | Accepted risk at 1 confirmation, stated in README |

## Canary

The canary passes when a real shielded payment on testnet is matched to the right purchase from compact blocks alone. Until it passes, nothing token-shaped gets built.

The scanner is built and passes 11 tests offline, including real Ironwood note encryption, wrong-pool rejection and two deliberate code breaks the tests caught. The sandbox cannot reach lightwalletd, so the testnet run is yours. Cost: testnet coins only. Zodl's testnet support is unverified; if it has none, pay from another Ironwood-ready testnet wallet.

```
cd fare/scanner && cargo build --release
alias fare=./target/release/fare-scanner
fare init --network test            # writes SEED-MOVE-OFFLINE.txt; move it offline
fare mint --zec 0.001 --label canary
# Wallet: pay the printed address or URI from shielded balance, wait about 3 minutes
fare scan --mempool --check-transparent
fare mint --zec 0.001 --label underpay
# Wallet: pay 0.0005 to the new address
fare scan
```

**Pass:**

- [ ] `CANARY PASS` names the same txid the wallet shows, at diversifier index base+0.
- [ ] The second purchase shows `underpaid (short 0.0005 ZEC)` and never `paid`.
- [ ] The scan summary says `No transaction lookups` and the pay URI has no memo.
- [ ] CipherScan shows the transaction with no visible amount or address; screenshot it for the README.

**Fail, and what it means:**

- Zero Ironwood actions over hundreds of blocks: the server is not serving Ironwood data. Retry with `--server` pointed at another Ironwood-ready lightwalletd.
- The payment shows as unattributed: the index mapping is wrong. Stop and debug before Oct 24 work.
- Nothing after 3 blocks with Ironwood actions present: check that the wallet paid the exact address minted, then rerun with `--from` set a few blocks lower.

The seed uses the standard ZIP 32 account 0 path, so restoring it in Zodl with the birthday `init` printed should make the canary funds spendable. Not yet tried on a device; check it once before the mainnet demo.

## Day plan

One gate, five build days, submission with a buffer: nothing after the canary starts until the canary passes.

**Oct 23 (gate)**

- [x] Scanner: mint, scan, status, viewing key; 11 tests green. Token canary: 100 tokens issued, verified, 11 of 11 refusal and unlinkability checks
- [ ] Testnet canary passes (see Canary)

**Oct 24: issuance**

- [ ] `fare-scanner serve`: mint and status over localhost HTTP for the issuer
- [ ] Issuer: `POST /fare/purchases`, `GET /fare/purchases/{id}`, epoch RSA key, issuer directory at the well-known URL
- [ ] Client SDK: blind, order, poll, finalize, pin key

**Oct 25: redemption**

- [ ] Origin middleware: 402 challenge, verify, spent-nonce store
- [ ] Demo API (LLM or search proxy) and an agent that calls it in a loop
- [ ] Server-view panel: purchases, redemptions, anonymity-set size

**Oct 26: failure paths and mainnet run**

- [ ] Origin and SDK tests: reuse, forged, retired epoch, unpinned key
- [ ] Scanner follow mode with a cursor and a reorg rescan window
- [ ] Mainnet run: paid, underpaid and second-payment purchases with real txids; publish the demo viewing key

**Oct 27: proof and polish**

- [ ] Threat model and README: what is real, what is mocked, residuals
- [ ] CI runs every test
- [ ] Stretch: headless agent wallet

**Oct 28: ship**

- [ ] Demo video, about 3 minutes
- [ ] Repo public, submission text, submitted by 20:00 Lagos time

## Submission checklist and open risks

The rules that can disqualify us are mechanical, so they are tracked as tasks.

- [ ] One account registers and submits: Ore's (rule 1)
- [ ] Every commit dated after Sep 28; the first one is Oct 23 (rule 2)
- [ ] Repo public by the deadline (rule 3)
- [ ] Entered in Shielded Payments only (rule 4)
- [ ] README states what is real and what is mocked, how to run it, and the residuals
- [ ] On-chain proof: mainnet txids, CipherScan screenshots, published demo viewing key
- [ ] Video shows the refusals too: underpayment, token reuse, unpinned key

| Risk | Fallback |
| --- | --- |
| `privacypass-ts` issuer too slow in Node (resolved Oct 23) | Measured: 300 ms per signature in the library, 0.42 ms with native OpenSSL, byte-identical output. The issuer signs natively and checks each signature before release |
| Default lightwalletd lacks Ironwood actions | `--server` to another Ironwood-ready server, or self-host Zaino |
| Zodl does not pay a shielded-only address into Ironwood | Test once with a second Ironwood wallet (Zingo, YWallet or Cake) before the mainnet run |
| Tiny anonymity set in the demo | Show the set size honestly; run several clearly labeled test buyers to show it grow |
| Judges read tokens as off-chain | Frame it: payment settles on Zcash, tokens are an IETF standard, the privacy claim covers both and is tested |

## Sources

- [RFC 9578: Privacy Pass issuance](https://www.rfc-editor.org/rfc/rfc9578.html)
- [Cloudflare Privacy Pass getting started (privacypass-ts)](https://developers.cloudflare.com/privacy-pass/getting-started/index.md)
- [nerdcash zcash-payment-service, Ironwood scanning PR](https://github.com/nerdcash/zcash-payment-service/pull/17)
- [CipherScan public lightwalletd](https://github.com/Kenbak/cipherscan)
- [Ironwood is live on Zcash (ZODL)](https://zodl.com/ironwood-is-live-on-zcash/)
- `orchard` 0.16.0 and `zcash_client_backend` 0.25.0 source, read directly from crates.io for the Ironwood domain and compact block fields
