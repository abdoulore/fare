//! Purchases, payments and their status, kept in one JSON file.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::keys::PURCHASE_INDEX_BASE;
use crate::scan::{Detection, Pool};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Merchant {
    pub network: String,
    pub server: String,
    /// Unified full viewing key, or a unified incoming viewing key for a watch-only
    /// verifier. Never the seed.
    pub ufvk: String,
    pub birthday_height: u64,
    pub next_index: u64,
    pub required_confirmations: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payment {
    pub txid: String,
    pub pool: Pool,
    pub action_index: usize,
    /// `None` while only seen in the mempool.
    pub height: Option<u64>,
    pub value_zat: u64,
    pub transparent_inputs: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Purchase {
    pub id: String,
    pub index: u64,
    pub price_zat: u64,
    pub address: String,
    pub pay_uri: String,
    pub label: Option<String>,
    pub created_unix: u64,
    pub created_height: u64,
    pub payments: Vec<Payment>,
}

/// A payment to this viewing key at an index no purchase owns. Never issues tokens.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Unattributed {
    pub diversifier_index: String,
    pub payment: Payment,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct State {
    pub merchant: Merchant,
    pub purchases: Vec<Purchase>,
    pub unattributed: Vec<Unattributed>,
    pub last_scanned_height: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    /// Nothing seen yet.
    Pending,
    /// Seen in the mempool only.
    InMempool { value_zat: u64 },
    /// Mined, not yet at the required depth.
    Confirming { confirmations: u64, required: u64 },
    /// Enough value at enough depth. Tokens may be issued.
    Paid { overpaid_zat: u64 },
    /// At depth but short of the price. No tokens.
    Underpaid { short_zat: u64 },
}

impl Status {
    /// Stable machine-readable form, used by `serve`.
    pub fn code(&self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::InMempool { .. } => "in_mempool",
            Status::Confirming { .. } => "confirming",
            Status::Paid { .. } => "paid",
            Status::Underpaid { .. } => "underpaid",
        }
    }

    pub fn label(&self) -> String {
        match self {
            Status::Pending => "pending".into(),
            Status::InMempool { .. } => "in mempool".into(),
            Status::Confirming { confirmations, required } => {
                format!("confirming {confirmations}/{required}")
            }
            Status::Paid { overpaid_zat: 0 } => "paid".into(),
            Status::Paid { overpaid_zat } => {
                format!("paid (+{} ZEC over)", crate::zec::format_zec(*overpaid_zat))
            }
            Status::Underpaid { short_zat } => {
                format!("underpaid (short {} ZEC)", crate::zec::format_zec(*short_zat))
            }
        }
    }
}

impl Purchase {
    /// Status at chain tip `tip`. Only mined payments with `required` confirmations count
    /// toward the price; mempool-only payments never unlock tokens.
    pub fn status(&self, tip: u64, required: u64) -> Status {
        let required = required.max(1);
        if self.payments.is_empty() {
            return Status::Pending;
        }
        let deep: u64 = self
            .payments
            .iter()
            .filter(|p| p.height.is_some_and(|h| confirmations(h, tip) >= required))
            .map(|p| p.value_zat)
            .sum();
        if deep >= self.price_zat {
            return Status::Paid { overpaid_zat: deep - self.price_zat };
        }
        let mined: Vec<u64> = self.payments.iter().filter_map(|p| p.height).collect();
        if let Some(newest) = mined.iter().max() {
            let shallow = self
                .payments
                .iter()
                .any(|p| p.height.is_some_and(|h| confirmations(h, tip) < required));
            if shallow {
                return Status::Confirming { confirmations: confirmations(*newest, tip), required };
            }
            return Status::Underpaid { short_zat: self.price_zat - deep };
        }
        let seen: u64 = self.payments.iter().map(|p| p.value_zat).sum();
        Status::InMempool { value_zat: seen }
    }

    /// True when any paying transaction spent transparent inputs: the payer exposed
    /// their own address on chain. Fare cannot prevent it, so it says so.
    pub fn leaky_funding(&self) -> bool {
        self.payments.iter().any(|p| p.transparent_inputs > 0)
    }

    pub fn received_zat(&self) -> u64 {
        self.payments.iter().map(|p| p.value_zat).sum()
    }
}

pub fn confirmations(height: u64, tip: u64) -> u64 {
    if tip >= height {
        tip - height + 1
    } else {
        0
    }
}

/// Outcome of applying one batch of detections.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Applied {
    pub attributed: usize,
    pub unattributed: usize,
}

impl State {
    pub fn new(merchant: Merchant) -> Self {
        Self { merchant, purchases: Vec::new(), unattributed: Vec::new(), last_scanned_height: None }
    }

    /// Reserves the next diversifier index for a new purchase.
    pub fn allocate_index(&mut self) -> u64 {
        if self.merchant.next_index < PURCHASE_INDEX_BASE {
            self.merchant.next_index = PURCHASE_INDEX_BASE;
        }
        let j = self.merchant.next_index;
        self.merchant.next_index += 1;
        j
    }

    /// Drops what a rescan starting at `height` will report again: payments mined at or
    /// above it and, when `mempool` is true, every mempool-only sighting. A payment whose
    /// block a reorg removed then disappears instead of lingering. Returns how many went.
    pub fn forget_from(&mut self, height: u64, mempool: bool) -> usize {
        let stale = |p: &Payment| match p.height {
            Some(h) => h >= height,
            None => mempool,
        };
        let mut dropped = 0;
        for purchase in &mut self.purchases {
            let before = purchase.payments.len();
            purchase.payments.retain(|p| !stale(p));
            dropped += before - purchase.payments.len();
        }
        let before = self.unattributed.len();
        self.unattributed.retain(|u| !stale(&u.payment));
        dropped + before - self.unattributed.len()
    }

    /// Records detections. Idempotent: the same (txid, pool, action) is stored once, and a
    /// mempool sighting is upgraded in place when the transaction is mined.
    pub fn apply(&mut self, detections: &[Detection]) -> Applied {
        let mut out = Applied::default();
        for d in detections {
            let payment = Payment {
                txid: d.txid.clone(),
                pool: d.pool,
                action_index: d.action_index,
                height: d.height,
                value_zat: d.value_zat,
                transparent_inputs: d.transparent_inputs,
            };
            let owner = u64::try_from(d.diversifier_index)
                .ok()
                .and_then(|j| self.purchases.iter_mut().find(|p| p.index == j));
            match owner {
                Some(purchase) => {
                    upsert(&mut purchase.payments, payment);
                    out.attributed += 1;
                }
                None => {
                    let key = d.diversifier_index.to_string();
                    match self.unattributed.iter_mut().find(|u| same_output(&u.payment, &payment)) {
                        Some(existing) => merge(&mut existing.payment, payment),
                        None => self.unattributed.push(Unattributed { diversifier_index: key, payment }),
                    }
                    out.unattributed += 1;
                }
            }
        }
        out
    }

    /// Canary verdict as of the last scan. Every `paid` label must be `Paid` and every
    /// `underpaid` label must be `Underpaid`. Returns one line per purchase on success,
    /// and an error naming every mismatch otherwise. Unknown or repeated labels are errors.
    pub fn check(&self, paid: &[String], underpaid: &[String]) -> Result<Vec<String>> {
        let tip = self.last_scanned_height.ok_or_else(|| anyhow!("no scan recorded yet, run `fare-scanner scan` first"))?;
        if paid.is_empty() && underpaid.is_empty() {
            bail!("nothing to check, pass --paid or --underpaid");
        }
        let req = self.merchant.required_confirmations;
        let mut lines = Vec::new();
        let mut failures = Vec::new();
        let expected = paid.iter().map(|l| (l, true)).chain(underpaid.iter().map(|l| (l, false)));
        for (label, want_paid) in expected {
            let mut matches = self.purchases.iter().filter(|p| p.label.as_deref() == Some(label.as_str()));
            let purchase = match (matches.next(), matches.next()) {
                (Some(p), None) => p,
                (None, _) => bail!("no purchase labelled '{label}'"),
                (Some(_), Some(_)) => bail!("more than one purchase labelled '{label}'"),
            };
            let status = purchase.status(tip, req);
            let ok = match status {
                Status::Paid { .. } => want_paid,
                Status::Underpaid { .. } => !want_paid,
                _ => false,
            };
            let line = format!(
                "{label}: {} (expected {}) at tip {tip}",
                status.label(),
                if want_paid { "paid" } else { "underpaid" }
            );
            if ok {
                lines.push(line);
            } else {
                failures.push(line);
            }
        }
        if !failures.is_empty() {
            bail!("canary check failed:\n  {}", failures.join("\n  "));
        }
        Ok(lines)
    }

    /// Lowest height a scan must start from to see every purchase's payments.
    pub fn scan_start(&self) -> u64 {
        self.purchases
            .iter()
            .map(|p| p.created_height)
            .min()
            .unwrap_or(self.merchant.birthday_height)
            .max(1)
    }
}

fn same_output(a: &Payment, b: &Payment) -> bool {
    a.txid == b.txid && a.pool == b.pool && a.action_index == b.action_index
}

fn merge(existing: &mut Payment, newer: Payment) {
    if newer.height.is_some() {
        existing.height = newer.height;
    }
    existing.transparent_inputs = existing.transparent_inputs.max(newer.transparent_inputs);
    existing.value_zat = newer.value_zat;
}

fn upsert(payments: &mut Vec<Payment>, p: Payment) {
    match payments.iter_mut().find(|x| same_output(x, &p)) {
        Some(existing) => merge(existing, p),
        None => payments.push(p),
    }
}

pub fn state_path(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

pub fn seed_path(dir: &Path) -> PathBuf {
    dir.join("SEED-MOVE-OFFLINE.txt")
}

pub fn load(dir: &Path) -> Result<State> {
    let path = state_path(dir);
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("no merchant at {}; run `fare-scanner init` first", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("corrupt state file {}", path.display()))
}

pub fn save(dir: &Path, state: &State) -> Result<()> {
    fs::create_dir_all(dir)?;
    let path = state_path(dir);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(state)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn create(dir: &Path, state: &State) -> Result<()> {
    if state_path(dir).exists() {
        bail!("a merchant already exists in {}; refusing to overwrite it", dir.display());
    }
    save(dir, state)
}

/// Writes the seed phrase readable by the owner only. The scanner never reads it back.
pub fn write_seed(dir: &Path, phrase: &str) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = seed_path(dir);
    if path.exists() {
        return Err(anyhow!("{} exists; refusing to overwrite a seed", path.display()));
    }
    fs::write(&path, format!("{phrase}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(path)
}
