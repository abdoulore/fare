//! Trial decryption of compact blocks with a viewing key.
//!
//! Each compact Orchard-type action carries the first 52 bytes of the note plaintext:
//! lead byte, diversifier, value and rseed. That is enough to recover the receiving
//! address, and from it the diversifier index, without the memo and without fetching
//! the full transaction.

use orchard::keys::{IncomingViewingKey, PreparedIncomingViewingKey};
use orchard::note_encryption::{CompactAction, IronwoodDomain, OrchardDomain};
use serde::{Deserialize, Serialize};
use zcash_client_backend::proto::compact_formats::{CompactBlock, CompactOrchardAction, CompactTx};
use zcash_note_encryption::try_compact_note_decryption;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pool {
    Ironwood,
    Orchard,
}

/// A note this viewing key can decrypt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Detection {
    /// Display form: byte-reversed hex, as explorers show it.
    pub txid: String,
    /// `None` when seen in the mempool.
    pub height: Option<u64>,
    pub pool: Pool,
    /// Position of the action within its pool's list in the transaction.
    pub action_index: usize,
    pub diversifier_index: u128,
    pub value_zat: u64,
    /// Transparent inputs in the paying transaction. Only known when the server was
    /// asked for transparent data; 0 otherwise.
    pub transparent_inputs: usize,
}

pub struct Detector {
    ivk: IncomingViewingKey,
    prepared: PreparedIncomingViewingKey,
}

impl Detector {
    pub fn new(ivk: IncomingViewingKey) -> Self {
        let prepared = ivk.prepare();
        Self { ivk, prepared }
    }

    pub fn scan_block(&self, block: &CompactBlock) -> Vec<Detection> {
        block
            .vtx
            .iter()
            .flat_map(|tx| self.scan_tx(tx, Some(block.height)))
            .collect()
    }

    pub fn scan_tx(&self, tx: &CompactTx, height: Option<u64>) -> Vec<Detection> {
        let txid = display_txid(&tx.txid);
        let mut found = Vec::new();
        for (i, act) in tx.ironwood_actions.iter().enumerate() {
            if let Some((j, value)) = self.decrypt(act, Pool::Ironwood) {
                found.push(self.detection(&txid, height, Pool::Ironwood, i, j, value, tx));
            }
        }
        for (i, act) in tx.actions.iter().enumerate() {
            if let Some((j, value)) = self.decrypt(act, Pool::Orchard) {
                found.push(self.detection(&txid, height, Pool::Orchard, i, j, value, tx));
            }
        }
        found
    }

    #[allow(clippy::too_many_arguments)]
    fn detection(
        &self,
        txid: &str,
        height: Option<u64>,
        pool: Pool,
        action_index: usize,
        diversifier_index: u128,
        value_zat: u64,
        tx: &CompactTx,
    ) -> Detection {
        Detection {
            txid: txid.to_owned(),
            height,
            pool,
            action_index,
            diversifier_index,
            value_zat,
            transparent_inputs: tx.vin.len(),
        }
    }

    /// Returns `(diversifier index, value in zatoshis)` when the action pays this key.
    /// The Ironwood domain accepts only lead byte 0x03 notes and the Orchard domain only
    /// 0x02, so a note is never counted in the wrong pool.
    fn decrypt(&self, act: &CompactOrchardAction, pool: Pool) -> Option<(u128, u64)> {
        let ca = CompactAction::try_from(act).ok()?;
        let (note, addr) = match pool {
            Pool::Ironwood => {
                try_compact_note_decryption(&IronwoodDomain::for_compact_action(&ca), &self.prepared, &ca)?
            }
            Pool::Orchard => {
                try_compact_note_decryption(&OrchardDomain::for_compact_action(&ca), &self.prepared, &ca)?
            }
        };
        let j = self.ivk.diversifier_index(&addr)?;
        Some((u128::from(j), note.value().inner()))
    }
}

/// Transaction ids travel in protocol byte order; explorers print them reversed.
pub fn display_txid(raw: &[u8]) -> String {
    let mut bytes = raw.to_vec();
    bytes.reverse();
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    #[test]
    fn txid_is_printed_byte_reversed() {
        let mut raw = [0u8; 32];
        raw[0] = 0xab;
        raw[31] = 0x01;
        let shown = super::display_txid(&raw);
        assert!(shown.starts_with("01"));
        assert!(shown.ends_with("ab"));
    }
}
