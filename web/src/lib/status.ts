// Maps the issuer's purchase status to what the page shows.

export type Tone = 'wait' | 'paid' | 'refused';

export interface StepView {
  /** 0 pending, 1 in mempool, 2 confirming, 3 paid; -1 for a dead end. */
  step: number;
  label: string;
  tone: Tone;
  /** No tokens will ever come from this purchase. */
  final: boolean;
  detail: string;
}

export const STEPS = ['pending', 'mempool', 'confirming', 'paid'] as const;

export function viewStatus(status: string): StepView {
  switch (status) {
    case 'pending':
      return { step: 0, label: 'pending', tone: 'wait', final: false, detail: 'Nothing seen on chain yet.' };
    case 'in_mempool':
      return { step: 1, label: 'in mempool', tone: 'wait', final: false, detail: 'Seen unconfirmed. Tokens wait for one confirmation, never the mempool alone.' };
    case 'confirming':
      return { step: 2, label: 'confirming 0 of 1', tone: 'wait', final: false, detail: 'Mined, waiting for the block to count.' };
    case 'paid':
      return { step: 3, label: 'paid', tone: 'paid', final: false, detail: 'One confirmation. The issuer signs your blinded requests.' };
    case 'underpaid':
      return { step: -1, label: 'postage due', tone: 'refused', final: true, detail: 'Underpaid: mined but short of the price. No signatures are issued.' };
    case 'expired':
      return { step: -1, label: 'expired', tone: 'refused', final: true, detail: 'Nobody paid within 24 hours. Order again.' };
    case 'key_retired':
      return { step: -1, label: 'key retired', tone: 'refused', final: true, detail: 'The key these requests were blinded under has retired. Order again.' };
    case 'unknown_purchase':
      return { step: -1, label: 'unknown purchase', tone: 'refused', final: true, detail: 'The issuer does not know this purchase.' };
    default:
      return { step: 0, label: status.replace(/_/g, ' '), tone: 'wait', final: false, detail: 'The issuer could not answer; still trying.' };
  }
}

/** Why the origin refused a token, in one sentence. */
export function refusalText(reason: string): string {
  switch (reason) {
    case 'token_reused':
      return 'This token was already spent. Each token works once.';
    case 'bad_signature':
      return 'The token does not verify against the issuer key.';
    case 'unknown_key':
      return 'The token names an issuer key the API does not know.';
    case 'wrong_challenge':
      return 'The token was issued for another API.';
    case 'expired_epoch':
      return 'The token key has retired.';
    default:
      return reason.replace(/_/g, ' ');
  }
}
