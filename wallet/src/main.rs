use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

use fare_scanner::lwd;
use fare_scanner::zec::{format_zec, parse_zec};
use fare_wallet::network::testnet_only;
use fare_wallet::request::check_uri;
use fare_wallet::seed::seed_from_env;
use fare_wallet::wallet;

#[derive(Parser)]
#[command(name = "fare-wallet", about = "Headless testnet payer for Fare purchase URIs. Shielded notes only, no memo.")]
struct Cli {
    /// Directory holding the wallet database. It never holds the seed.
    #[arg(long, global = true, default_value = "fare-wallet-data")]
    dir: PathBuf,
    /// Network. Only test is accepted.
    #[arg(long, global = true, default_value = "test")]
    network: String,
    /// lightwalletd URL. Defaults to testnet.zec.rocks.
    #[arg(long, global = true)]
    server: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create the payer account from FARE_PAYER_SEED, or confirm it exists.
    Init {
        /// First block that can hold the payer's funds.
        #[arg(long)]
        birthday: u32,
    },
    /// Scan up to the chain tip.
    Sync,
    /// Balance per pool as of the last sync: spendable and pending.
    Balance,
    /// Unified address (Orchard-type receiver only) to fund the payer.
    Address,
    /// Pay a zcash: URI from shielded notes and print the txid.
    Pay {
        uri: String,
        /// Refuse any URI asking for more than this, in ZEC.
        #[arg(long)]
        max_zec: String,
        /// Before planning, keep syncing for up to this many seconds while notes (such
        /// as change from an earlier payment) are still pending.
        #[arg(long, default_value_t = 0)]
        wait_secs: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let net = testnet_only(&cli.network)?;
    let server = cli.server.clone().unwrap_or_else(|| lwd::default_server("test").to_owned());
    match cli.cmd {
        Cmd::Init { birthday } => {
            let seed = seed_from_env()?;
            let mut client = lwd::connect(&server).await?;
            if wallet::init(&cli.dir, net, Some(&mut client), &seed, birthday).await? {
                println!("Payer account created in {} at birthday {birthday}.", cli.dir.display());
            } else {
                println!("Payer account already in {}; nothing to do.", cli.dir.display());
            }
            Ok(())
        }
        Cmd::Sync => {
            let mut db = wallet::open(&cli.dir, net, None)?;
            wallet::account(&db)?;
            let mut client = lwd::connect(&server).await?;
            wallet::sync(&mut db, &mut client, &net).await?;
            if let Some((tip, scanned)) = wallet::heights(&db)? {
                println!("Synced: chain tip {tip}, fully scanned to {scanned}.");
            }
            Ok(())
        }
        Cmd::Balance => print_balance(&cli.dir, net),
        Cmd::Address => {
            let mut db = wallet::open(&cli.dir, net, None)?;
            println!("{}", wallet::funding_address(&mut db, &net)?);
            Ok(())
        }
        Cmd::Pay { uri, max_zec, wait_secs } => {
            // Every refusal that needs no seed, database or network happens first.
            let max_zat = parse_zec(&max_zec)?;
            let req = check_uri(&net, &uri, max_zat)?;
            let seed = seed_from_env()?;
            let usk = wallet::spending_key(&net, &seed)?;
            drop(seed);
            let mut db = wallet::open(&cli.dir, net, None)?;
            let account = wallet::ensure_account_matches(&db, &usk)?;
            let mut client = lwd::connect(&server).await?;
            let deadline = Instant::now() + Duration::from_secs(wait_secs);
            loop {
                wallet::sync(&mut db, &mut client, &net).await?;
                let pending = wallet::pending_shielded_zat(&db)?;
                if pending == 0 || Instant::now() >= deadline {
                    break;
                }
                println!("Waiting for {} ZEC of pending notes to confirm.", format_zec(pending));
                tokio::time::sleep(Duration::from_secs(15)).await;
            }
            let proposal = wallet::propose(&mut db, &net, account, &req)?;
            println!("Paying   {} ZEC", format_zec(u64::from(req.amount)));
            println!("To       {}", req.recipient_str);
            println!("Fee      {} ZEC", format_zec(wallet::total_fee(&proposal)));
            println!("Steps    {} transaction(s), shielded inputs only", proposal.steps().len());
            let txids = wallet::execute(&mut db, &mut client, &net, usk, &proposal).await?;
            for txid in &txids {
                println!("TXID {txid}");
            }
            Ok(())
        }
    }
}

fn print_balance(dir: &Path, net: zcash_protocol::consensus::Network) -> Result<()> {
    let db = wallet::open(dir, net, None)?;
    let Some(pools) = wallet::balance(&db)? else {
        bail!("no balance yet, run `fare-wallet sync`");
    };
    if let Some((tip, scanned)) = wallet::heights(&db)? {
        println!("As of chain tip {tip}, fully scanned to {scanned}, 1 confirmation:");
    }
    println!("{:<12} {:>14} {:>14}", "POOL", "SPENDABLE", "PENDING");
    for p in &pools {
        println!("{:<12} {:>14} {:>14}", p.pool, format_zec(p.spendable_zat), format_zec(p.pending_zat));
    }
    println!("fare-wallet spends shielded notes only. It never spends transparent funds.");
    Ok(())
}
