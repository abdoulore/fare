// Asks the API for a call with no token and checks the 402's key against the issuer
// directory, exactly as a client does before ordering anything.

import { useEffect, useState } from 'react';

import { parseOffer, UnpinnedKeyError, type Offer } from '../../../sdk/src/core.ts';
import { API_URL } from './config.ts';
import { createClient } from './fare.ts';
import { memoryStore } from './store.ts';

export type Live402 =
  | { state: 'loading' }
  | { state: 'ok'; offer?: Offer; at: Date }
  | { state: 'refused'; reason: string; at: Date }
  | { state: 'down'; at: Date };

export function useLive402(): Live402 {
  const [live, setLive] = useState<Live402>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'home page check' }) });
        if (res.status !== 402) throw new Error(`status ${res.status}`);
        const client = await createClient(memoryStore());
        await client.pin();
        try {
          await client.acceptChallenge(res.headers.get('www-authenticate'));
          if (alive) setLive({ state: 'ok', offer: parseOffer(res.headers.get('fare-offer')), at: new Date() });
        } catch (e) {
          if (alive) setLive({ state: 'refused', reason: e instanceof UnpinnedKeyError ? 'key not listed' : 'bad challenge', at: new Date() });
        }
      } catch {
        if (alive) setLive({ state: 'down', at: new Date() });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return live;
}
