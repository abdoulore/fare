// The two public, id-free views: the issuer's ledger and the API's redemption counts.

import { useEffect, useState } from 'react';

import { ledger as fetchLedger, originStats, type Ledger, type OriginStats } from './api.ts';

export function useServerView(intervalMs = 10_000) {
  const [ledger, setLedger] = useState<Ledger>();
  const [stats, setStats] = useState<OriginStats>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [l, s] = await Promise.allSettled([fetchLedger(), originStats()]);
      if (!alive) return;
      if (l.status === 'fulfilled') setLedger(l.value);
      if (s.status === 'fulfilled') setStats(s.value);
      setError(l.status === 'rejected' || s.status === 'rejected' ? 'Part of the live view is unreachable.' : undefined);
    };
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  const key = ledger?.keys[0];
  const spent = key && stats ? (stats.spent_by_key[key.key_id.slice(0, 16)] ?? 0) : 0;
  return { ledger, stats, error, key, spent };
}
