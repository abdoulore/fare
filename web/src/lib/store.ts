// Token storage in this browser's IndexedDB: the pinned key and unspent tokens. Nothing
// here leaves the browser except a token, once, in the Authorization header of a call.

import type { SdkState } from '../../../sdk/src/core.ts';

const DB = 'fare';
const STORE = 'state';
const KEY = 'sdk';

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export interface TokenStore {
  load(): Promise<SdkState>;
  save(state: SdkState): Promise<void>;
  clear(): Promise<void>;
}

export function idbStore(idb: IDBFactory = indexedDB): TokenStore {
  return {
    async load() {
      const db = await open(idb);
      try {
        const tx = db.transaction(STORE, 'readonly');
        const got = await new Promise<unknown>((resolve, reject) => {
          const req = tx.objectStore(STORE).get(KEY);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const s = got as SdkState | undefined;
        return s && Array.isArray(s.tokens) ? { pinnedKey: s.pinnedKey, tokens: s.tokens } : { tokens: [] };
      } finally {
        db.close();
      }
    },
    async save(state) {
      const db = await open(idb);
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ pinnedKey: state.pinnedKey, tokens: state.tokens }, KEY);
        await done(tx);
      } finally {
        db.close();
      }
    },
    async clear() {
      const db = await open(idb);
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        await done(tx);
      } finally {
        db.close();
      }
    },
  };
}

/** For a browser without IndexedDB (a private window may refuse it): tokens live in the tab. */
export function memoryStore(): TokenStore {
  let state: SdkState = { tokens: [] };
  return {
    load: async () => ({ pinnedKey: state.pinnedKey, tokens: [...state.tokens] }),
    save: async (s) => {
      state = { pinnedKey: s.pinnedKey, tokens: [...s.tokens] };
    },
    clear: async () => {
      state = { tokens: [] };
    },
  };
}
