use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};

use fare_scanner::keys::{self, PURCHASE_INDEX_BASE};
use fare_scanner::lwd;
use fare_scanner::http;
use fare_scanner::service;
use fare_scanner::store::{self, Merchant, State, Status};
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
    /// Create a merchant. Generates a fresh seed unless --ufvk or --uivk is given.
    Init {
        #[arg(long, default_value = "main")]
        network: String,
        /// lightwalletd URL. Defaults to testnet.zec.rocks on testnet, CipherScan on mainnet.
        #[arg(long)]
        server: Option<String>,
        /// Use an existing unified full viewing key instead of generating a seed.
        #[arg(long, conflicts_with = "uivk")]
        ufvk: Option<String>,
        /// Watch-only: verify payments with a published unified incoming viewing key.
        /// Mints nothing; payments show by diversifier index.
        #[arg(long)]
        uivk: Option<String>,
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
    /// Run the issuer's sidecar: mint and status over loopback HTTP, with a follow loop
    /// that scans from a saved cursor and rescans recent blocks for reorgs.
    Serve {
        /// Loopback address to listen on.
        #[arg(long, default_value = "127.0.0.1:7077")]
        listen: SocketAddr,
        /// Seconds between scans.
        #[arg(long, default_value_t = 15)]
        interval: u64,
        /// Blocks below the cursor scanned again on every pass.
        #[arg(long, default_value_t = 10)]
        reorg_depth: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Init { network, server, ufvk, uivk, birthday, confirmations } => {
            init(&cli.dir, &network, server, ufvk, uivk, birthday, confirmations).await
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
        Cmd::Serve { listen, interval, reorg_depth } => serve(&cli.dir, listen, interval, reorg_depth).await,
        Cmd::ViewingKey => {
            let state = store::load(&cli.dir)?;
            let net = keys::parse_network(&state.merchant.network)?;
            if keys::is_watch_only(&net, &state.merchant.ufvk) {
                println!("{}", state.merchant.ufvk);
            } else {
                let ufvk = keys::decode_ufvk(&net, &state.merchant.ufvk)?;
                println!("{}", keys::encode_uivk(&net, &ufvk)?);
            }
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
    uivk_arg: Option<String>,
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

    let (stored_key, seed_file) = match (ufvk_arg, uivk_arg) {
        (Some(s), _) => {
            let ufvk = keys::decode_ufvk(&net, &s)?;
            keys::viewing_keys(&ufvk)?;
            (ufvk.encode(&net).map_err(|e| anyhow!("cannot encode viewing key: {e:?}"))?, None)
        }
        (None, Some(s)) => {
            // Checked here so a bad key fails at init, not at the first scan.
            keys::incoming_key(&net, &s)?;
            if !keys::is_watch_only(&net, &s) {
                bail!("--uivk takes an incoming viewing key; pass a full viewing key with --ufvk");
            }
            (s, None)
        }
        (None, None) => {
            let mnemonic = keys::generate_mnemonic()?;
            let seed = mnemonic.to_seed("");
            let ufvk = keys::ufvk_from_seed(&net, &seed)?;
            let path = store::write_seed(dir, mnemonic.phrase())?;
            (ufvk.encode(&net).map_err(|e| anyhow!("cannot encode viewing key: {e:?}"))?, Some(path))
        }
    };
    let watch_only = keys::is_watch_only(&net, &stored_key);

    let state = State::new(Merchant {
        network: net_name.to_owned(),
        server: server.clone(),
        ufvk: stored_key,
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
    if watch_only {
        println!("  mode           watch-only: verifies payments, mints nothing");
    }
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
    let created_height = match lwd::connect(&state.merchant.server).await {
        Ok(mut c) => lwd::tip(&mut c).await?,
        Err(e) => {
            let fallback = state.last_scanned_height.unwrap_or(state.merchant.birthday_height);
            eprintln!("warning: {e:#}; recording creation height {fallback} instead");
            fallback
        }
    };
    let p = service::mint(&mut state, price, label, created_height)?;
    store::save(dir, &state)?;

    println!("Purchase {}", p.id);
    println!("  price     {} ZEC", format_zec(price));
    println!("  index     base+{}", service::index_offset(p.index));
    println!("  address   {}", p.address);
    println!("  pay URI   {}", p.pay_uri);
    println!();
    println!("Pay it from a shielded balance, then run `fare-scanner scan`.");
    Ok(())
}

async fn scan(dir: &Path, from: Option<u64>, mempool: bool, check_transparent: bool) -> Result<()> {
    let mut state = store::load(dir)?;
    let start = from.unwrap_or_else(|| state.scan_start());
    let mut client = lwd::connect(&state.merchant.server).await?;
    let f = service::fetch(&mut client, service::incoming_key(&state)?, start, mempool, check_transparent).await?;
    let (mined, seen) = service::commit(&mut state, &f);
    store::save(dir, &state)?;
    let tip = f.tip;

    println!(
        "Scanned blocks {start}..={tip} ({} blocks, {} Ironwood actions){}",
        f.blocks,
        f.ironwood_actions,
        if f.with_transparent { ", transparent inputs checked" } else { "" }
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

fn payment_line(pay: &store::Payment, tip: u64) -> String {
    let at = match pay.height {
        Some(h) => format!("height {h}, {} conf", store::confirmations(h, tip)),
        None => "mempool".to_string(),
    };
    let leaky = if pay.transparent_inputs > 0 { "  [funded from transparent inputs]" } else { "" };
    format!("{} ZEC  {:?}  {}  {}{leaky}", format_zec(pay.value_zat), pay.pool, at, pay.txid)
}

/// `+N` for a purchase index, otherwise the raw diversifier index (a wallet address).
fn index_label(diversifier_index: &str) -> String {
    match diversifier_index.parse::<u128>() {
        Ok(j) if j >= u128::from(PURCHASE_INDEX_BASE) => format!("+{}", j - u128::from(PURCHASE_INDEX_BASE)),
        Ok(j) => format!("wallet {j}"),
        Err(_) => diversifier_index.to_string(),
    }
}

fn print_status(state: &State, tip: u64) {
    let req = state.merchant.required_confirmations;
    if state.purchases.is_empty() && state.unattributed.is_empty() {
        println!("No purchases or payments yet.");
        return;
    }
    if !state.purchases.is_empty() {
        println!("{:<34} {:<8} {:>12} {:>12}  STATUS", "PURCHASE", "INDEX", "PRICE", "RECEIVED");
    }
    for p in &state.purchases {
        let mut status = p.status(tip, req).label();
        if p.leaky_funding() {
            status.push_str("  [funded from transparent inputs]");
        }
        println!(
            "{:<34} {:<8} {:>12} {:>12}  {}",
            p.id,
            format!("+{}", p.index - PURCHASE_INDEX_BASE),
            format_zec(p.price_zat),
            if p.received_zat() == 0 { "-".to_string() } else { format_zec(p.received_zat()) },
            status
        );
        for pay in &p.payments {
            println!("    {}", payment_line(pay, tip));
        }
    }
    if !state.unattributed.is_empty() {
        let watch_only = keys::parse_network(&state.merchant.network)
            .map(|n| keys::is_watch_only(&n, &state.merchant.ufvk))
            .unwrap_or(false);
        println!();
        if watch_only {
            println!("Payments to this key by diversifier index (watch-only: a verifier sees them, never issues tokens):");
        } else {
            println!("Payments to this key at addresses no purchase owns (they never issue tokens):");
        }
        let mut rows: Vec<_> = state.unattributed.iter().collect();
        rows.sort_by_key(|u| u.diversifier_index.parse::<u128>().unwrap_or(u128::MAX));
        for u in rows {
            println!("  {:<10} {}", index_label(&u.diversifier_index), payment_line(&u.payment, tip));
        }
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

async fn serve(dir: &Path, listen: SocketAddr, interval: u64, reorg_depth: u64) -> Result<()> {
    http::check_loopback(&listen)?;
    if interval == 0 {
        bail!("--interval must be at least 1 second");
    }
    let state = store::load(dir)?;
    let server = state.merchant.server.clone();
    let shared = Arc::new(tokio::sync::Mutex::new(state));
    let app = http::App { state: shared.clone(), dir: dir.to_path_buf() };

    let listener = tokio::net::TcpListener::bind(listen).await.with_context(|| format!("cannot listen on {listen}"))?;
    println!("serving on http://{listen} (loopback only), scanning {server} every {interval} s");
    tokio::spawn(service::follow(shared, dir.to_path_buf(), server, Duration::from_secs(interval), reorg_depth));
    axum::serve(listener, http::router(app)).await.context("server stopped")
}
