# Protocol notes

Facts the code relies on, each checked against crate source, the RFCs or official documentation (sources at the end of [`SPEC.md`](SPEC.md)). Re-check one only when a dependency version changes.

## Zcash and Ironwood

- NU6.3 (Ironwood) activated on mainnet at block 3,428,143 (Jul 28, 2026) and on testnet at 4,134,000. New shielded notes go to Ironwood; Orchard is withdraw-only.
- Ironwood reuses the Orchard key and receiver structure. One Orchard incoming viewing key decrypts both pools.
- Note plaintext lead byte: `0x03` for Ironwood (`NoteVersion::V3`), `0x02` for Orchard (`V2`). `orchard::note_encryption::IronwoodDomain` accepts only `0x03`; `OrchardDomain` only `0x02`.
- Compact blocks: `CompactTx.ironwood_actions` (proto tag 9) holds Ironwood actions; `CompactTx.actions` holds Orchard. Each compact action carries 52 bytes of ciphertext: lead byte, diversifier, value, rseed. No memo.
- `BlockRange.pool_types` empty means shielded pools only. Adding `Transparent` returns `vin`, which is how transparent funding is flagged. Older servers may refuse pool filters; the scanner falls back.
- Crates: `orchard` 0.16.0, `zcash_client_backend` 0.25.0 (features `lightwalletd-tonic`, `lightwalletd-tonic-tls-webpki-roots`, `lightwalletd-tonic-transport`), `zcash_keys` 0.17.0, `zcash_protocol` 0.11.0, `zcash_note_encryption` 0.5.1, `zip32` 0.3.0, `tonic` 0.14. UFVK and UIVK `encode` return `Result`.
- `Rho::from_nf_old` is crate-private. Use `Rho::from_bytes(&nf.to_bytes())`.
- Default lightwalletd: testnet `https://testnet.zec.rocks:443`; mainnet `https://lightwalletd.mainnet.cipherscan.app:443`. CipherScan's testnet server presented a certificate for `api.testnet.cipherscan.app` on Oct 24, 2026, so it fails TLS.

## Payer wallet (`zcash_client_sqlite` 0.23.0, `zcash_proofs` 0.31.0)

- `sync::run(client, params, cache, db, batch)` needs a `BlockCache`. `zcash_client_sqlite` 0.23 implements only `BlockSource` (for `BlockDb` and `FsBlockDb`), so `wallet/src/cache.rs` provides an in-memory one.
- `sync::run` refreshes UTXOs by address only with the `transparent-inputs` feature. The wallet leaves it off.
- `propose_standard_transfer_to_address` returns `Error::InsufficientFunds { available, required }`, and `Error::ScanRequired` before the first scan.
- After NU6.3, `propose_transfer` plans payments funded from Orchard notes as ZIP 318 canonical crossings itself.
- `LocalTxProver::bundled()` (feature `bundled-prover`) needs no parameter download. The release binary is about 73 MB.
- Consumer wallets were not usable as the demo payer: on Oct 24, 2026, Noir Wallet's testnet build signed with the pre-Ironwood consensus branch id, and nodes rejected the transaction. `fare-wallet` pays instead.

## Privacy Pass (`@cloudflare/privacypass-ts` 0.9.0)

- `publicVerif` with `BlindRSAMode.PSS`, RSA 2048, e = 65537. Token type 2.
- One `Client` instance per token: it holds that token's blinding state.
- `header_to_token` parses a `WWW-Authenticate` challenge and runs issuance. It does not parse `Authorization`. Use `AuthorizationHeader.parse(BLIND_RSA, header)` and `new AuthorizationHeader(token).toString()`, and `WWWAuthenticateHeader` for the 402 challenge.
- `Origin.verify` checks the signature only. The origin checks key id, challenge digest (SHA-256 of the serialized challenge) and the spent set itself.
- Sizes: token 354 bytes, `Authorization` header about 491 characters, `WWW-Authenticate` about 538.
- Speed on Node 22: client blind about 31 ms, library sign 300 ms, native sign 0.42 ms, verify about 0.2 ms.
- Native blind signing is one RSA private operation with no padding: `crypto.privateDecrypt({ key, padding: RSA_NO_PADDING }, blindedMsg)`. `publicEncrypt` with no padding must give back the blinded message before the signature is released. See `token-canary/native-sign.mjs`.
