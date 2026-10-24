import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { test } from 'node:test';

import { publicVerif } from '@cloudflare/privacypass-ts';

import { blindSign, SignError } from '../src/sign.ts';
import { blind, MODE, ORIGIN_NAME, ISSUER_NAME } from './helpers.ts';

const { Issuer, Origin, TokenRequest, TokenResponse, BLIND_RSA, getPublicKeyBytes } = publicVerif;
const RSA = { modulusLength: 2048, publicExponent: Uint8Array.from([1, 0, 1]) };

async function keyPair() {
  const pair = await Issuer.generateKey(MODE, RSA);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return { pair, priv, pub: createPublicKey(priv), tokenKey: await getPublicKeyBytes(pair.publicKey) };
}

test('native signatures are byte-identical to the library and finalize into valid tokens', async () => {
  const k = await keyPair();
  const library = new Issuer(MODE, ISSUER_NAME, k.pair.privateKey, k.pair.publicKey);
  const { clients, requests } = await blind(5, k.tokenKey);
  const origin = new Origin(MODE, [ORIGIN_NAME]);
  for (let i = 0; i < requests.length; i++) {
    const req = TokenRequest.deserialize(BLIND_RSA, new Uint8Array(Buffer.from(requests[i], 'base64url')));
    const native = blindSign(k, req.blindedMsg);
    const lib = (await library.issue(req)).blindSig;
    assert.deepEqual(Buffer.from(native), Buffer.from(lib));
    const token = await clients[i].finalize(new TokenResponse(native));
    assert.equal(await origin.verify(token, k.pair.publicKey), true);
  }
});

test('refuses a blinded message of the wrong length', async () => {
  const k = await keyPair();
  assert.throws(() => blindSign(k, new Uint8Array(255)), SignError);
  assert.throws(() => blindSign(k, new Uint8Array(257)), SignError);
});

test('refuses a message that is not below the modulus', async () => {
  const k = await keyPair();
  assert.throws(() => blindSign(k, new Uint8Array(256).fill(0xff)), SignError);
});

test('withholds a signature that fails verification', async () => {
  const a = await keyPair();
  const b = await keyPair();
  const { requests } = await blind(1, a.tokenKey);
  const req = TokenRequest.deserialize(BLIND_RSA, new Uint8Array(Buffer.from(requests[0], 'base64url')));
  // Private key of one pair, public key of another: the check must catch it.
  assert.throws(() => blindSign({ priv: a.priv, pub: b.pub }, req.blindedMsg), /failed verification/);
});
