// A postmark: a double ring with its inscription and wavy cancellation bars. The site's
// signature mark: the hero's live 402, every spent token, the replay bounce and postage due.

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

export function Postmark({ top, bottom, center, sub, tone = 'cancel', strike = false, size = 156, label }: PostmarkProps) {
  const id = useId().replace(/:/g, '');
  const r = 46;
  const arc = (sweep: 0 | 1) => (sweep === 1 ? `M ${60 - r},60 A ${r},${r} 0 0,1 ${60 + r},60` : `M ${60 - r},60 A ${r},${r} 0 0,0 ${60 + r},60`);
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
          <text fontSize="9.5" letterSpacing="1.6" fontWeight="600">
            <textPath href={`#${id}-t`} startOffset="50%" textAnchor="middle">{top}</textPath>
          </text>
          <text fontSize="9.5" letterSpacing="1.6" fontWeight="600" dy="8">
            <textPath href={`#${id}-b`} startOffset="50%" textAnchor="middle">{bottom}</textPath>
          </text>
          <text x="60" y={sub ? 63 : 67} fontSize={center.length > 4 ? 13 : 21} fontWeight="700" textAnchor="middle">
            {center}
          </text>
          {sub && (
            <text x="60" y="77" fontSize="7.5" letterSpacing="0.6" textAnchor="middle">
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
