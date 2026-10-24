//! The payer account: database, sync, balance, funding address and payments.
//!
//! Network use is wholesale only: `sync::run` asks for subtree roots, the latest block,
//! block ranges and tree states by height; `init` asks for one tree state by height;
//! `pay` sends the transaction it built. Nothing names an address or a transaction id.

use std::convert::Infallible;
use std::error::Error as _;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use rand::rand_core::UnwrapErr;
use rand::rngs::SysRng;
use secrecy::{ExposeSecret, SecretVec};
use zcash_client_backend::data_api::error::Error as DataError;
use zcash_client_backend::data_api::wallet::{
    create_proposed_transactions, propose_standard_transfer_to_address, ConfirmationsPolicy, SpendingKeys,
};
use zcash_client_backend::data_api::{AccountBirthday, Balance, WalletRead, WalletWrite};
use zcash_client_backend::fees::StandardFeeRule;
use zcash_client_backend::proposal::Proposal;
use zcash_client_backend::proto::service::{BlockId, RawTransaction};
use zcash_client_backend::wallet::OvkPolicy;
use zcash_client_sqlite::util::SystemClock;
use zcash_client_sqlite::wallet::init::{init_wallet_db, WalletMigrationError};
use zcash_client_sqlite::{AccountUuid, ReceivedNoteId, WalletDb};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_primitives::transaction::TxId;
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::consensus::Network;
use zcash_protocol::ShieldedPool;

use fare_scanner::lwd::Client;
use fare_scanner::zec::format_zec;

use crate::cache::MemBlockCache;
use crate::request::PayRequest;

pub type Db = WalletDb<rusqlite::Connection, Network, SystemClock, UnwrapErr<SysRng>>;
pub type PayProposal = Proposal<StandardFeeRule, ReceivedNoteId>;

pub const DB_FILE: &str = "wallet.sqlite";
const ACCOUNT_NAME: &str = "fare-payer";
const SYNC_BATCH: u32 = 1000;

/// Opens (creating if needed) the wallet database in `dir` and applies migrations. The
/// seed is offered only if a migration asks for it.
pub fn open(dir: &Path, net: Network, seed: Option<&SecretVec<u8>>) -> Result<Db> {
    fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    let mut db = WalletDb::for_path(dir.join(DB_FILE), net, SystemClock, UnwrapErr(SysRng))
        .with_context(|| format!("cannot open {}", dir.join(DB_FILE).display()))?;
    match init_wallet_db(&mut db, None) {
        Err(e) if matches!(e.source().and_then(|s| s.downcast_ref()), Some(&WalletMigrationError::SeedRequired)) => {
            let seed = seed.ok_or_else(|| anyhow!("the wallet database needs the seed to migrate; run `fare-wallet init`"))?;
            init_wallet_db(&mut db, Some(SecretVec::new(seed.expose_secret().clone())))
                .map_err(|e| anyhow!("wallet database migration failed: {e}"))?;
        }
        Err(e) => bail!("wallet database setup failed: {e}"),
        Ok(()) => {}
    }
    Ok(db)
}

/// ZIP 32 account 0 of the seed, the account other wallets derive from the same phrase.
pub fn spending_key(net: &Network, seed: &SecretVec<u8>) -> Result<UnifiedSpendingKey> {
    UnifiedSpendingKey::from_seed(net, seed.expose_secret(), zip32::AccountId::ZERO)
        .map_err(|e| anyhow!("key derivation failed: {e:?}"))
}

/// The single payer account in the database.
pub fn account(db: &Db) -> Result<AccountUuid> {
    let ids = db.get_account_ids().map_err(|e| anyhow!("cannot list accounts: {e}"))?;
    match ids.as_slice() {
        [id] => Ok(*id),
        [] => bail!("no payer account yet, run `fare-wallet init`"),
        _ => bail!("the wallet database holds {} accounts, expected one", ids.len()),
    }
}

/// Fails unless the database's account is the one `usk` controls.
pub fn ensure_account_matches(db: &Db, usk: &UnifiedSpendingKey) -> Result<AccountUuid> {
    let id = account(db)?;
    let ufvk = usk.to_unified_full_viewing_key();
    match db.get_account_for_ufvk(&ufvk).map_err(|e| anyhow!("cannot look up account: {e}"))? {
        Some(_) => Ok(id),
        None => bail!("FARE_PAYER_SEED does not match the account in this wallet database"),
    }
}

/// Creates the payer account at `birthday`, or confirms it already exists for this seed.
/// Returns true when an account was created.
pub async fn init(dir: &Path, net: Network, client: Option<&mut Client>, seed: &SecretVec<u8>, birthday: u32) -> Result<bool> {
    let usk = spending_key(&net, seed)?;
    let mut db = open(dir, net, Some(seed))?;
    if db
        .get_account_for_ufvk(&usk.to_unified_full_viewing_key())
        .map_err(|e| anyhow!("cannot look up account: {e}"))?
        .is_some()
    {
        return Ok(false);
    }
    if !db.get_account_ids().map_err(|e| anyhow!("cannot list accounts: {e}"))?.is_empty() {
        bail!("{} holds another seed's account; use a fresh --dir", dir.display());
    }
    if birthday == 0 {
        bail!("--birthday must be at least 1");
    }
    let client = client.ok_or_else(|| anyhow!("creating the account needs the server"))?;
    let tree_state = client
        .get_tree_state(BlockId { height: u64::from(birthday - 1), hash: vec![] })
        .await
        .context("tree state request failed")?
        .into_inner();
    let birthday =
        AccountBirthday::from_treestate(tree_state, None).map_err(|e| anyhow!("server sent a bad tree state: {e:?}"))?;
    db.import_account_hd(ACCOUNT_NAME, seed, zip32::AccountId::ZERO, &birthday, None)
        .map_err(|e| anyhow!("cannot create the payer account: {e}"))?;
    Ok(true)
}

/// Brings the wallet up to the chain tip.
pub async fn sync(db: &mut Db, client: &mut Client, net: &Network) -> Result<()> {
    let cache = MemBlockCache::default();
    zcash_client_backend::sync::run(client, net, &cache, db, SYNC_BATCH)
        .await
        .map_err(|e| anyhow!("sync failed: {e}"))
}

/// Chain tip and fully scanned height, if the wallet has synced at least once.
pub fn heights(db: &Db) -> Result<Option<(u32, u32)>> {
    let summary = db.get_wallet_summary(ConfirmationsPolicy::MIN).map_err(|e| anyhow!("cannot read the wallet: {e}"))?;
    Ok(summary.map(|s| (u32::from(s.chain_tip_height()), u32::from(s.fully_scanned_height()))))
}

pub struct PoolBalance {
    pub pool: &'static str,
    pub spendable_zat: u64,
    pub pending_zat: u64,
}

fn pool(pool: &'static str, b: &Balance) -> PoolBalance {
    PoolBalance {
        pool,
        spendable_zat: u64::from(b.spendable_value()),
        pending_zat: u64::from(b.change_pending_confirmation()) + u64::from(b.value_pending_spendability()),
    }
}

/// Per-pool balance at one confirmation, the policy `pay` spends under.
pub fn balance(db: &Db) -> Result<Option<Vec<PoolBalance>>> {
    let id = account(db)?;
    let Some(summary) = db.get_wallet_summary(ConfirmationsPolicy::MIN).map_err(|e| anyhow!("cannot read the wallet: {e}"))? else {
        return Ok(None);
    };
    let Some(b) = summary.account_balances().get(&id) else {
        return Ok(None);
    };
    Ok(Some(vec![
        pool("Ironwood", b.ironwood_balance()),
        pool("Orchard", b.orchard_balance()),
        pool("Sapling", b.sapling_balance()),
        pool("transparent", &b.unshielded_balance()),
    ]))
}

/// Shielded value received but not yet spendable, such as unconfirmed change.
pub fn pending_shielded_zat(db: &Db) -> Result<u64> {
    Ok(balance(db)?
        .map(|pools| pools.iter().filter(|p| p.pool != "transparent").map(|p| p.pending_zat).sum())
        .unwrap_or(0))
}

/// The address to fund the payer: Orchard-type receiver only, which receives Ironwood.
pub fn funding_address(db: &mut Db, net: &Network) -> Result<String> {
    let id = account(db)?;
    let req = UnifiedAddressRequest::ORCHARD;
    let existing = db.get_last_generated_address_matching(id, req).map_err(|e| anyhow!("cannot read addresses: {e}"))?;
    let ua = match existing {
        Some(ua) => ua,
        None => {
            db.get_next_available_address(id, req)
                .map_err(|e| anyhow!("cannot derive an address: {e}"))?
                .ok_or_else(|| anyhow!("no address available for this account"))?
                .0
        }
    };
    Ok(ua.encode(net))
}

/// Plans the payment: shielded inputs only, change to the wallet's own shielded pool,
/// standard ZIP 317 fee, notes with at least one confirmation.
pub fn propose(db: &mut Db, net: &Network, account: AccountUuid, req: &PayRequest) -> Result<PayProposal> {
    let proposal = propose_standard_transfer_to_address::<_, _, Infallible>(
        db,
        net,
        StandardFeeRule::Zip317,
        account,
        ConfirmationsPolicy::MIN,
        &req.recipient,
        req.amount,
        None,
        None,
        ShieldedPool::Ironwood,
        None,
        None,
    )
    .map_err(|e| match e {
        DataError::InsufficientFunds { available, required } => anyhow!(
            "insufficient funds: {} ZEC spendable, {} ZEC needed with the fee; fund the payer (`fare-wallet address`) or wait for pending notes to confirm",
            format_zec(u64::from(available)),
            format_zec(u64::from(required))
        ),
        DataError::ScanRequired => anyhow!("the wallet has not synced yet, run `fare-wallet sync`"),
        other => anyhow!("cannot plan the payment: {other}"),
    })?;
    if proposal.steps().iter().any(|s| !s.transparent_inputs().is_empty()) {
        bail!("the plan spends transparent inputs, refusing");
    }
    Ok(proposal)
}

/// Total fee across every transaction in the plan.
pub fn total_fee(proposal: &PayProposal) -> u64 {
    proposal.steps().iter().map(|s| u64::from(s.balance().fee_required())).sum()
}

/// Builds, proves and stores the planned transactions, then broadcasts each one.
pub async fn execute(
    db: &mut Db,
    client: &mut Client,
    net: &Network,
    usk: UnifiedSpendingKey,
    proposal: &PayProposal,
) -> Result<Vec<TxId>> {
    let prover = LocalTxProver::bundled();
    let txids = create_proposed_transactions::<_, _, Infallible, _, Infallible, _>(
        db,
        net,
        &SystemClock,
        &mut UnwrapErr(SysRng),
        &prover,
        &prover,
        &SpendingKeys::from_unified_spending_key(usk),
        OvkPolicy::Sender,
        proposal,
        None,
    )
    .map_err(|e| anyhow!("cannot build the transaction: {e}"))?;

    let mut sent = Vec::new();
    for txid in txids.iter() {
        let tx = db
            .get_transaction(*txid)
            .map_err(|e| anyhow!("cannot read back transaction {txid}: {e}"))?
            .ok_or_else(|| anyhow!("transaction {txid} was not stored"))?;
        let mut data = Vec::new();
        tx.write(&mut data).context("cannot serialize the transaction")?;
        let resp = client
            .send_transaction(RawTransaction { data, height: 0 })
            .await
            .with_context(|| format!("broadcast of {txid} failed"))?
            .into_inner();
        if resp.error_code != 0 {
            bail!("server rejected transaction {txid}: {} (code {})", resp.error_message, resp.error_code);
        }
        sent.push(*txid);
    }
    Ok(sent)
}
