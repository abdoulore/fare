//! Scanning and minting shared by the CLI and `serve`.
//!
//! A scan is split in two: `fetch` talks to lightwalletd and returns detections without
//! touching state, `commit` applies them. `serve` holds its state lock only for the
//! commit, so minting keeps working while blocks download.

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use orchard::keys::IncomingViewingKey;

use crate::keys::{self, PURCHASE_INDEX_BASE};
use crate::lwd::{self, Client};
use crate::scan::{Detection, Detector};
use crate::store::{self, Applied, Purchase, State};
use crate::zec::format_zec;

/// Upper bound on a price: total ZEC supply in zatoshis.
pub const MAX_PRICE_ZAT: u64 = 21_000_000 * 100_000_000;

/// What one pass over the chain saw. Nothing here has been applied yet.
pub struct Fetched {
    pub start: u64,
    pub tip: u64,
    pub blocks: u64,
    pub ironwood_actions: usize,
    pub with_transparent: bool,
    pub mined: Vec<Detection>,
    /// `None` when the mempool was not read.
    pub mempool: Option<Vec<Detection>>,
}

pub fn incoming_key(state: &State) -> Result<IncomingViewingKey> {
    let net = keys::parse_network(&state.merchant.network)?;
    keys::incoming_key(&net, &state.merchant.ufvk)
}

/// Reads blocks `from..=tip` and, if asked, one mempool snapshot. Wholesale requests only.
pub async fn fetch(
    client: &mut Client,
    ivk: IncomingViewingKey,
    from: u64,
    mempool: bool,
    check_transparent: bool,
) -> Result<Fetched> {
    let detector = Detector::new(ivk);
    let tip = lwd::tip(client).await?;
    if from > tip {
        bail!("start height {from} is above the chain tip {tip}");
    }

    let mut with_transparent = check_transparent;
    let mut stream = match lwd::blocks(client, from, tip, with_transparent).await {
        Ok(s) => s,
        Err(e) if with_transparent => {
            eprintln!("warning: server refused transparent data ({e:#}); scanning shielded pools only");
            with_transparent = false;
            lwd::blocks(client, from, tip, false).await?
        }
        Err(e) => return Err(e),
    };

    let mut blocks = 0u64;
    let mut ironwood_actions = 0usize;
    let mut mined = Vec::new();
    while let Some(block) = stream.message().await.context("block stream")? {
        blocks += 1;
        ironwood_actions += block.vtx.iter().map(|t| t.ironwood_actions.len()).sum::<usize>();
        mined.extend(detector.scan_block(&block));
    }

    let mempool = if mempool {
        let mut txs = lwd::mempool(client, with_transparent).await?;
        let mut pending = Vec::new();
        while let Some(tx) = txs.message().await.context("mempool stream")? {
            pending.extend(detector.scan_tx(&tx, None));
        }
        Some(pending)
    } else {
        None
    };

    Ok(Fetched { start: from, tip, blocks, ironwood_actions, with_transparent, mined, mempool })
}

/// Applies a fetch: forgets what it covers, records what it found, moves the cursor.
/// Returns (mined, mempool) attribution counts.
pub fn commit(state: &mut State, f: &Fetched) -> (Applied, Applied) {
    state.forget_from(f.start, f.mempool.is_some());
    let mined = state.apply(&f.mined);
    let seen = f.mempool.as_deref().map(|m| state.apply(m)).unwrap_or_default();
    state.last_scanned_height = Some(f.tip);
    (mined, seen)
}

/// Where the next follow pass starts: the last `reorg_depth` blocks below the cursor
/// are scanned again, so a payment a reorg moved or removed is corrected.
pub fn next_start(state: &State, reorg_depth: u64) -> u64 {
    match state.last_scanned_height {
        Some(cursor) => (cursor + 1).saturating_sub(reorg_depth).max(1),
        None => state.scan_start(),
    }
}

/// 128 random bits, hex. A purchase id is a capability, so it must not be guessable.
pub fn random_id() -> Result<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| anyhow!("no OS randomness: {e}"))?;
    Ok(hex::encode(b))
}

pub fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Mints a purchase at the next diversifier index. The caller saves the state.
pub fn mint(state: &mut State, price_zat: u64, label: Option<String>, created_height: u64) -> Result<Purchase> {
    if price_zat == 0 || price_zat > MAX_PRICE_ZAT {
        bail!("price must be between 1 zatoshi and the ZEC supply");
    }
    let net = keys::parse_network(&state.merchant.network)?;
    if keys::is_watch_only(&net, &state.merchant.ufvk) {
        bail!("watch-only: an incoming viewing key verifies payments but does not mint purchases");
    }
    let ivk = keys::incoming_key(&net, &state.merchant.ufvk)?;
    let index = state.allocate_index();
    let address = keys::encode_shielded_only(&net, keys::purchase_address(&ivk, index))?;
    let pay_uri = format!("zcash:{address}?amount={}", format_zec(price_zat));
    let purchase = Purchase {
        id: random_id()?,
        index,
        price_zat,
        address,
        pay_uri,
        label,
        created_unix: now_unix(),
        created_height,
        payments: Vec::new(),
    };
    state.purchases.push(purchase.clone());
    Ok(purchase)
}

pub fn index_offset(index: u64) -> u64 {
    index - PURCHASE_INDEX_BASE
}

/// One follow pass against `server`, committed to `shared` and saved to `dir`.
pub async fn follow_once(
    shared: &tokio::sync::Mutex<State>,
    dir: &Path,
    server: &str,
    reorg_depth: u64,
) -> Result<Fetched> {
    let (ivk, start) = {
        let state = shared.lock().await;
        (incoming_key(&state)?, next_start(&state, reorg_depth))
    };
    let mut client = lwd::connect(server).await?;
    let fetched = fetch(&mut client, ivk, start, true, true).await?;
    let mut state = shared.lock().await;
    commit(&mut state, &fetched);
    store::save(dir, &state)?;
    Ok(fetched)
}

/// Runs follow passes forever, `interval` apart. Errors are reported and retried; the
/// log carries heights and counts only, never purchase ids.
pub async fn follow(shared: std::sync::Arc<tokio::sync::Mutex<State>>, dir: std::path::PathBuf, server: String, interval: Duration, reorg_depth: u64) {
    loop {
        match follow_once(&shared, &dir, &server, reorg_depth).await {
            Ok(f) => println!(
                "scanned {}..={} ({} blocks, {} Ironwood actions), {} mined and {} mempool notes for this key",
                f.start,
                f.tip,
                f.blocks,
                f.ironwood_actions,
                f.mined.len(),
                f.mempool.as_ref().map_or(0, |m| m.len())
            ),
            Err(e) => eprintln!("scan failed, retrying: {e:#}"),
        }
        tokio::time::sleep(interval).await;
    }
}
