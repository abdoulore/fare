#!/usr/bin/env bash
# Sets up or updates Fare on one Debian or Ubuntu VPS (owner decision D2). Run as root:
#
#   FARE_TESTNET_UFVK=uviewtest1... ./deploy/setup.sh [git-ref]
#
# FARE_TESTNET_UFVK is needed only the first time, to create the scanner's state. Before
# the first run, fill in /etc/fare/site.env, /etc/fare/payer.env and, optionally,
# /etc/fare/api.env from the *.example files next to this script.
#
# Safe to run again: it pulls, rebuilds and restarts, and never re-creates the scanner
# state or the payer wallet (a fresh scanner state would forget which indexes it used).

set -euo pipefail

REF="${1:-main}"
REPO="https://github.com/abdoulore/fare.git"
MERCHANT_BIRTHDAY=4535550   # before the first purchase to the demo merchant (+0)
PAYER_BIRTHDAY=4533526      # the demo payer's wallet birthday

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
for f in /etc/fare/site.env /etc/fare/payer.env; do
  [ -f "$f" ] || { echo "missing $f (see deploy/*.example)"; exit 1; }
done
# shellcheck disable=SC1091
. /etc/fare/site.env
[ -n "${FARE_DOMAIN:-}" ] || { echo "FARE_DOMAIN is empty in /etc/fare/site.env"; exit 1; }

echo "== packages"
apt-get update -q
apt-get install -yq git curl build-essential pkg-config ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi
if [ ! -x /root/.cargo/bin/cargo ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="/root/.cargo/bin:$PATH"

echo "== user and directories"
id fare >/dev/null 2>&1 || useradd --system --home /var/lib/fare --shell /usr/sbin/nologin fare
install -d -o fare -g fare -m 0700 /var/lib/fare /var/lib/fare/scanner /var/lib/fare/issuer /var/lib/fare/origin /var/lib/fare/wallet
install -d -m 0755 /opt/fare /opt/fare/bin /srv/fare
chown fare:fare /etc/fare/payer.env && chmod 0600 /etc/fare/payer.env
if [ -f /etc/fare/api.env ]; then chown fare:fare /etc/fare/api.env && chmod 0600 /etc/fare/api.env; fi
# The API's panel reads the issuer's purchase list (loopback only).
chmod 0750 /var/lib/fare/issuer

echo "== source at $REF"
if [ ! -d /opt/fare/src/.git ]; then git clone "$REPO" /opt/fare/src; fi
git -C /opt/fare/src fetch -q origin "$REF"
git -C /opt/fare/src checkout -q --detach FETCH_HEAD
git -C /opt/fare/src log -1 --format='%h %s'

echo "== build"
(cd /opt/fare/src/scanner && cargo build --release --locked -q)
(cd /opt/fare/src/wallet && cargo build --release --locked -q)
install -m 0755 /opt/fare/src/scanner/target/release/fare-scanner /opt/fare/src/wallet/target/release/fare-wallet /opt/fare/bin/
for d in issuer sdk origin demo; do npm ci --prefix "/opt/fare/src/$d" --omit=dev --no-audit --no-fund -s; done
npm ci --prefix /opt/fare/src/web --no-audit --no-fund -s
(cd /opt/fare/src/web && VITE_API_URL="https://api.$FARE_DOMAIN" VITE_ISSUER_URL="https://issuer.$FARE_DOMAIN" VITE_PAYER_URL="https://payer.$FARE_DOMAIN" VITE_EXPLORER_TX="${VITE_EXPLORER_TX:-}" npx vite build --logLevel warn)
rm -rf /srv/fare/web.new && cp -r /opt/fare/src/web/dist /srv/fare/web.new && rm -rf /srv/fare/web && mv /srv/fare/web.new /srv/fare/web

echo "== scanner state (viewing key only)"
if [ ! -f /var/lib/fare/scanner/state.json ]; then
  [ -n "${FARE_TESTNET_UFVK:-}" ] || { echo "first run: set FARE_TESTNET_UFVK"; exit 1; }
  sudo -u fare /opt/fare/bin/fare-scanner --dir /var/lib/fare/scanner init --network test --ufvk "$FARE_TESTNET_UFVK" --birthday "$MERCHANT_BIRTHDAY"
fi

echo "== payer wallet (testnet)"
if [ -z "$(ls -A /var/lib/fare/wallet)" ]; then
  # shellcheck disable=SC1091
  (set -a; . /etc/fare/payer.env; set +a; sudo -E -u fare /opt/fare/bin/fare-wallet --dir /var/lib/fare/wallet init --birthday "$PAYER_BIRTHDAY")
fi

echo "== services"
install -m 0644 /opt/fare/src/deploy/systemd/*.service /etc/systemd/system/
install -d /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/fare/site.env\n' > /etc/systemd/system/caddy.service.d/fare.conf
install -m 0644 /opt/fare/src/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable -q fare-scanner fare-issuer fare-api fare-payer caddy
systemctl restart fare-scanner fare-issuer fare-api fare-payer caddy

echo "== health (the scanner's first scan can take a few minutes)"
sleep 5
for u in "http://127.0.0.1:7077/health" "http://127.0.0.1:8787/health" "http://127.0.0.1:8080/health" "http://127.0.0.1:8791/health"; do
  printf '%s  ' "$u"; curl -fsS "$u" || echo "(not up yet)"; echo
done
echo "Site: https://$FARE_DOMAIN"
