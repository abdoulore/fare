# fare-sdk

Client for Fare: pins the issuer key, buys a pack of Privacy Pass tokens with one shielded payment, spends one token per API call.

```ts
import { FareClient } from 'fare-sdk';

const fare = new FareClient({ issuerUrl: 'http://127.0.0.1:8787', stateFile: 'fare-sdk.json' });
await fare.pin();                                   // once: pins the directory key
const res = await fare.fetch('https://api.example/ask', { method: 'POST', body }, async (payUri) => {
  // pay payUri from shielded notes, e.g. with fare-wallet
});
```

```
npm ci --prefix ../issuer && npm ci
npm test            # 12 tests, against the real issuer with a stub scanner
npm run typecheck
```

## What it does on a 402

1. Parses `WWW-Authenticate: PrivateToken ...`. It needs exactly one type 2 challenge with an empty redemption context ([invariant 9](../CONTRIBUTING.md#privacy-invariants)).
2. Compares the challenge's `token-key` with the pinned key. On a mismatch it re-reads the issuer directory: a key listed there is a rotation, so it becomes the pin and tokens under keys the directory dropped are discarded. Any other key aborts with `UnpinnedKeyError` before anything is ordered ([invariant 6](../CONTRIBUTING.md#privacy-invariants)): a per-user key would link calls.
3. Spends a stored token for that challenge, if there is one.
4. Otherwise, with a payer callback: blinds `pack` nonces, orders them (`POST /fare/purchases`), hands `pay_uri` to the payer, polls until paid, unblinds every signature (each is checked against the pinned key), stores the tokens and spends one. Without a payer: `PaymentRequired` with the origin's `Fare-Offer`.

## Rules

- `pin()` pins the directory's first type 2 key when nothing is pinned, or when the directory no longer lists the pinned one.
- Tokens live in `stateFile` (mode 0600) with the challenge they redeem against. A token is removed from the file before the request carrying it is sent: a crash can lose a token, never reuse one.
- `order()` saves the order and each token's blinding state (token input and blinding inverse) in the state before it returns, so before anyone pays. After a crash, a new client lists it with `pendingPurchases()` and finishes it with `collect()`. The blinding state never leaves the client.
- Every change is one atomic read-modify-write on a `StateStore` (a JSON file here, an IndexedDB transaction in a browser). Two clients on one store never take the same token or collect one order twice. Two Node processes sharing one state file are not supported.
- `collect()` stops on `expired`, `key_retired` or a timeout, stores nothing, and drops the saved order when it can never complete. `forget()` keeps saved orders: one may be paid already.
