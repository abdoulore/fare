// Is the 300 ms per blind signature the library's pure-JS RSA? A blind signature is a
// raw RSA private operation on the blinded message (RFC 9474 BlindSign: s = m^d mod n).
// Node's OpenSSL does that natively via privateDecrypt with no padding. This checks the
// native result is byte-identical to the library's, and times both.

import { constants, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { publicVerif } from '@cloudflare/privacypass-ts';

const { BlindRSAMode, Issuer, Client, Origin, TokenRequest, TokenResponse, BLIND_RSA, getPublicKeyBytes } = publicVerif;
const MODE = BlindRSAMode.PSS;
const N = Number(process.env.N ?? 50);

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const keys = await Issuer.generateKey(MODE, { modulusLength: 2048, publicExponent: Uint8Array.from([1, 0, 1]) });
const issuer = new Issuer(MODE, 'issuer.fare.demo', keys.privateKey, keys.publicKey);
const keyBytes = await getPublicKeyBytes(keys.publicKey);
const origin = new Origin(MODE, ['api.fare.demo']);
const challenge = origin.createTokenChallenge('issuer.fare.demo', new Uint8Array(0));

const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey));
const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
const pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });

// Native BlindSign with the RFC 9474 check that the signature verifies before release.
function nativeBlindSign(blindedMsg) {
  const s = privateDecrypt({ key: priv, padding: constants.RSA_NO_PADDING }, Buffer.from(blindedMsg));
  const m = publicEncrypt({ key: pub, padding: constants.RSA_NO_PADDING }, s);
  if (!m.equals(Buffer.from(blindedMsg))) throw new Error('signing failure');
  return new Uint8Array(s);
}

const clients = [];
const reqs = [];
for (let i = 0; i < N; i++) {
  const c = new Client(MODE);
  reqs.push(await c.createTokenRequest(challenge, keyBytes));
  clients.push(c);
}

let t0 = performance.now();
const libSigs = [];
for (const r of reqs) libSigs.push((await issuer.issue(TokenRequest.deserialize(BLIND_RSA, r.serialize()))).blindSig);
const libMs = (performance.now() - t0) / N;

t0 = performance.now();
const natSigs = reqs.map((r) => nativeBlindSign(r.blindedMsg));
const natMs = (performance.now() - t0) / N;

const identical = natSigs.every((s, i) => Buffer.from(s).equals(Buffer.from(libSigs[i])));

// Native signatures must finalize and verify like the library's.
let verified = 0;
for (let i = 0; i < N; i++) {
  const tok = await clients[i].finalize(new TokenResponse(natSigs[i]));
  if (await origin.verify(tok, keys.publicKey)) verified++;
}

console.log(`library ${libMs.toFixed(1)} ms per signature, native ${natMs.toFixed(2)} ms per signature (${(libMs / natMs).toFixed(0)}x)`);
console.log(`${identical ? 'PASS' : 'FAIL'}  native signatures byte-identical to the library's (${N} of ${N})`);
console.log(`${verified === N ? 'PASS' : 'FAIL'}  native signatures finalize into valid tokens (${verified} of ${N})`);
console.log(`a 100-token pack: ${(libMs * 100 / 1000).toFixed(1)} s with the library, ${(natMs * 100).toFixed(0)} ms native`);
process.exit(identical && verified === N ? 0 : 1);
