# fare-issuer

Sells one fixed pack of Privacy Pass tokens (RFC 9578 type 2, Blind RSA 2048 PSS) for one shielded payment. It sees purchases and blinded messages, never tokens.

```
npm ci
npm test                 # 19 tests
npm run typecheck
npm start                # ISSUER_LISTEN=127.0.0.1:8787 ISSUER_DATA=issuer-data SCANNER_URL=http://127.0.0.1:7077
```

Node 22.18 or later runs the TypeScript directly; there is no build step. It needs `fare-scanner serve` running on loopback.

## API

| Route | Result |
| --- | --- |
| `GET /.well-known/private-token-issuer-directory` | `{"issuer-request-uri": "/fare/purchases", "token-keys": [{"token-type": 2, "token-key": <base64url SPKI>, "not-before": <unix>}]}` |
| `POST /fare/purchases` `{pack: 100, blinded: [100 serialized TokenRequests, base64url]}` | `201 {purchase_id, pay_uri, expires_at}` |
| `GET /fare/purchases/{id}` | `{status}` (`pending`, `in_mempool`, `confirming`, `underpaid`, `expired`); once paid `{status: "paid", signatures: [100]}` in request order |

`blinded` carries whole serialized `TokenRequest`s (259 bytes: type, truncated key id, blinded message), so the issuer knows which key each was blinded under.

## Rules (locked Oct 24)

- One pack: 100 calls for 0.001 TAZ. Any other `pack` or count is refused (`wrong_pack`, `wrong_count`), before anything is minted.
- Signing is native OpenSSL (`privateDecrypt` with no padding). Every signature is checked with the public key before release; one that fails is withheld.
- One key per 7-day epoch, created on first use and kept in `issuer-data/keys/` (mode 0600). After rotation the previous key stays in the directory and keeps signing for 24 h, then retires.
- New purchases must be blinded under the current key (`unknown_key` otherwise). Requests repeated within a pack are refused (`duplicate_request`).
- Signatures are only returned when the scanner says `paid`, which needs one confirmation. A payment funded from transparent inputs is signed with `warning: "funded_from_transparent_inputs"`.
- An unpaid purchase expires after 24 h. A paid one is signed until its key retires; after that `410 {status: "key_retired"}`.
- An unreachable scanner is `503 scanner_unavailable`, never a guess.

## Privacy

- `issuer-data/purchases.json` holds id, key epoch, blinded requests, pay URI and expiry. No client address, user agent or request time. Signatures are not stored; blind RSA is deterministic, so they are recomputed per poll.
- The issuer logs nothing about requests. A test fails the build if its source logs, reads client identity, or handles tokens.
