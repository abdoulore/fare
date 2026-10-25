// Who sees what, drawn in the sheet's inks: vermilion for the buyer's side, ultramarine for
// the operator's, split by a perforation. Two layouts, wide and tall; CSS shows one.

import { useId } from 'react';

type Side = 'buyer' | 'operator' | 'public' | 'chain';
type Node = { id: string; title: string; lines: string[]; side: Side };
type Box = { x: number; y: number; w: number };
type Edge = { d: string; label?: string; lx?: number; ly?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: boolean; dashed?: boolean; both?: boolean };
type Seam = { d: string; lx: number; ly: number; rotate?: boolean };

const NODES: Node[] = [
  { id: 'buyer', title: "Buyer's browser or agent", lines: ['pins the published key', 'blinds 100 requests, unblinds', 'spends one token per call'], side: 'buyer' },
  { id: 'wallet', title: 'Payer wallet', lines: ['your own shielded wallet, or', "Fare's demo payer on this site"], side: 'buyer' },
  { id: 'issuer', title: 'Issuer', lines: ['signs 100 blinded requests', 'after 1 confirmation', 'never sees a token'], side: 'operator' },
  { id: 'scanner', title: 'Scanner', lines: ['viewing key only', 'matches by address index', 'no memo, no tx lookups'], side: 'operator' },
  { id: 'origin', title: 'Your API + fare-origin', lines: ['checks key, challenge,', 'signature and spent set', 'never sees a purchase'], side: 'operator' },
  { id: 'directory', title: 'Issuer directory', lines: ["the issuer's public key"], side: 'public' },
  { id: 'chain', title: 'Zcash testnet, Ironwood', lines: ['whole compact blocks only,', 'via lightwalletd, nothing targeted'], side: 'chain' },
];

const HEAD = 34;
const LINE = 20;
const height = (n: Node) => HEAD + 14 + n.lines.length * LINE + 6;

interface Layout {
  w: number;
  h: number;
  boxes: Record<string, Box>;
  edges: Edge[];
  seam: Seam[];
}

const WIDE: Layout = {
  w: 1000,
  h: 620,
  boxes: {
    buyer: { x: 20, y: 70, w: 280 },
    issuer: { x: 380, y: 70, w: 280 },
    origin: { x: 740, y: 70, w: 240 },
    wallet: { x: 20, y: 290, w: 280 },
    scanner: { x: 380, y: 290, w: 280 },
    directory: { x: 740, y: 290, w: 240 },
    chain: { x: 200, y: 500, w: 460 },
  },
  edges: [
    { d: 'M300,112 H378', label: 'order', lx: 340, ly: 103 },
    { d: 'M380,148 H302', label: 'signatures', lx: 340, ly: 167 },
    { d: 'M160,70 V40 H860 V68', label: 'one token per call', lx: 510, ly: 32 },
    { d: 'M160,188 V288', label: 'pay URI', lx: 172, ly: 243, anchor: 'start' },
    { d: 'M160,388 V549 H198', label: 'shielded payment', lx: 172, ly: 470, anchor: 'start' },
    { d: 'M520,500 V410', label: 'compact blocks', lx: 532, ly: 460, anchor: 'start' },
    { d: 'M520,290 V190', label: 'paid at index j', lx: 532, ly: 243, anchor: 'start' },
    { d: 'M620,190 V245 H820 V288', label: 'publishes its key', lx: 712, ly: 237, anchor: 'start', dashed: true },
    { d: 'M920,290 V190', label: 'reads it', lx: 928, ly: 243, anchor: 'start' },
  ],
  seam: [{ d: 'M700,58 V440', lx: 700, ly: 130, rotate: true }],
};

const TALL: Layout = {
  w: 360,
  h: 1050,
  boxes: {
    buyer: { x: 24, y: 30, w: 312 },
    wallet: { x: 24, y: 190, w: 312 },
    chain: { x: 24, y: 330, w: 312 },
    scanner: { x: 24, y: 470, w: 312 },
    issuer: { x: 24, y: 630, w: 312 },
    directory: { x: 100, y: 790, w: 160 },
    origin: { x: 24, y: 910, w: 312 },
  },
  edges: [
    { d: 'M110,148 V188', label: 'pay URI', lx: 122, ly: 173, anchor: 'start' },
    { d: 'M110,288 V328', label: 'shielded payment', lx: 122, ly: 313, anchor: 'start' },
    { d: 'M110,428 V468', label: 'compact blocks', lx: 122, ly: 453, anchor: 'start' },
    { d: 'M110,588 V628', label: 'paid at index j', lx: 122, ly: 613, anchor: 'start' },
    { d: 'M24,89 H8 V689 H22', label: 'order, then signatures', lx: 21, ly: 389, rotate: true, both: true },
    { d: 'M336,60 H352 V969 H338', label: 'one token per call', lx: 346, ly: 520, rotate: true },
    { d: 'M180,748 V788', label: 'publishes its key', lx: 192, ly: 773, anchor: 'start', dashed: true },
    { d: 'M180,858 V908', label: 'reads it', lx: 192, ly: 888, anchor: 'start' },
  ],
  seam: [
    { d: 'M24,827 H90', lx: 57, ly: 815 },
    { d: 'M270,827 H336', lx: 303, ly: 815 },
  ],
};

function Diagram({ layout, className }: { layout: Layout; className: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox={`0 0 ${layout.w} ${layout.h}`} role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>
        The buyer's browser blinds 100 requests and orders a pack from the issuer, then pays the purchase address from a shielded wallet on Zcash testnet. The scanner, holding a
        viewing key only, reads compact blocks and tells the issuer the purchase is paid; the issuer signs the blinded requests. The browser spends one token per call at your API.
        The issuer and the API share no id, table or log, only the issuer's public key in the directory.
      </title>
      <defs>
        <marker id={`${id}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
      </defs>
      {layout.seam.map((s) => (
        <g key={s.d} className="seam-line">
          <path d={s.d} />
          <text x={s.lx} y={s.ly} textAnchor="middle" transform={s.rotate ? `rotate(-90 ${s.lx} ${s.ly})` : undefined} dy={s.rotate ? 4 : 0}>
            NO LINK
          </text>
        </g>
      ))}
      {layout.edges.map((e) => (
        <g key={e.d} className={`edge${e.dashed ? ' dashed' : ''}${e.rotate ? ' lane' : ''}`}>
          <path d={e.d} markerEnd={`url(#${id}-a)`} markerStart={e.both ? `url(#${id}-a)` : undefined} />
          {e.label && (
            <text x={e.lx} y={e.ly} textAnchor={e.rotate ? 'middle' : (e.anchor ?? 'middle')} transform={e.rotate ? `rotate(-90 ${e.lx} ${e.ly})` : undefined}>
              {e.label}
            </text>
          )}
        </g>
      ))}
      {NODES.map((n) => {
        const b = layout.boxes[n.id];
        const h = height(n);
        return (
          <g key={n.id} className={`node ${n.side}`}>
            <rect className="body" x={b.x} y={b.y} width={b.w} height={h} rx="3" />
            <rect className="head" x={b.x} y={b.y} width={b.w} height={HEAD} rx="3" />
            <rect className="head" x={b.x} y={b.y + HEAD - 4} width={b.w} height="4" />
            <text className="title" x={b.x + 14} y={b.y + 24}>
              {n.title}
            </text>
            {n.lines.map((l, i) => (
              <text key={l} className="line" x={b.x + 14} y={b.y + HEAD + 24 + i * LINE}>
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function Architecture() {
  return (
    <figure className="arch">
      <Diagram layout={WIDE} className="arch-wide" />
      <Diagram layout={TALL} className="arch-tall" />
      <figcaption>
        Vermilion is the buyer's side, ultramarine the operator's, torn in two: the issuer sees purchases, your API sees tokens. The dashed line is the only thing they share, the
        issuer's public key.
      </figcaption>
    </figure>
  );
}
