// Reads of the public, id-free views, and the demo payer.

import { API_URL, ISSUER_URL, PAYER_URL } from './config.ts';

export interface LedgerRow {
  index: number;
  price_zat: number | null;
  received_zat: number;
  payments: number;
  height: number | null;
  status: string;
}

export interface LedgerKey {
  key_id: string;
  epoch: number;
  not_before: number;
  retires_at: number;
  packs: number;
  issued: number;
}

export interface Ledger {
  scanned_to: number | null;
  rows: LedgerRow[];
  keys: LedgerKey[];
  pack: number;
  price_zat: number;
}

export interface OriginStats {
  redeemed: number;
  challenged: number;
  refused: Record<string, number>;
  /** Spent tokens per key id prefix (16 hex). */
  spent_by_key: Record<string, number>;
}

export interface Health {
  issuer?: { ok: boolean; key_id: string; epoch: number; retires_at: number; scanned_to: number | null };
  api?: { ok: boolean; model: 'real' | 'simulated'; key_id: string | null };
  payer?: { ok: boolean; balance_zat: number | null; empty: boolean; packs_left_this_hour: number };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${new URL(url).pathname} answered ${res.status}`);
  return (await res.json()) as T;
}

export const ledger = () => getJson<Ledger>(`${ISSUER_URL}/fare/ledger`);
export const originStats = () => getJson<OriginStats>(`${API_URL}/v1/stats`);

export async function health(): Promise<Health> {
  const [issuer, api, payer] = await Promise.allSettled([
    getJson<Health['issuer']>(`${ISSUER_URL}/health`),
    getJson<Health['api']>(`${API_URL}/health`),
    getJson<Health['payer']>(`${PAYER_URL}/health`),
  ]);
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
  return { issuer: value(issuer), api: value(api), payer: value(payer) };
}

export interface DemoPayment {
  txids: string[];
  amount_zec: string;
  mode: 'full' | 'half';
  paid_by: string;
}

/** Asks the demo payer to pay `payUri`. Throws an Error whose message is the refusal code. */
export async function demoPay(payUri: string, mode: 'full' | 'half'): Promise<DemoPayment> {
  let res: Response;
  try {
    res = await fetch(`${PAYER_URL}/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pay_uri: payUri, mode }),
    });
  } catch {
    throw new Error('demo_payer_unreachable');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<DemoPayment> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return body as DemoPayment;
}

export function payerRefusal(code: string): string {
  switch (code) {
    case 'demo_payer_hourly_limit':
      return 'The demo payer has paid its 5 packs for this hour. Try later, or pay from your own testnet wallet.';
    case 'demo_payer_client_limit':
      return 'The demo payer pays at most 2 packs an hour per visitor.';
    case 'demo_payer_busy':
      return 'The demo payer is paying another visitor. Try again in a minute.';
    case 'demo_payer_empty':
      return 'The demo payer is out of testnet funds.';
    case 'already_paid':
      return 'The demo payer already paid this purchase.';
    case 'demo_payer_failed':
      return 'The payment did not go through (lightwalletd or the wallet failed). Nothing was spent; try again.';
    case 'demo_payer_unreachable':
      return 'The demo payer is not reachable.';
    default:
      return code.replace(/_/g, ' ');
  }
}

export const formatZat = (zat: number): string => {
  const whole = Math.floor(zat / 1e8);
  const frac = (zat % 1e8).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};
