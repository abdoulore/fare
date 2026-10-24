// Client for the scanner sidecar (`fare-scanner serve`), reached over loopback.

export class ScannerUnavailable extends Error {}

export interface Minted {
  purchase_id: string;
  pay_uri: string;
}

export interface ScannerStatus {
  status: 'pending' | 'in_mempool' | 'confirming' | 'paid' | 'underpaid';
  leaky_funding: boolean;
}

const STATUSES = new Set(['pending', 'in_mempool', 'confirming', 'paid', 'underpaid']);

export class ScannerClient {
  private readonly base: string;

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  private async call(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new ScannerUnavailable('scanner sidecar unreachable');
    }
  }

  async mint(priceZat: number): Promise<Minted> {
    const res = await this.call('/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ price_zat: priceZat }),
    });
    if (res.status !== 201) throw new ScannerUnavailable(`scanner refused to mint (${res.status})`);
    const body = (await res.json()) as Partial<Minted>;
    if (typeof body.purchase_id !== 'string' || typeof body.pay_uri !== 'string') {
      throw new ScannerUnavailable('scanner sent a malformed mint response');
    }
    return { purchase_id: body.purchase_id, pay_uri: body.pay_uri };
  }

  /** `undefined` when the scanner does not know the purchase. */
  async status(id: string): Promise<ScannerStatus | undefined> {
    const res = await this.call(`/purchases/${id}`);
    if (res.status === 404) return undefined;
    if (res.status !== 200) throw new ScannerUnavailable(`scanner status failed (${res.status})`);
    const body = (await res.json()) as { status?: unknown; leaky_funding?: unknown };
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
      throw new ScannerUnavailable('scanner sent an unknown status');
    }
    return { status: body.status as ScannerStatus['status'], leaky_funding: body.leaky_funding === true };
  }
}
