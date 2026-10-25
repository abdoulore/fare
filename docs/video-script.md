# Fare: 3-minute demo video script

Everything on screen is real testnet. Answers are simulated unless the host has a model key: leave the "simulated" label visible and say it once.

## Before recording

- Rerun `sudo ./deploy/setup.sh main` so the site has the latest copy.
- Check the demo payer has at least two packs (footer: `demo payer 0.99 TAZ`; it allows 2 packs per visitor an hour).
- Use a fresh browser profile (no stored tokens). Window about 1280 px wide. Light or dark scheme both work.
- Open a terminal on the server (it can reach `testnet.zec.rocks`) for the last scene.
- Waiting for one confirmation takes about 75 s per payment. Record straight through, then cut the waits down.

## Script

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | https://fare.moonrider.online home: the vermilion sheet, the headline, the stamp with the middleware and its live postmark | "Fare lets an API charge per call and never learn who paid. The postmark on this stamp is a live check: the hosted API answered 402, and its key matches the published directory. This is Zcash testnet." |
| 0:15 | Scroll to "One sheet, torn in two" | "The issuer sees purchases. The API sees calls. Nothing runs between them." |
| 0:22 | Click **Try it with a demo payment** (to `/app`). Click **Ask without a token**. The 402 panel: offer, key, "key matches the published directory" | "As a buyer: the API asks for payment, 100 calls for 0.001 TAZ. My browser checks the issuer key before doing anything." |
| 0:35 | Click **Buy 100 calls**. "blinded 100 of 100 in this browser". The fresh address | "My browser blinds 100 tokens and orders a sheet. Fare mints a fresh shielded address for this purchase alone. No memo, no account." |
| 0:48 | Click **Pay 0.001 TAZ with the demo payer**. The txid appears | "Fare's demo wallet pays, so anyone can try this. In real use you pay from your own wallet, and Fare never sees it." |
| 0:58 | Wait step: pending, mempool, confirming, paid (cut the wait). The receipt and "Your sheet" at 100 | "The scanner holds only a viewing key and spots the payment by address. One confirmation, then the issuer signs my blinded requests without seeing them: 100 stamps, in this browser." |
| 1:13 | Click **Ask with one token** three times. One stamp struck per call. Answers marked "simulated" | "Each call cancels one stamp. No model key on this host, so the answers are simulated, and say so." |
| 1:27 | Click **Replay my last token**. The red "already cancelled" postmark: 401 token_reused | "A replay hits a stamp that is already cancelled. Refused." |
| 1:35 | Open **Test the refusals**, start a new purchase (**Buy another sheet**), then **Pay half (shows underpaid)**. Wait ends at "postage due", "No tokens from this purchase" (cut the wait) | "Underpay by half: it is mined, the scanner sees it is short, postage due. The issuer signs nothing." |
| 1:55 | `/proof`, live ledger: purchases on the left, the "no link" perforation, calls on the right, the pane of stamps | "Here is what the servers see. Purchases by index, amount and height. Calls as counts. The perforation in the middle is empty on purpose: blind signatures keep a token from being matched to its purchase." |
| 2:15 | Point at the pane, then "What Fare does not hide" | "A token hides among every stamp under this key. What Fare does not hide is listed: IP and timing, a small set, the question itself." |
| 2:27 | Terminal: the watch-only verifier with the published key (`init --uivk`, `scan`, `status`) | "Anyone can check the payments: with only the published viewing key, this verifier lists every payment to the demo merchant by index." |
| 2:42 | `/proof`, click a txid: the explorer page, a fee and two encrypted actions | "On a public explorer each payment is a fee and encrypted actions. Paid or underpaid, they look the same." |
| 2:50 | `/developers`, the quick start | "And to charge for your own API: wrap your handler, run the issuer and the scanner." |
| 2:57 | Home | "Fare. Charge per call, never learn who paid." |

## Commands for the verifier scene

```
cd /opt/fare/src/scanner
/opt/fare/bin/fare-scanner --dir /tmp/verify init --network test --uivk uivktest160nugcs8fnvmx98nuqy982yadezp0uk8h8chq47uq74q3rqgynurv0tfc77vvsmn38f6nn25mtnyq0rkvjamsujht3yacjp8uvtacatxwgatjy54f3g4el376ur2t7f55d4f5dhjxmalvay2xvh4ycfgz032z692hgcenqa9wn5ua5van6n9xqguutnsurjccpsmstrnd3xcjvwxtnnqv7wa5y060rcg7e3h2wt7ycrskv4nt2a --birthday 4535550
/opt/fare/bin/fare-scanner --dir /tmp/verify scan --from 4535550 --check-transparent
/opt/fare/bin/fare-scanner --dir /tmp/verify status
```

The scan takes a short while; run it before recording and show `status`, or cut. `init` prints "watch-only", worth keeping on screen.
