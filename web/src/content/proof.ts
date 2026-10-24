// The testnet proof, as in README.md. Every row is a real testnet transaction to the demo
// merchant, visible with the published incoming viewing key.

export const UIVK =
  'uivktest160nugcs8fnvmx98nuqy982yadezp0uk8h8chq47uq74q3rqgynurv0tfc77vvsmn38f6nn25mtnyq0rkvjamsujht3yacjp8uvtacatxwgatjy54f3g4el376ur2t7f55d4f5dhjxmalvay2xvh4ycfgz032z692hgcenqa9wn5ua5van6n9xqguutnsurjccpsmstrnd3xcjvwxtnnqv7wa5y060rcg7e3h2wt7ycrskv4nt2a';

const RUN = 'https://github.com/abdoulore/fare/actions/runs/';

export interface ProofRow {
  index: number;
  amount: string;
  height: string;
  txid: string;
  shows: string;
  run: string;
  runLabel: string;
}

export const PROOF: ProofRow[] = [
  { index: 0, amount: '0.001', height: '4,535,557', txid: 'fd1e9ee3f90c0e3bd8bf874e86352ab8fb085158190c5242a27e0afa623af9d9', shows: 'Canary: paid, matched by index', run: `${RUN}40084407257`, runLabel: 'canary' },
  { index: 1, amount: '0.0005', height: '4,535,562', txid: '0346de58cdaa73d7285e7e91448effa2c437978b44cfdf1bc72a4cf9b866652b', shows: 'Canary: underpaid, stays underpaid', run: `${RUN}40084407257`, runLabel: 'canary' },
  { index: 2, amount: '0.001', height: '4,535,836', txid: '9a6e1bf355929f15ccf13035d00c8e6dea01e56145d6ea4dbb068d71bdb24740', shows: 'Minted over HTTP by serve: pending, in mempool, paid', run: `${RUN}40091932215`, runLabel: 'serve' },
  { index: 3, amount: '0.001', height: '4,535,984', txid: '2e97c74b44bce98c4b6707928c78df62e6b630b042146b824dea833b964ae5b8', shows: 'Whole stack: 402, pay, 100 tokens, 5 calls, replay refused', run: `${RUN}40096150452`, runLabel: 'demo' },
  { index: 4, amount: '0.001', height: '4,536,048', txid: 'b01a1fc002e2ff71a6b8438b5f403eda48bdd948a9936b0f01d6e819dc7fa4df', shows: 'Paid: 100 tokens, a call succeeds', run: `${RUN}40098320054`, runLabel: 'failure paths' },
  { index: 5, amount: '0.0005', height: '4,536,052', txid: '0c3e538be90d9a5bfa60463314a6cd2dd06a092a62486c8dd0f9f39a7a26058d', shows: 'Underpaid: no signatures issued', run: `${RUN}40098320054`, runLabel: 'failure paths' },
  { index: 6, amount: '0.001', height: '4,536,054', txid: '60d3f691c7b71deb4f7eb890f3e2967971c78ced8cf287d62b1d271c7b30ebf3', shows: 'Second payment, first of two', run: `${RUN}40098320054`, runLabel: 'failure paths' },
  { index: 6, amount: '0.001', height: '4,536,061', txid: 'd3529ffb9e1cedcc2cdc0bdb3216de385a0e255db60912ef31d6b700532ba652', shows: 'Second payment: still exactly 100 tokens', run: `${RUN}40098320054`, runLabel: 'failure paths' },
];

export const CHECK_COMMANDS = `cd scanner && cargo build --release
./target/release/fare-scanner --dir verify init --network test --uivk <key above> --birthday 4535550
./target/release/fare-scanner --dir verify scan --from 4535550 --check-transparent
./target/release/fare-scanner --dir verify status`;
