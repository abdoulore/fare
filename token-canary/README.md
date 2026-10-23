# token-canary

Proves the Privacy Pass half of Fare in plain Node before any product is built on it.

```
npm install
node canary.mjs          # N=100 by default
node native-sign.mjs     # native vs library signing
```

## Result, Oct 23

`TOKEN CANARY PASS: 11/11 checks` with N=100:

- 100 tokens blinded up front, signed in one batch, unblinded, each accepted once
- Refused: reused token, unpinned key, forged signature, tampered nonce, token minted for another origin
- 402 challenge header and Authorization header round-trip
- Issuer log (blinded messages, blind signatures) and origin log (nonces, authenticators) share no value: nothing to join purchases and calls on

Token: 354 bytes, about 490 characters as an `Authorization` header. Verify: about 0.2 ms.

## Signing speed

The library signs in pure JavaScript: 300 ms per token, 30 s for a 100-token pack. A blind signature is one raw RSA private operation, which Node's OpenSSL does natively. `native-sign.mjs` shows the native result is byte-identical to the library's, 712x faster (0.42 ms), and finalizes into valid tokens. The issuer will sign natively and verify each signature before releasing it, as RFC 9474 requires.
