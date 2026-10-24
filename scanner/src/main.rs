use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};

use fare_scanner::keys::{self, PURCHASE_INDEX_BASE};
use fare_scanner::lwd;
use fare_scanner::scan::Detector;
use fare_scanner::store::{self, Merchant, Purchase, State, Status};
use fare_scanner::zec::{format_zec, parse_zec};

#[derive(Parser)]
#[command(name = "fare-scanner", about = "Mint per-purchase shielded addresses and detect payments to them from compact blocks alone.")]
struct Cli {
    /// Directory holding state.json (and, after init, the seed file to move offline).
    #[arg(long, global = true, default_value = "fare-data")]
    dir: PathBuf,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a merchant. Generates a fresh seed unless --ufvk is given.
    Init {
        #[arg(long, default_value = "main")]
        network: String,
        /// lightwalletd URL. Defaults to testnet.zec.rocks on testnet, CipherScan on mainnet.
        #[arg(long)]
        server: Option<String>,
        /// Use an existing unified full viewing key instead of generating a seed.
        #[arg(long)]
        ufvk: Option<String>,
        /// Height to start scanning from. Defaults to the current chain tip.
        #[arg(long)]
        birthday: Option<u64>,
        /// Confirmations before a payment counts.
        #[arg(long, default_value_t = 1)]
        confirmations: u64,
    },
    /// Mint a fresh shielded-only address for one purchase and print its payment URI.
    Mint {
        /// Price in ZEC, e.g. 0.001
        #[arg(long)]
        zec: String,
        #[arg(long)]
        label: Option<String>,
    },
    /// Scan compact blocks (and optionally the mempool) and attribute payments.
    Scan {
        /// Start height. Defaults to the earliest purchase's creation height.
        #[arg(long)]
        from: Option<u64>,
        /// Also read the mempool, to show payments before they are mined.
        #[arg(long)]
        mempool: bool,
        /// Ask the server for transparent inputs too, to flag payments funded from them.
        #[arg(long)]
        check_transparent: bool,
    },
    /// Show purchases and their status as of the last scan. No network access.
    Status,
    /// Exit non-zero unless the labelled purchases have the expected status as of the
    /// last scan. No network access.
    Check {
        /// Label of a purchase that must be paid. Repeatable.
        #[arg(long)]
        paid: Vec<String>,
        /// Label of a purchase that must be underpaid. Repeatable.
        #[arg(long)]
        underpaid: Vec<String>,
    },
    /// Print the unified incoming viewing key to publish for the demo account.
    ViewingKey,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Init { network, server, ufvk, birthday, confirmations } => {
            init(&cli.dir, &network, server, ufvk, birthday, confirmations).await
        }
        Cmd::Mint { zec, label } => mint(&cli.dir, &zec, label).await,
        Cmd::Scan { from, mempool, check_transparent } => scan(&cli.dir, from, mempool, check_transparent).await,
        Cmd::Status => {
            let state = store::load(&cli.dir)?;
            let tip = state.last_scanned_height.unwrap_or(0);
            print_status(&state, tip);
            Ok(())
        }
        Cmd::Check { paid, underpaid } => {
            let state = store::load(&cli.dir)?;
            for line in state.check(&paid, &underpaid)? {
                println!("{line}");
            }
            println!("CHECK PASS");
            Ok(())
        }
        Cmd::ViewingKey => {
            let state = store::load(&cli.dir)?;
            let net = keys::parse_network(&state.merchant.network)?;
            let ufvk = keys::decode_ufvk(&net, &state.merchant.ufvk)?;
            println!("{}", keys::encode_uivk(&net, &ufvk)?);
            eprintln!();
            eprintln!("This key reveals every incoming payment to this account: amount, height, address index.");
            eprintln!("It cannot spend, and it reveals nothing about tokens or API calls.");
            eprintln!("Publish it for the demo account only, never for a merchant's real wallet.");
            Ok(())
        }
    }
}

async fn init(
    dir: &Path,
    network: &str,
    server: Option<String>,
    ufvk_arg: Option<String>,
    birthday: Option<u64>,
    confirmations: u64,
) -> Result<()> {
    let net = keys::parse_network(network)?;
    let net_name = keys::network_name(&net);
    let server = server.unwrap_or_else(|| lwd::default_server(net_name).to_owned());
    if store::state_path(dir).exists() {
        bail!("a merchant already exists in {}", dir.display());
    }

    let birthday = match birthday {
        Some(h) => h,
        None => {
            let mut client = lwd::connect(&server)
                .await
                .context("pass --birthday <height> if the server is unreachable")?;
            lwd::tip(&mut client).await?
        }
    };

    let (ufvk, seed_file) = match ufvk_arg {
        Some(s) => (keys::decode_ufvk(&net, &s)?, None),
        None => {
            let mnemonic = keys::generate_mnemonic()?;
            let seed = mnemonic.to_seed("");
            let ufvk = keys::ufvk_from_seed(&net, &seed)?;
            let path = store::write_seed(dir, mnemonic.phrase())?;
            (ufvk, Some(path))
        }
    };
    keys::viewing_keys(&ufvk)?;

    let state = State::new(Merchant {
        network: net_name.to_owned(),
        server: server.clone(),
        ufvk: ufvk.encode(&net).map_err(|e| anyhow!("cannot encode viewing key: {e:?}"))?,
        birthday_height: birthday,
        next_index: PURCHASE_INDEX_BASE,
        required_confirmations: confirmations.max(1),
    });
    store::create(dir, &state)?;

    println!("Merchant created in {}", dir.display());
    println!("  network        {net_name}");
    println!("  server         {server}");
    println!("  birthday       {birthday}");
    println!("  confirmations  {}", confirmations.max(1));
    if let Some(path) = seed_file {
        println!();
        println!("Seed phrase written to {}", path.display());
        println!("Move it offline now. Restore it in a wallet to spend what Fare receives.");
        println!("The scanner never reads it again; it runs on the viewing key in state.json.");
    }
    Ok(())
}

async fn mint(dir: &Path, zec: &str, label: Option<String>) -> Result<()> {
    let price = parse_zec(zec)?;
    let mut state = store::load(dir)?;
    let net = keys::parse_network(&state.merchant.network)?;
    let ufvk = keys::decode_ufvk(&net, &state.merchant.ufvk)?;
    let vk = keys::viewing_keys(&ufvk)?;

    let created_height = match lwd::connect(&state.merchant.server).await {
        Ok(mut c) => lwd::tip(&mut c).await?,
        Err(e) => {
            let fallback = state.last_scanned_height.unwrap_or(state.merchant.birthday_height);
            eprintln!("warning: {e:#}; recording creation height {fallback} instead");
            fallback
        }
    };

    let index = state.allocate_index();
    let address = keys::encode_shielded_only(&net, keys::purchase_address(&vk.ivk, index))?;
    let pay_uri = format!("zcash:{address}?amount={}", format_zec(price));
    let id = random_id()?;
    state.purchases.push(Purchase {
        id: id.clone(),
        index,
        price_zat: price,
        address: address.clone(),
        pay_uri: pay_uri.clone(),
        label,
        created_unix: now_unix(),
        created_height,
        payments: Vec::new(),
    });
    store::save(dir, &state)?;

    println!("Purchase {id}");
    println!("  price     {} ZEC", format_zec(price));
    println!("  index     base+{}", index - PURCHASE_INDEX_BASE);
    println!("  address   {address}");
    println!("  pay URI   {pay_uri}");
    println!();
    println!("Pay it from a shielded balance, then run `fare-scanner scan`.");
    Ok(())
}

async fn scan(dir: &Path, from: Option<u64>, mempool: bool, check_transparent: bool) -> Result<()> {
    let mut state = store::load(dir)?;
    let net = keys::parse_network(&state.merchant.network)?;
    let ufvk = keys::decode_ufvk(&net, &state.merchant.ufvk)?;
    let detector = Detector::new(keys::viewing_keys(&ufvk)?.ivk);

    let mut client = lwd::connect(&state.merchant.server).await?;
    let tip = lwd::tip(&mut client).await?;
    let start = from.unwrap_or_else(|| state.scan_start());
    if start > tip {
        bail!("start height {start} is above the chain tip {tip}");
    }

    let mut with_transparent = check_transparent;
    let mut stream = match lwd::blocks(&mut client, start, tip, with_transparent).await {
        Ok(s) => s,
        Err(e) if with_transparent => {
            eprintln!("warning: server refused transparent data ({e:#}); scanning shielded pools only");
            with_transparent = false;
            lwd::blocks(&mut client, start, tip, false).await?
        }
        Err(e) => return Err(e),
    };

    let mut blocks = 0u64;
    let mut ironwood_actions = 0usize;
    let mut found = Vec::new();
    while let Some(block) = stream.message().await.context("block stream")? {
        blocks += 1;
        ironwood_actions += block.vtx.iter().map(|t| t.ironwood_actions.len()).sum::<usize>();
        found.extend(detector.scan_block(&block));
    }
    let mined = state.apply(&found);

    let mut seen = store::Applied::default();
    if mempool {
        let mut txs = lwd::mempool(&mut client, with_transparent).await?;
        let mut pending = Vec::new();
        while let Some(tx) = txs.message().await.context("mempool stream")? {
            pending.extend(detector.scan_tx(&tx, None));
        }
        seen = state.apply(&pending);
    }

    state.last_scanned_height = Some(tip);
    store::save(dir, &state)?;

    println!(
        "Scanned blocks {start}..={tip} ({blocks} blocks, {ironwood_actions} Ironwood actions){}",
        if with_transparent { ", transparent inputs checked" } else { "" }
    );
    println!(
        "Detected {} mined and {} mempool notes for this key ({} unattributed).",
        mined.attributed + mined.unattributed,
        seen.attributed + seen.unattributed,
        mined.unattributed + seen.unattributed
    );
    println!("Requests made: latest height, one block range{}. No transaction lookups.", if mempool { ", one mempool snapshot" } else { "" });
    println!();
    print_status(&state, tip);
    print_canary(&state, tip);
    Ok(())
}

fn print_status(state: &State, tip: u64) {
    let req = state.merchant.required_confirmations;
    if state.purchases.is_empty() {
        println!("No purchases yet. Run `fare-scanner mint --zec 0.001`.");
        return;
    }
    println!("{:<18} {:<8} {:>12} {:>12}  STATUS", "PURCHASE", "INDEX", "PRICE", "RECEIVED");
    for p in &state.purchases {
        let mut status = p.status(tip, req).label();
        if p.leaky_funding() {
            status.push_str("  [funded from transparent inputs]");
        }
        println!(
            "{:<18} {:<8} {:>12} {:>12}  {}",
            p.id,
            format!("+{}", p.index - PURCHASE_INDEX_BASE),
            format_zec(p.price_zat),
            if p.received_zat() == 0 { "-".to_string() } else { format_zec(p.received_zat()) },
            status
        );
        for pay in &p.payments {
            let at = match pay.height {
                Some(h) => format!("height {h}, {} conf", store::confirmations(h, tip)),
                None => "mempool".to_string(),
            };
            println!("    {} ZEC  {:?}  {}  {}", format_zec(pay.value_zat), pay.pool, at, pay.txid);
        }
    }
    if !state.unattributed.is_empty() {
        println!();
        println!("{} payment(s) to this key at non-purchase addresses (never issue tokens).", state.unattributed.len());
    }
}

fn print_canary(state: &State, tip: u64) {
    let req = state.merchant.required_confirmations;
    for p in &state.purchases {
        if let Status::Paid { .. } = p.status(tip, req) {
            if let Some(pay) = p.payments.iter().find(|x| x.height.is_some()) {
                println!();
                println!(
                    "CANARY PASS  purchase {} paid by tx {} at height {}, matched by diversifier index base+{} from compact blocks only.",
                    p.id,
                    pay.txid,
                    pay.height.unwrap_or_default(),
                    p.index - PURCHASE_INDEX_BASE
                );
            }
        }
    }
}

fn random_id() -> Result<String> {
    let mut b = [0u8; 8];
    getrandom::fill(&mut b).map_err(|e| anyhow!("no OS randomness: {e}"))?;
    Ok(hex::encode(b))
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
