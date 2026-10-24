import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { EPOCH_SECONDS, GRACE_SECONDS } from '../src/config.ts';
import { epochOf, epochStart, KeyRing } from '../src/keys.ts';
import { tempDir } from './helpers.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('one key per 7-day epoch, persisted and reloaded unchanged', async () => {
  const dir = tempDir();
  const t = epochStart(3000) + 3600;
  const a = await new KeyRing(dir).current(t);
  const b = await new KeyRing(dir).current(t + EPOCH_SECONDS - 7200);
  assert.equal(a.epoch, 3000);
  assert.equal(hex(a.keyId), hex(b.keyId), 'same epoch, same key, across restarts');
  assert.equal(a.truncatedKeyId, a.keyId[31]);
  assert.equal(statSync(join(dir, 'keys', '3000.json')).mode & 0o777, 0o600);
  assert.equal(epochOf(epochStart(3001) - 1), 3000);
  assert.equal(epochOf(epochStart(3001)), 3001);
});

test('concurrent first requests in an epoch get one key, not two', async () => {
  const dir = tempDir();
  const ring = new KeyRing(dir);
  const t = epochStart(4000) + 60;
  const keys = await Promise.all([ring.current(t), ring.current(t), ring.live(t), ring.current(t)]);
  const ids = new Set(keys.map((k) => hex(Array.isArray(k) ? k[0].keyId : k.keyId)));
  assert.equal(ids.size, 1, 'every caller sees the same key');
  assert.equal(hex((await new KeyRing(dir).current(t)).keyId), [...ids][0], 'and it is the one on disk');
});

test('rotation keeps the previous key for a 24 h grace window, then drops it', async () => {
  const ring = new KeyRing(tempDir());
  const old = await ring.current(epochStart(5000) + 10);
  const start = epochStart(5001);

  const during = await ring.live(start + GRACE_SECONDS - 1);
  assert.equal(during.length, 2);
  assert.equal(during[0].epoch, 5001);
  assert.equal(hex(during[1].keyId), hex(old.keyId));
  assert.notEqual(during[0].truncatedKeyId, during[1].truncatedKeyId, 'live keys never share a truncated id');
  assert.ok(ring.signable(5000, start + GRACE_SECONDS - 1));

  const after = await ring.live(start + GRACE_SECONDS);
  assert.deepEqual(after.map((k) => k.epoch), [5001]);
  assert.equal(ring.signable(5000, start + GRACE_SECONDS), undefined, 'retired keys sign nothing');
});

test('a key never signs before its epoch starts', async () => {
  const ring = new KeyRing(tempDir());
  await ring.current(epochStart(7000));
  assert.equal(ring.signable(7000, epochStart(7000) - 1), undefined);
});
