// Client state in this browser's IndexedDB: the pinned key, unspent tokens and saved
// orders. Nothing here leaves the browser except a token, once, in the Authorization header
// of a call.
//
// Every update is one readwrite transaction: read, change, write. IndexedDB runs
// transactions on the same store one at a time, across tabs too, so two tabs never take
// the same token or overwrite each other's tokens. After each write the other tabs are told
// on a BroadcastChannel (same origin, this device only) so they can refresh their view.

import { memoryStateStore, normalize, type SdkState, type StateStore, type Updated } from '../../../sdk/src/core.ts';

const DB = 'fare';
const STORE = 'state';
const KEY = 'sdk';
const CHANNEL = 'fare-state';

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface BrowserStore extends StateStore {
  read(): Promise<SdkState>;
  update<T>(fn: (s: SdkState) => T): Promise<Updated<T>>;
  /** Calls `cb` when another tab changed the state. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
}

function channel(): BroadcastChannel | undefined {
  return typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
}

export function idbStore(idb: IDBFactory = indexedDB): BrowserStore {
  const bus = channel();
  return {
    async read() {
      const db = await open(idb);
      try {
        return await new Promise<SdkState>((resolve, reject) => {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
          req.onsuccess = () => resolve(normalize(req.result as SdkState | undefined));
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    },
    async update<T>(fn: (s: SdkState) => T): Promise<Updated<T>> {
      const db = await open(idb);
      try {
        const done = await new Promise<Updated<T>>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const os = tx.objectStore(STORE);
          let out: Updated<T> | undefined;
          // fn runs synchronously inside the transaction, between the read and the write.
          const req = os.get(KEY);
          req.onsuccess = () => {
            try {
              const state = normalize(req.result as SdkState | undefined);
              const result = fn(state);
              os.put(state, KEY);
              out = { result, state };
            } catch (e) {
              tx.abort();
              reject(e);
            }
          };
          tx.oncomplete = () => (out ? resolve(out) : reject(new Error('state update did not run')));
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('state update aborted'));
        });
        bus?.postMessage('changed');
        return done;
      } finally {
        db.close();
      }
    },
    onChange(cb) {
      const inbox = channel();
      if (!inbox) return () => undefined;
      inbox.onmessage = () => cb();
      return () => inbox.close();
    },
  };
}

/** For a browser without IndexedDB (a private window may refuse it): state lives in the tab. */
export function memoryStore(): BrowserStore {
  const inner = memoryStateStore();
  return {
    read: async () => inner.read(),
    update: async (fn) => inner.update(fn),
    onChange: () => () => undefined,
  };
}
