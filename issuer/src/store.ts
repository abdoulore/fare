// Purchases the issuer knows: the blinded requests to sign once paid, and the key epoch
// they were blinded under. No client address, no user agent, no request times
// (invariant 8). Signatures are not stored: blind RSA is deterministic, so they are
// recomputed on each poll.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PurchaseRecord {
  /** 128 random bits, hex. Minted by the scanner; a capability for the buyer. */
  id: string;
  epoch: number;
  /** Serialized TokenRequests, base64url, in the buyer's order. */
  requests: string[];
  pay_uri: string;
  /** Unix seconds. */
  expires_at: number;
}

export class PurchaseStore {
  private readonly path: string;
  private readonly records: Map<string, PurchaseRecord>;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.path = join(dataDir, 'purchases.json');
    const list: PurchaseRecord[] = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
    this.records = new Map(list.map((r) => [r.id, r]));
  }

  get(id: string): PurchaseRecord | undefined {
    return this.records.get(id);
  }

  /** Saved to disk before it is visible, so an answered purchase survives a restart. */
  add(record: PurchaseRecord): void {
    if (this.records.has(record.id)) throw new Error('duplicate purchase id');
    const next = [...this.records.values(), record];
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, this.path);
    this.records.set(record.id, record);
  }
}
