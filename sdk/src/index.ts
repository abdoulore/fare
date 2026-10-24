// Fare client SDK for Node: the browser-safe core (core.ts) with its state in a JSON file
// written with mode 0600. See core.ts for the flow.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { FareCore, type CoreOptions, type SdkState, type WWWAuthenticateHeader } from './core.ts';

export * from './core.ts';

export interface FareOptions extends CoreOptions {
  /** JSON file for the pin and unspent tokens. Written with mode 0600. */
  stateFile: string;
}

export class FareClient extends FareCore {
  private readonly stateFile: string;

  constructor(opts: FareOptions) {
    super(opts, existsSync(opts.stateFile) ? (JSON.parse(readFileSync(opts.stateFile, 'utf8')) as SdkState) : { tokens: [] });
    this.stateFile = opts.stateFile;
  }

  protected persist(): void {
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(tmp, this.stateFile);
  }

  /** Removes one token for `challenge` from the file and returns its Authorization header. */
  override spend(challenge: WWWAuthenticateHeader): string | undefined {
    const auth = this.take(challenge);
    this.persist();
    return auth;
  }
}
