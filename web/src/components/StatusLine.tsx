import { useEffect, useState } from 'react';

import { formatZat, health, type Health } from '../lib/api.ts';

export function StatusLine() {
  const [h, setH] = useState<Health | undefined>();
  useEffect(() => {
    let alive = true;
    const load = () => void health().then((x) => alive && setH(x));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!h) return <p className="status" aria-live="polite">Checking services…</p>;
  return (
    <p className="status" data-testid="status-line">
      <span>scanner {h.issuer?.scanned_to != null ? <>synced to <b className="mono">{h.issuer.scanned_to.toLocaleString('en-US')}</b></> : <b>unreachable</b>}</span>
      <span>issuer key {h.issuer ? <b className="mono">{h.issuer.key_id.slice(0, 12)}</b> : <b>unreachable</b>}</span>
      <span>answers {h.api ? <b>{h.api.model === 'real' ? 'from Claude' : 'simulated'}</b> : <b>unreachable</b>}</span>
      <span>
        demo payer{' '}
        {!h.payer ? <b>unreachable</b> : h.payer.empty ? <b>empty</b> : h.payer.balance_zat != null ? <b className="mono">{formatZat(h.payer.balance_zat)} TAZ</b> : <b>syncing</b>}
      </span>
    </p>
  );
}
