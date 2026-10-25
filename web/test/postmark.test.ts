import { describe, expect, it } from 'vitest';
import { ARC_USABLE, innerFontSize, MONO_ADVANCE, ringFontSize } from '../src/components/Postmark.tsx';

// Every inscription the site stamps, top and bottom of the ring. The longest offer the issuer
// allows is one pack of 100 at the fixed price.
const RINGS: [string, string][] = [
  ['LIVE API', '100 FOR 0.001 TAZ'],
  ['API · LIVE', 'ASKING'],
  ['API · LIVE', '2026 10 25'],
  ['RETURNED', 'KEY NOT LISTED'],
  ['RETURNED', 'BAD CHALLENGE'],
  ['ALREADY CANCELLED', 'TOKEN REUSED'],
];

describe('postmark inscriptions', () => {
  it('fit their half of the ring at a readable size', () => {
    for (const [top, bottom] of RINGS) {
      const size = ringFontSize(top, bottom);
      expect(size).toBeGreaterThanOrEqual(8);
      for (const text of [top, bottom]) expect(text.length * size * (MONO_ADVANCE + 0.12)).toBeLessThanOrEqual(ARC_USABLE + 0.001);
    }
  });

  it('shrinks a long inscription instead of letting it run off the arc', () => {
    expect(ringFontSize('100 CALLS · 0.001 TAZ', 'X')).toBeLessThan(9.5);
  });

  it('fits the center line inside the inner ring', () => {
    for (const center of ['402', '401', '···', 'NO ANSWER']) expect(center.length * innerFontSize(center, 21) * MONO_ADVANCE).toBeLessThanOrEqual(62.001);
  });
});
