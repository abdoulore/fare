# Deploying Fare on one VPS

Owner decision D2 (Oct 24): the whole hosted demo runs on one small Linux server behind Caddy.

```
                 https://DOMAIN          static web/ build (Caddy file_server)
browser  ──────► https://issuer.DOMAIN   ─► 127.0.0.1:8787  issuer
                 https://api.DOMAIN      ─► 127.0.0.1:8080  demo API + origin
                 https://payer.DOMAIN    ─► 127.0.0.1:8791  demo payer (fare-wallet)
                                            127.0.0.1:7077  fare-scanner serve (never public)
                                            127.0.0.1:8790  operator panel (never public)
```

Every service listens on loopback. Only Caddy is reachable from outside. Caddy keeps no access log.

## What you need

- A Debian 12 or Ubuntu 24.04 server with 2 GB of memory or more (the Rust build needs it), ports 80 and 443 open, and outbound access to `testnet.zec.rocks:443`.
- A domain with four DNS records pointing at it: `DOMAIN`, `api.DOMAIN`, `issuer.DOMAIN`, `payer.DOMAIN`. **DNS only, no CDN proxy** (in Cloudflare: grey cloud). A proxy that terminates TLS would see purchase ids and tokens in plaintext, each with the visitor's IP, and could link them; Cloudflare's proxy also adds a NEL header that makes browsers report to a third party (owner decision, Oct 24). Caddy gets its own certificates.
- The merchant's full viewing key (the `FARE_TESTNET_UFVK` repository secret).
- The demo payer's testnet seed phrase (the `FARE_PAYER_SEED` secret). Testnet only.
- Optional: an `ANTHROPIC_API_KEY` for real answers. Without one, every answer says "simulated".

## First run

```
git clone https://github.com/abdoulore/fare.git && cd fare
sudo install -d -m 0755 /etc/fare
sudo cp deploy/site.env.example /etc/fare/site.env      # set FARE_DOMAIN, FARE_ACME_EMAIL
sudo cp deploy/payer.env.example /etc/fare/payer.env    # set FARE_PAYER_SEED
sudo cp deploy/api.env.example /etc/fare/api.env        # optional: ANTHROPIC_API_KEY
sudo FARE_TESTNET_UFVK=uviewtest1... ./deploy/setup.sh main
```

The script installs Node 22, Rust and Caddy, builds everything, creates the scanner state from the viewing key (birthday 4,535,550) and the payer wallet (birthday 4,533,526), installs the systemd units and starts them. The scanner mints nothing until its first scan finishes; that scan sees the payments at +0 to +6 from earlier runs and starts new purchases at +7, so no address is reused.

## Updates

```
sudo ./deploy/setup.sh main
```

It pulls, rebuilds and restarts. It never re-creates the scanner state or the wallet.

## Checking it

```
curl https://issuer.DOMAIN/health     # key id, epoch, scanner height
curl https://api.DOMAIN/health        # model: real or simulated
curl https://payer.DOMAIN/health      # demo payer balance; empty: true when it cannot pay a pack
journalctl -u fare-scanner -f         # scan progress; nothing about requests is logged
ssh -L 8790:127.0.0.1:8790 HOST       # then open http://127.0.0.1:8790/panel for the operator panel
```

## Where secrets live

| What | Where | Read by |
| --- | --- | --- |
| Merchant full viewing key | `/var/lib/fare/scanner/state.json` (0700 directory) | the scanner |
| Payer seed (testnet) | `/etc/fare/payer.env` (0600) | the payer, and `setup.sh` once for `fare-wallet init` |
| Model API key | `/etc/fare/api.env` (0600) | the API |
| Issuer signing keys | `/var/lib/fare/issuer/keys` | the issuer |

No secret goes into the web build. The page bundle holds only the three public service URLs.

## Demo payer limits

Testnet URIs at the pack price only, in full or half; each address once; 5 packs an hour in total and 2 per visitor; one payment at a time. When its balance drops below one pack it reports itself empty and the page says so. Top it up by sending TAZ to the address `fare-wallet address` prints:

```
sudo -u fare sh -c 'set -a; . /etc/fare/payer.env; /opt/fare/bin/fare-wallet --dir /var/lib/fare/wallet address'
```
