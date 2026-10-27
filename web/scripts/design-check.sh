#!/usr/bin/env bash
# Dev-time design check with impeccable (telemetry off). Never shipped:
# impeccable is a devDependency and nothing from it reaches the built site.
#
# Scans the source, then /, /app, /developers and /proof rendered on the local e2e stack, at desktop
# and phone width. Waivers live in .impeccable/config.json, each with a reason.
#
#   npm run design:check
#
# IMPECCABLE_BROWSER may point at a Chromium; otherwise impeccable finds an installed one.

set -euo pipefail
cd "$(dirname "$0")/.."
export IMPECCABLE_NO_TELEMETRY=1

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

if ! curl -sf -o /dev/null http://127.0.0.1:18787/health; then
  node e2e/stack.ts > /dev/null 2>&1 & pids+=($!)
fi
if ! curl -sf -o /dev/null http://127.0.0.1:4173/; then
  VITE_API_URL=http://127.0.0.1:18080 VITE_ISSUER_URL=http://127.0.0.1:18787 VITE_PAYER_URL=http://127.0.0.1:18791 npx vite build --logLevel error
  npx vite preview --strictPort > /dev/null 2>&1 & pids+=($!)
fi
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:18787/health && curl -sf -o /dev/null http://127.0.0.1:4173/ && break
  sleep 1
done

status=0
npx impeccable detect src/ index.html || status=$?
for viewport in 1280x800 375x740; do
  npx impeccable detect --viewport "$viewport" http://127.0.0.1:4173/ http://127.0.0.1:4173/app http://127.0.0.1:4173/developers http://127.0.0.1:4173/proof || status=$?
done
exit "$status"
