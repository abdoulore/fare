// Static build. Every asset, font included, is served from this origin (invariant 12).
// The Content-Security-Policy names this origin plus the API, issuer and payer URLs
// given at build time, and nothing else. frame-ancestors only works as a response header,
// so the server sets it (deploy/Caddyfile), not this meta tag.

import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function originOf(url: string): string {
  return new URL(url).origin;
}

/** The CSP for the built page, from the configured service URLs. */
export function csp(env: Record<string, string>): string {
  const connect = [env.VITE_API_URL, env.VITE_ISSUER_URL, env.VITE_PAYER_URL].filter(Boolean).map(originOf);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self'",
    `connect-src 'self' ${[...new Set(connect)].join(' ')}`.trim(),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function cspMeta(env: Record<string, string>): Plugin {
  return {
    name: 'fare-csp',
    transformIndexHtml: (html) => html.replace('%FARE_CSP%', csp(env)),
  };
}

export default defineConfig(({ mode }) => {
  const env: Record<string, string> = { VITE_API_URL: 'http://127.0.0.1:8080', VITE_ISSUER_URL: 'http://127.0.0.1:8787', VITE_PAYER_URL: 'http://127.0.0.1:8791', ...loadEnv(mode, process.cwd(), 'VITE_') };
  return {
    plugins: [react(), cspMeta(env)],
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
      'import.meta.env.VITE_ISSUER_URL': JSON.stringify(env.VITE_ISSUER_URL),
      'import.meta.env.VITE_PAYER_URL': JSON.stringify(env.VITE_PAYER_URL),
      'import.meta.env.VITE_EXPLORER_TX': JSON.stringify(env.VITE_EXPLORER_TX ?? ''),
    },
    resolve: {
      // sdk/src/core.ts lives outside this package; give it this package's copy.
      alias: { '@cloudflare/privacypass-ts': here('./node_modules/@cloudflare/privacypass-ts') },
    },
    server: { host: '127.0.0.1', port: 5173, fs: { allow: [here('..')] } },
    preview: { host: '127.0.0.1', port: 4173 },
    build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false },
    test: {
      include: ['test/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  };
});
