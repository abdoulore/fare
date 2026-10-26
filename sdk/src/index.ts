// Fare client SDK for Node: the browser-safe core (core.ts) with its state in a JSON file
// written with mode 0600. See core.ts for the flow.
//
// Each update re-reads the file, applies the change and writes it back (temp file and
// rename), synchronously, so changes made by this process never interleave. Two
// processes sharing one state file are not supported.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { FareCore, normalize, type CoreOptions, type SdkState, type Updated, type WWWAuthenticateHeader } from './core.ts';

export * from './core.ts';

export interface FareOptions extends CoreOptions {
  /** JSON file for the pin, unspent tokens and saved orders. Written with mode 0600. */
  stateFile: string;
}

/** A StateStore in a JSON file, synchronous. */
export function fileStateStore(stateFile: string): { read(): SdkState; update<T>(fn: (s: SdkState) => T): Updated<T> } {
  const read = (): SdkState => normalize(existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as SdkState) : undefined);
  return {
    read,
    update(fn) {
      const state = read();
      const result = fn(state);
      const tmp = `${stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      renameSync(tmp, stateFile);
      return { result, state };
    },
  };
}

export class FareClient extends FareCore {
  constructor(opts: FareOptions) {
    const store = fileStateStore(opts.stateFile);
    super(opts, store, store.read());
  }

  /** Removes one token for `challenge` from the file and returns its Authorization header. */
  override spend(challenge: WWWAuthenticateHeader): string | undefined {
    return super.spend(challenge) as string | undefined;
  }
}
