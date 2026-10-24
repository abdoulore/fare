# Fare: 3-minute demo video script

Everything on screen is real testnet. Answers are simulated unless the host has a model key: leave the "simulated" label visible and say it once.

## Before recording

- Rerun `sudo ./deploy/setup.sh main` so the site has the latest copy.
- Check the demo payer has at least two packs (footer: `demo payer 0.99 TAZ`; it allows 2 packs per visitor an hour).
- Use a fresh browser profile (no stored tokens). Window about 1280 px wide.
- Open a terminal on the server (it can reach `testnet.zec.rocks`) for the last scene.
- Waiting for one confirmation takes about 75 s per payment. Record straight through, then cut the waits down.

## Script

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | https://fare.moonrider.online landing page | "Fare lets you pay once in shielded ZEC, then call an API with tokens nobody can link back to you, including us. This is Zcash testnet." |
| 0:12 | `/try`. Type a question, click **Ask without a token**. The 402 panel: offer, key id, "key matches the published directory" | "The API answers 402 Payment Required: 100 calls for 0.001 TAZ. My browser checks the issuer key against the published directory before doing anything." |
| 0:27 | Click **Buy 100 calls**. Progress bar, "blinded 100 of 100 nonces in this browser". The order panel with the fresh address | "My browser blinds 100 tokens and orders a pack. Fare mints a fresh shielded address for this purchase alone. No memo, no account." |
| 0:42 | Click **Pay 0.001 TAZ with the demo payer**. The txid appears | "Fare's demo wallet pays it, so you can try this without a testnet wallet. In real use you pay, and Fare never sees your wallet." |
| 0:52 | The Wait step: pending, in mempool, confirming, paid (cut the wait) | "The scanner holds only a viewing key. It spots the payment in compact blocks by address index: seen in the mempool, then one confirmation. No tokens until then." |
| 1:07 | "100 tokens unblinded in this browser", counter at 100 | "The issuer signed my blinded requests without seeing them. My browser unblinds 100 tokens and keeps them here." |
| 1:15 | Click **Ask with one token** three times. Counter 99, 98, 97. Answers marked "simulated" | "Each call spends one token. No key is set on this host, so the answers are simulated, and they say so." |
| 1:30 | Click **Replay my last token**. Red refusal shakes: 401 token_reused | "Replaying a spent token: refused. Each token works once." |
| 1:38 | Scroll up, **Start a new purchase** or reload `/try`. Ask, **Buy 100 calls**, then **Pay half (shows underpaid)**. Wait step ends at "underpaid", "No tokens" (cut the wait) | "Now underpay: half the price. It is mined, the scanner sees it is short, and the issuer signs nothing." |
| 2:00 | `/server`. Issuer table on the left with +N paid and +N+1 underpaid, the empty "no link" column, API counts on the right, the dot grid | "This is what the server sees. Left, purchases: index, amount, height, status. Right, calls: counts only. The middle column is empty on purpose: no shared id, and blind signatures keep a token from being matched to its purchase." |
| 2:20 | Point at the dots, then the residuals list | "My tokens hide among every token under this key: these dots. What Fare does not hide is listed right here: IP and timing, a small set, the question itself." |
| 2:32 | Terminal: `fare-scanner --dir verify init --network test --uivk <published key> --birthday 4535550`, then `scan --from 4535550`, then `status` | "Anyone can check the payments. With only the published viewing key, no seed, this verifier scans the chain and lists every payment to the demo merchant by index: the paid one, the underpaid one, and earlier runs." |
| 2:50 | `/proof`, click one txid, the explorer page: fee, 2 Ironwood actions, nothing else | "On a public explorer, each payment is just a fee and encrypted actions. Paid or underpaid, they look the same." |
| 2:58 | Landing page | "Fare. Pay once, call privately." |

## Commands for the verifier scene

```
cd /opt/fare/src/scanner
/opt/fare/bin/fare-scanner --dir /tmp/verify init --network test --uivk uivktest160nugcs8fnvmx98nuqy982yadezp0uk8h8chq47uq74q3rqgynurv0tfc77vvsmn38f6nn25mtnyq0rkvjamsujht3yacjp8uvtacatxwgatjy54f3g4el376ur2t7f55d4f5dhjxmalvay2xvh4ycfgz032z692hgcenqa9wn5ua5van6n9xqguutnsurjccpsmstrnd3xcjvwxtnnqv7wa5y060rcg7e3h2wt7ycrskv4nt2a --birthday 4535550
/opt/fare/bin/fare-scanner --dir /tmp/verify scan --from 4535550 --check-transparent
/opt/fare/bin/fare-scanner --dir /tmp/verify status
```

The scan takes a short while; run it before recording and show `status`, or cut. `init` prints "watch-only", worth keeping on screen.
