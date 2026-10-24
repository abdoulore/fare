// Locked decisions (owner, Oct 24). Changing any of these needs the owner.

/** Calls per pack. The issuer refuses any other N. */
export const PACK = 100;
/** Price of one pack in zatoshis: 0.001 TAZ. */
export const PRICE_ZAT = 100_000;
/** Issuer keys rotate every 7 days. */
export const EPOCH_SECONDS = 7 * 24 * 60 * 60;
/** The previous key stays valid for 24 h after rotation. */
export const GRACE_SECONDS = 24 * 60 * 60;

/** An unpaid purchase stops waiting after this long. */
export const PURCHASE_TTL_SECONDS = 24 * 60 * 60;

/** Serialized TokenRequest for token type 2: type (2) + truncated key id (1) + blinded message (256). */
export const TOKEN_REQUEST_BYTES = 2 + 1 + 256;
/** Blind RSA 2048: signatures and blinded messages are 256 bytes. */
export const MODULUS_BYTES = 256;
