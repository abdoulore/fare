# Fare API contract

The shapes every Fare component agrees on. Tests in each package hold them; change one only together with its tests and this page.

## Origin (your API, behind `fare-origin`)

- **No token:** `402` with `WWW-Authenticate: PrivateToken challenge=..., token-key=...` and `Fare-Offer: {"pack": N, "price_zec": "...", "issuer": "<url>"}`.
- **Redemption:** `Authorization: PrivateToken token="<base64url>"`. Checked in this order: key id, challenge digest, signature, spent set (privacy invariant 9). The first failure answers `401 {error}` with one of `token_reused`, `bad_signature`, `unknown_key`, `wrong_challenge`, `expired_epoch`.

## Issuer

- `GET /.well-known/private-token-issuer-directory` in RFC 9578 format: `issuer-request-uri` plus `token-keys` entries of `{token-type: 2, token-key: <base64url SPKI>, not-before}`.
- `POST /fare/purchases` with `{pack, blinded: [base64url, ...N]}` returns `201 {purchase_id, pay_uri, expires_at}`.
  - Each `blinded` entry is a whole serialized `TokenRequest` (259 bytes), so the issuer knows which key it is for.
  - `purchase_id` is 128 random bits, hex (the scanner's id). `expires_at` is ISO 8601, 24 h out.
  - Refusals: `400 {error}` with `wrong_pack`, `wrong_count`, `malformed_request`, `duplicate_request`, `unknown_key`, `unknown_field` or `body_not_json`; `413 body_too_large`; `503 scanner_unavailable`.
- `GET /fare/purchases/{id}` returns `{status}`: `pending`, `in_mempool`, `confirming`, `underpaid` or `expired`.
  - Once paid: `{status: "paid", signatures: [base64url, ...N]}` in request order, plus `warning: "funded_from_transparent_inputs"` when the payment was flagged.
  - A paid purchase whose key retired: `410 {status: "key_retired"}`.

## Scanner sidecar (`fare-scanner serve`)

Loopback only; the issuer is its only client.

- `POST /mint {price_zat}` returns `201 {purchase_id, index, address, pay_uri}`.
- `GET /purchases/{id}` returns `{status, received_zat, payments, price_zat, leaky_funding, scanned_to, required_confirmations}`. `status` is one of `pending`, `in_mempool`, `confirming`, `paid`, `underpaid`.
- Ids are 128 bits, hex. Errors are `{error}` with 400 or 404.

## Public views

The public ledger and counts never carry a purchase id (an id fetches signatures). They show purchase index, amount, height and status on the issuer side, and redemption counts per key on the origin side, with no field that joins the two.
