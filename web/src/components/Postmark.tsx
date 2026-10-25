// A postmark: a double ring with its inscription and wavy cancellation bars. The site's
// signature mark: the hero's live 402 and the replay bounce. Spent stamps in a pane carry the
// same wavy bars (styles.css, .pane i.spent).

import { useId } from 'react';

export type PostmarkTone = 'cancel' | 'refused' | 'paid';

export interface PostmarkProps {
  /** Around the top of the ring. */
  top: string;
  /** Around the bottom of the ring. */
  bottom: string;
  /** Large, in the middle. */
  center: string;
  /** Small, under the center line. */
  sub?: string;
  tone?: PostmarkTone;
  /** Play the strike (ink drawn on) once when mounted. */
  strike?: boolean;
  size?: number;
  /** Accessible description; the mark is decorative when omitted. */
  label?: string;
}

/** Martian Mono advances every glyph 0.7 em. */
export const MONO_ADVANCE = 0.7;
const RING_R = 46;
/** Half the ring, less a gap at 3 and 9 o'clock so the two inscriptions never meet. */
export const ARC_USABLE = Math.PI * RING_R - 26;
const RING_TRACK = 0.12;
const INNER_WIDTH = 62;

/** Font size that fits both ring inscriptions on their half arcs, the same size for both. */
export function ringFontSize(top: string, bottom: string): number {
  const n = Math.max(top.length, bottom.length, 1);
  return Math.min(9.5, ARC_USABLE / (n * (MONO_ADVANCE + RING_TRACK)));
}

/** Font size that fits a straight line inside the inner ring. */
export function innerFontSize(text: string, max: number, track = 0): number {
  return Math.min(max, INNER_WIDTH / (Math.max(text.length, 1) * (MONO_ADVANCE + track)));
}

export function Postmark({ top, bottom, center, sub, tone = 'cancel', strike = false, size = 156, label }: PostmarkProps) {
  const id = useId().replace(/:/g, '');
  const r = RING_R;
  const arc = (sweep: 0 | 1) => (sweep === 1 ? `M ${60 - r},60 A ${r},${r} 0 0,1 ${60 + r},60` : `M ${60 - r},60 A ${r},${r} 0 0,0 ${60 + r},60`);
  const ring = ringFontSize(top, bottom);
  const centerSize = innerFontSize(center, 21);
  const subSize = sub ? innerFontSize(sub, 7.5, 0.08) : 0;
  return (
    <span className={`postmark ${tone === 'cancel' ? '' : tone}${strike ? ' strike' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={size * 1.9} height={size} viewBox="0 0 228 120">
        <defs>
          <path id={`${id}-t`} d={arc(1)} />
          <path id={`${id}-b`} d={arc(0)} />
        </defs>
        <g className="ring">
          <circle cx="60" cy="60" r="56" strokeWidth="2.6" />
          <circle cx="60" cy="60" r="36" strokeWidth="1.4" />
          <text className="inscription" fontSize={ring} letterSpacing={ring * RING_TRACK} fontWeight="600" dy={ring * 0.35}>
            <textPath href={`#${id}-t`} startOffset="50%" textAnchor="middle">
              {top}
            </textPath>
          </text>
          <text className="inscription" fontSize={ring} letterSpacing={ring * RING_TRACK} fontWeight="600" dy={ring * 0.35}>
            <textPath href={`#${id}-b`} startOffset="50%" textAnchor="middle">
              {bottom}
            </textPath>
          </text>
          <text x="60" y={sub ? 63 : 60 + centerSize * 0.36} fontSize={centerSize} fontWeight="700" textAnchor="middle">
            {center}
          </text>
          {sub && (
            <text x="60" y="77" fontSize={subSize} letterSpacing={subSize * 0.08} textAnchor="middle">
              {sub}
            </text>
          )}
        </g>
        <g className="bars" strokeWidth="2.4" strokeLinecap="round">
          {[34, 47, 60, 73, 86].map((y) => (
            <path key={y} d={`M 122 ${y} q 13 -7 26 0 t 26 0 t 26 0 t 26 0`} />
          ))}
        </g>
      </svg>
    </span>
  );
}
