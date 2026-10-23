// Token canary: proves the Privacy Pass half of Fare runs in plain Node, before any
// product is built on it. Pass criteria are printed at the end; any failure exits 1.
//
// What it proves:
//   1. A pack of N tokens can be blinded up front, signed later in one batch, and
//      unblinded into valid RFC 9578 type 2 tokens (Blind RSA 2048, PSS).
//   2. The origin accepts each token once and refuses reuse, forgery, tampering,
//      the wrong challenge, and an unpinned key.
//   3. Nothing the issuer stored equals anything the origin sees: the two logs
//      share no field to join on.

import { createHash, webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { publicVerif, AuthorizationHeader, WWWAuthenticateHeader } from '@cloudflare/privacypass-ts';

const { BlindRSAMode, Issuer, Client, Origin, TokenRequest, TokenResponse, BLIND_RSA, getPublicKeyBytes } = publicVerif;

const N = Number(process.env.N ?? 100);
const MODE = BlindRSAMode.PSS;
const ISSUER_NAME = 'issuer.fare.demo';
const ORIGIN_NAME = 'api.fare.demo';
const RSA = { modulusLength: 2048, publicExponent: Uint8Array.from([1, 0, 1]) };

const hex = (b) => Buffer.from(b).toString('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => createHash('sha256').update(b).digest();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const ms = (t0) => `${(performance.now() - t0).toFixed(0)} ms`;

// Origin-side redemption: signature, challenge binding, pinned key, single use.
function makeOrigin(origin, issuerPublicKey, expectedChallenge, pinnedKeyId) {
  const spent = new Set();
  const expectedDigest = hex(sha256(expectedChallenge.serialize()));
  return async function redeem(token) {
    if (hex(token.authInput.tokenKeyId) !== pinnedKeyId) return 'unknown_key';
    if (hex(token.authInput.challengeDigest) !== expectedDigest) return 'wrong_challenge';
    if (!(await origin.verify(token, issuerPublicKey))) return 'bad_signature';
    const nonce = hex(token.authInput.nonce);
    if (spent.has(nonce)) return 'token_reused';
    spent.add(nonce);
    return 'ok';
  };
}

async function main() {
  if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

  // Issuer key for this epoch, and the key id clients pin (SHA-256 of the SPKI bytes).
  let t0 = performance.now();
  const keys = await Issuer.generateKey(MODE, RSA);
  const issuer = new Issuer(MODE, ISSUER_NAME, keys.privateKey, keys.publicKey);
  const issuerKeyBytes = await getPublicKeyBytes(keys.publicKey);
  const pinnedKeyId = hex(sha256(issuerKeyBytes));
  console.log(`issuer key generated in ${ms(t0)}, key id ${pinnedKeyId.slice(0, 16)}...`);

  // Empty redemption context: tokens are not bound to one session, so a pack can be
  // minted before it is spent.
  const origin = new Origin(MODE, [ORIGIN_NAME]);
  const challenge = origin.createTokenChallenge(ISSUER_NAME, new Uint8Array(0));
  check('challenge uses an empty redemption context', challenge.redemptionContext.length === 0);

  // Client: blind N nonces up front. This is what `POST /fare/purchases` carries.
  t0 = performance.now();
  const clients = [];
  const requestBytes = [];
  for (let i = 0; i < N; i++) {
    const c = new Client(MODE);
    const req = await c.createTokenRequest(challenge, issuerKeyBytes);
    clients.push(c);
    requestBytes.push(req.serialize());
  }
  console.log(`client blinded ${N} requests in ${ms(t0)}`);

  // Issuer: after the scanner marks the purchase paid, sign the stored blinded messages.
  t0 = performance.now();
  const issuerLog = { blinded: [], signatures: [] };
  const responseBytes = [];
  for (const bytes of requestBytes) {
    const req = TokenRequest.deserialize(BLIND_RSA, bytes);
    const res = await issuer.issue(req);
    issuerLog.blinded.push(hex(req.blindedMsg));
    issuerLog.signatures.push(hex(res.blindSig));
    responseBytes.push(res.serialize());
  }
  const issueTime = performance.now() - t0;
  console.log(`issuer signed ${N} in ${issueTime.toFixed(0)} ms (${(issueTime / N).toFixed(1)} ms each)`);

  // Client: unblind into tokens.
  t0 = performance.now();
  const tokens = [];
  for (let i = 0; i < N; i++) {
    tokens.push(await clients[i].finalize(TokenResponse.deserialize(responseBytes[i])));
  }
  console.log(`client finalized ${N} tokens in ${ms(t0)}`);
  const tokenSize = tokens[0].serialize().length;
  console.log(`token size ${tokenSize} bytes, ${b64url(tokens[0].serialize()).length} chars in a header`);

  // Origin: redeem every token once.
  const redeem = makeOrigin(origin, keys.publicKey, challenge, pinnedKeyId);
  t0 = performance.now();
  let accepted = 0;
  for (const tok of tokens) if ((await redeem(tok)) === 'ok') accepted++;
  const verifyTime = performance.now() - t0;
  check(`all ${N} tokens accepted once`, accepted === N, `${(verifyTime / N).toFixed(2)} ms per verify`);

  // Header round trips: the 402 challenge (WWW-Authenticate) and each call (Authorization).
  const www = new WWWAuthenticateHeader(challenge, issuerKeyBytes).toString();
  const chl = WWWAuthenticateHeader.parse(www)[0];
  check(
    '402 challenge header round-trips',
    hex(chl.challenge.serialize()) === hex(challenge.serialize()) && hex(chl.tokenKey) === hex(issuerKeyBytes),
    `${www.length} chars`,
  );
  const auth = new AuthorizationHeader(tokens[3]).toString();
  const back = AuthorizationHeader.parse(BLIND_RSA, auth)[0].token;
  check('Authorization header round-trips', hex(back.serialize()) === hex(tokens[3].serialize()), `${auth.length} chars`);

  // Refusals.
  check('reused token refused', (await redeem(tokens[0])) === 'token_reused');

  const otherKeys = await Issuer.generateKey(MODE, RSA);
  const rogue = new Issuer(MODE, ISSUER_NAME, otherKeys.privateKey, otherKeys.publicKey);
  const rogueKeyBytes = await getPublicKeyBytes(otherKeys.publicKey);
  const rc = new Client(MODE);
  const rogueReq = await rc.createTokenRequest(challenge, rogueKeyBytes);
  const rogueTok = await rc.finalize(await rogue.issue(rogueReq));
  check('token from an unpinned key refused', (await redeem(rogueTok)) === 'unknown_key');
  check('unpinned key: client would abort before ordering', hex(sha256(rogueKeyBytes)) !== pinnedKeyId);

  // Forge: correct key id, but a signature from the rogue key.
  const forged = Object.assign(Object.create(Object.getPrototypeOf(rogueTok)), rogueTok, {
    authInput: Object.assign(Object.create(Object.getPrototypeOf(rogueTok.authInput)), rogueTok.authInput, {
      tokenKeyId: tokens[1].authInput.tokenKeyId,
    }),
  });
  check('forged signature refused', (await redeem(forged)) === 'bad_signature');

  // Tamper: flip one bit of an unspent token's nonce.
  const t = tokens[2];
  const badNonce = Uint8Array.from(t.authInput.nonce);
  badNonce[0] ^= 1;
  const tampered = Object.assign(Object.create(Object.getPrototypeOf(t)), t, {
    authInput: Object.assign(Object.create(Object.getPrototypeOf(t.authInput)), t.authInput, { nonce: badNonce }),
  });
  check('tampered nonce refused', (await redeem(tampered)) === 'bad_signature');

  // A token minted for a different origin's challenge.
  const elsewhere = new Origin(MODE, ['other.example']).createTokenChallenge(ISSUER_NAME, new Uint8Array(0));
  const ec = new Client(MODE);
  const elsewhereTok = await ec.finalize(await issuer.issue(await ec.createTokenRequest(elsewhere, issuerKeyBytes)));
  check('token for another origin refused', (await redeem(elsewhereTok)) === 'wrong_challenge');

  // Unlinkability, the property Fare sells: no value the issuer stored appears in
  // anything the origin sees, so there is no field to join purchases and calls on.
  const originView = new Set(tokens.flatMap((tk) => [hex(tk.authInput.nonce), hex(tk.authenticator)]));
  const issuerView = [...issuerLog.blinded, ...issuerLog.signatures];
  const shared = issuerView.filter((v) => originView.has(v)).length;
  check('issuer log and origin log share no value', shared === 0, `${issuerView.length} issuer values vs ${originView.size} origin values`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? 'TOKEN CANARY PASS' : 'TOKEN CANARY FAIL'}: ${results.length - failed}/${results.length} checks`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
