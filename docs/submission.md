# Fare: submission text

Track: Shielded Payments. Draft for Ore to paste into the ZECATHON form.

---

**Fare: pay once in shielded ZEC, then call an API with tokens that cannot be matched to your payment.**

Paying for an API usually means an account, a card or a wallet address, and every call is tied to it. Fare sells API access in packs of 100 calls for shielded ZEC and redeems each call with a Privacy Pass token (RFC 9578, blind RSA).

How it works: the API answers 402 with a price. Your browser blinds 100 tokens and orders a pack; Fare mints a fresh shielded-only address for that purchase. You pay it. A scanner holding only a viewing key matches the payment by address index from compact blocks: no memo, no transaction lookup. After one confirmation the issuer signs the blinded tokens without seeing them. Each call spends one token; a replayed token is refused.

The issuer sees purchases, the API sees tokens, and they share no identifier. Blind signatures stop anyone, the operator included, from matching a token to the purchase that paid for it. The README lists what Fare does not hide: IP and timing correlation, a small anonymity set, request content.

Try it on testnet: https://fare.moonrider.online/app (Fare's demo wallet can pay for you; the page says so). Add it to your own API: https://fare.moonrider.online/developers

Proof: real testnet transactions for a paid purchase, an underpaid one (no tokens issued) and a second payment (still exactly 100 tokens), each on a public explorer showing only a fee: https://github.com/abdoulore/fare#testnet-proof

Check it yourself with the published incoming viewing key: https://fare.moonrider.online/proof

Built during ZECATHON: Rust scanner and headless testnet wallet, TypeScript issuer, origin middleware, SDK and React frontend, with a test for every refusal.

Code: https://github.com/abdoulore/fare
