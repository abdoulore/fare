// Service URLs, fixed at build time. The CSP allows exactly these.

const strip = (u: string) => u.replace(/\/+$/, '');

export const API_URL = strip(import.meta.env.VITE_API_URL as string);
export const ISSUER_URL = strip(import.meta.env.VITE_ISSUER_URL as string);
export const PAYER_URL = strip(import.meta.env.VITE_PAYER_URL as string);
/** Prefix a txid is appended to for an explorer link; empty for none. */
export const EXPLORER_TX = import.meta.env.VITE_EXPLORER_TX as string;

/** Locked decisions (owner, Oct 24): mirrored from issuer/src/config.ts for display. */
export const EPOCH_SECONDS = 7 * 24 * 60 * 60;
export const GRACE_SECONDS = 24 * 60 * 60;
