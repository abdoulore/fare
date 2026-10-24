// Server-view panel, loopback only. It shows what each side holds, side by side:
// the issuer's purchases and the origin's redemption counts. There is no column they
// share: nothing on the issuer side names a token, nothing on the origin side names a
// purchase (invariant 7). The anonymity set is how many issued tokens any one accepted
// call could have come from.
//
// The page loads nothing from outside this server: no fonts, scripts or trackers
// (invariant 12).

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import type { createOrigin } from '../../origin/src/index.ts';

type Origin = ReturnType<typeof createOrigin>;

export interface PanelOptions {
  origin: Origin;
  issuerDataDir: string;
  scannerUrl: string;
  pack: number;
  simulated: boolean;
}

interface PurchaseRow {
  id: string;
  status: string;
  received_zat: number;
  leaky_funding: boolean;
}

export async function panelStats(opts: PanelOptions) {
  const file = join(opts.issuerDataDir, 'purchases.json');
  const records: { id: string; epoch: number }[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const rows: PurchaseRow[] = [];
  for (const r of records) {
    let row: PurchaseRow = { id: r.id, status: 'unknown', received_zat: 0, leaky_funding: false };
    try {
      const res = await fetch(`${opts.scannerUrl.replace(/\/+$/, '')}/purchases/${r.id}`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        const s = (await res.json()) as { status: string; received_zat: number; leaky_funding: boolean };
        row = { id: r.id, status: s.status, received_zat: s.received_zat, leaky_funding: s.leaky_funding };
      }
    } catch {
      // scanner down: shown as unknown
    }
    rows.push(row);
  }
  const paid = rows.filter((r) => r.status === 'paid').length;
  const origin = opts.origin.stats();
  return {
    simulated: opts.simulated,
    issuer: {
      purchases: rows.map((r) => ({ id: `${r.id.slice(0, 8)}...`, status: r.status, received_zat: r.received_zat, leaky_funding: r.leaky_funding })),
      paid,
      tokens_issued: paid * opts.pack,
    },
    origin: {
      redeemed: origin.redeemed,
      challenged: origin.challenged,
      refused: origin.refused,
    },
    anonymity_set: {
      purchases: paid,
      tokens: paid * opts.pack,
      statement:
        paid === 0
          ? 'No paid purchases yet.'
          : `Each accepted call carries one of ${paid * opts.pack} tokens from ${paid} purchase${paid === 1 ? '' : 's'}. The origin cannot tell which.`,
    },
  };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fare server view</title>
<style>
  :root { --bg: #f7f7f5; --fg: #1d1d1b; --muted: #6b6b66; --card: #ffffff; --line: #e2e2dc; --ok: #1f7a4d; --warn: #9a5b00; --bad: #a3262a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141413; --fg: #ececea; --muted: #a0a09a; --card: #1e1e1c; --line: #33332f; --ok: #5fc08f; --warn: #e0a64a; --bad: #ef7b7f; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: var(--muted); margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; }
  .big { font-size: 28px; font-weight: 600; }
  .paid { color: var(--ok); } .underpaid, .expired { color: var(--warn); } .bad { color: var(--bad); }
  .set { margin-top: 16px; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--warn); color: var(--warn); font-size: 12px; margin-left: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>Fare: what each side sees <span id="sim" class="tag" hidden>LLM answers simulated</span></h1>
  <p class="sub">Issuer on the left, origin on the right. No column links a purchase to a call.</p>
  <div class="grid">
    <section>
      <h2>Issuer: purchases</h2>
      <table><thead><tr><th>Purchase</th><th>Status</th><th>Received (TAZ)</th></tr></thead><tbody id="purchases"></tbody></table>
      <p><span class="big" id="issued">0</span> tokens issued</p>
    </section>
    <section>
      <h2>Origin: redemptions</h2>
      <p><span class="big" id="redeemed">0</span> calls served, one token each</p>
      <table><thead><tr><th>Refused</th><th>Count</th></tr></thead><tbody id="refused"></tbody></table>
      <p class="sub">The origin stores spent nonces only: no time, no address, no purchase.</p>
    </section>
  </div>
  <section class="set">
    <h2>Anonymity set</h2>
    <p id="statement">Loading.</p>
  </section>
</main>
<script>
  const zec = (z) => (z / 1e8).toString();
  const cell = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; return td; };
  async function tick() {
    try {
      const s = await (await fetch('/panel/stats', { cache: 'no-store' })).json();
      document.getElementById('sim').hidden = !s.simulated;
      const p = document.getElementById('purchases'); p.replaceChildren();
      for (const r of s.issuer.purchases) {
        const tr = document.createElement('tr');
        tr.append(cell(r.id), cell(r.status + (r.leaky_funding ? ' (transparent funded)' : ''), r.status), cell(zec(r.received_zat)));
        p.append(tr);
      }
      if (!s.issuer.purchases.length) { const tr = document.createElement('tr'); tr.append(cell('none yet'), cell(''), cell('')); p.append(tr); }
      document.getElementById('issued').textContent = s.issuer.tokens_issued;
      document.getElementById('redeemed').textContent = s.origin.redeemed;
      const f = document.getElementById('refused'); f.replaceChildren();
      for (const [k, v] of Object.entries(s.origin.refused)) { const tr = document.createElement('tr'); tr.append(cell(k), cell(String(v), v ? 'bad' : '')); f.append(tr); }
      document.getElementById('statement').textContent = s.anonymity_set.statement;
    } catch { document.getElementById('statement').textContent = 'Panel cannot reach its stats.'; }
  }
  tick(); setInterval(tick, 3000);
</script>
</body>
</html>
`;

export function createPanel(opts: PanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/' || path === '/panel') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // Nothing but this server: invariant 12.
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(PAGE);
      return;
    }
    if (path === '/panel/stats') {
      const body = JSON.stringify(await panelStats(opts));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
      return;
    }
    res.writeHead(404).end();
  };
}

export { PAGE as PANEL_PAGE };
