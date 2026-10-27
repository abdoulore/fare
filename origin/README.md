# fare-origin

Middleware for an API that sells calls for Fare tokens. It wraps a `node:http` handler: the handler runs only for a request carrying a valid, unspent token.

```ts
import { createOrigin } from 'fare-origin';

const origin = createOrigin({
  originName: 'api.example', issuerName: 'issuer.example', issuerUrl: 'http://127.0.0.1:8787',
  pack: 100, priceZec: '0.001', dataDir: 'origin-data',
});
createServer(origin.protect((req, res) => { /* your API */ })).listen(8080);
```

```
npm ci --prefix ../issuer && npm ci --prefix ../sdk && npm ci
npm test            # 11 tests, end to end with the real issuer and SDK
```

## Behavior

- **No token:** `402` with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` (one type 2 challenge, empty redemption context, this origin's name, the newest directory key) and `Fare-Offer: {"pack", "price_zec", "issuer"}`.
- **A token:** checked in the order [invariant 9](../CONTRIBUTING.md#privacy-invariants) sets. The first failure answers `401 {error}`:

| Check | Refusal |
| --- | --- |
| Header parses as one type 2 token | `bad_signature` |
| Key id is a key the directory lists | `expired_epoch` if it was listed before, else `unknown_key` |
| Challenge digest matches this origin's challenge | `wrong_challenge` |
| Signature verifies | `bad_signature` |
| Nonce not spent | `token_reused` |

- The nonce is marked spent only after every other check passes, by creating `spent/<key id>/<nonce>` with O_CREAT | O_EXCL. Creation is atomic, so one token sent twice at once is served once, even to several origin processes sharing the data directory on one host. Several hosts would need a shared database; that is not supported.
- Keys come from the issuer's public directory, refreshed every 5 minutes and when a token names a key the origin has not seen. Unreachable directory: `503`, nothing served.

## Privacy

- The origin shares nothing with the issuer but the public directory ([invariant 7](../CONTRIBUTING.md#privacy-invariants)). It never sees a purchase or a payment.
- `origin-data/spent/<key id>/<nonce>` is one empty file per spent nonce. No time, no client address, no request content ([invariant 8](../CONTRIBUTING.md#privacy-invariants)). Nonces in the older `spent/<key id>.txt` files are copied into this layout at start, and the old files are kept.
- It logs nothing. A test fails the build if the source logs, reads client identity, or mentions purchases.
