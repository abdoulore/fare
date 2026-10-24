// Native blind RSA signing (RFC 9474 BlindSign) with the check that the signature
// verifies before it is released. Byte-identical to privacypass-ts's Issuer, measured
// in token-canary/native-sign.mjs, and about 700 times faster.

import { constants, privateDecrypt, publicEncrypt, type KeyObject } from 'node:crypto';

import { MODULUS_BYTES } from './config.ts';

export class SignError extends Error {}

export interface SigningKey {
  readonly priv: KeyObject;
  readonly pub: KeyObject;
}

/** s = m^d mod n, released only if s^e mod n gives back m. */
export function blindSign(key: SigningKey, blindedMsg: Uint8Array): Uint8Array {
  if (blindedMsg.length !== MODULUS_BYTES) {
    throw new SignError(`blinded message must be ${MODULUS_BYTES} bytes`);
  }
  let s: Buffer;
  try {
    s = privateDecrypt({ key: key.priv, padding: constants.RSA_NO_PADDING }, blindedMsg);
  } catch {
    // OpenSSL refuses a message that is not below the modulus.
    throw new SignError('blinded message is not a valid input for this key');
  }
  let m: Buffer;
  try {
    m = publicEncrypt({ key: key.pub, padding: constants.RSA_NO_PADDING }, s);
  } catch {
    // A signature not below the verifying key's modulus is as wrong as a mismatch.
    throw new SignError('signature failed verification, not released');
  }
  if (!m.equals(blindedMsg)) {
    throw new SignError('signature failed verification, not released');
  }
  return new Uint8Array(s);
}
