import { describe, expect, test } from 'vitest';

import { refusalText, viewStatus } from '../src/lib/status.ts';
import { csp } from '../vite.config.ts';

describe('status mapping', () => {
  test('steps forward and never offers tokens before paid', () => {
    expect(['pending', 'in_mempool', 'confirming', 'paid'].map((s) => viewStatus(s).step)).toEqual([0, 1, 2, 3]);
    expect(viewStatus('in_mempool').detail).toMatch(/never the mempool alone/);
    expect(viewStatus('paid').tone).toBe('paid');
  });

  test('underpaid, expired, retired and unknown are dead ends with no tokens', () => {
    for (const s of ['underpaid', 'expired', 'key_retired', 'unknown_purchase']) {
      const v = viewStatus(s);
      expect(v.final, s).toBe(true);
      expect(v.tone, s).toBe('refused');
      expect(v.step, s).toBe(-1);
    }
    expect(viewStatus('underpaid').detail).toMatch(/No signatures/);
  });

  test('an issuer hiccup keeps waiting', () => {
    const v = viewStatus('scanner_unavailable');
    expect(v.final).toBe(false);
    expect(v.label).toBe('scanner unavailable');
  });

  test('every origin refusal has a sentence', () => {
    for (const r of ['token_reused', 'bad_signature', 'unknown_key', 'wrong_challenge', 'expired_epoch']) {
      expect(refusalText(r)).not.toContain('_');
    }
    expect(refusalText('token_reused')).toMatch(/already spent/);
  });
});

describe('content security policy', () => {
  test('names this origin and the three services, nothing else', () => {
    const policy = csp({ VITE_API_URL: 'https://api.fare.example/', VITE_ISSUER_URL: 'https://issuer.fare.example', VITE_PAYER_URL: 'https://payer.fare.example:8443/x' });
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self' https://api.fare.example https://issuer.fare.example https://payer.fare.example:8443");
    expect(policy).not.toMatch(/unsafe|\*/);
    for (const d of ['script-src', 'style-src', 'font-src', 'img-src']) expect(policy).toContain(`${d} 'self'`);
  });
});
