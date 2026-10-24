//! Merchant key material and per-purchase address minting.

use anyhow::{anyhow, bail, Result};
use orchard::keys::{FullViewingKey, IncomingViewingKey, Scope};
use zcash_keys::address::UnifiedAddress;
use zcash_keys::keys::{UnifiedFullViewingKey, UnifiedIncomingViewingKey, UnifiedSpendingKey};
use zcash_protocol::consensus::Network;
use zip32::{AccountId, DiversifierIndex};

/// Purchase addresses are minted from this diversifier index upward. Wallets hand out
/// low indices, so a purchase address never collides with an address the merchant's
/// own wallet shows someone else.
pub const PURCHASE_INDEX_BASE: u64 = 1 << 40;

pub fn parse_network(s: &str) -> Result<Network> {
    match s {
        "main" | "mainnet" => Ok(Network::MainNetwork),
        "test" | "testnet" => Ok(Network::TestNetwork),
        other => bail!("unknown network '{other}', use main or test"),
    }
}

pub fn network_name(n: &Network) -> &'static str {
    match n {
        Network::MainNetwork => "main",
        Network::TestNetwork => "test",
    }
}

/// Generates a fresh 24-word BIP 39 phrase from 32 bytes of OS randomness.
pub fn generate_mnemonic() -> Result<bip0039::Mnemonic> {
    let mut entropy = [0u8; 32];
    getrandom::fill(&mut entropy).map_err(|e| anyhow!("no OS randomness: {e}"))?;
    <bip0039::Mnemonic>::from_entropy(entropy.to_vec()).map_err(|e| anyhow!("mnemonic: {e:?}"))
}

/// Derives the account 0 unified full viewing key from a seed, using the same ZIP 32
/// path wallets use, so the seed can be restored in Zodl to spend what was received.
pub fn ufvk_from_seed(network: &Network, seed: &[u8]) -> Result<UnifiedFullViewingKey> {
    let usk = UnifiedSpendingKey::from_seed(network, seed, AccountId::ZERO)
        .map_err(|e| anyhow!("key derivation failed: {e:?}"))?;
    Ok(usk.to_unified_full_viewing_key())
}

pub fn decode_ufvk(network: &Network, s: &str) -> Result<UnifiedFullViewingKey> {
    UnifiedFullViewingKey::decode(network, s.trim()).map_err(|e| anyhow!("bad viewing key: {e}"))
}

/// The Orchard-type viewing keys. Ironwood reuses the Orchard key and receiver structure,
/// so this one incoming viewing key detects both Orchard and Ironwood notes.
pub struct ViewingKeys {
    pub fvk: FullViewingKey,
    pub ivk: IncomingViewingKey,
}

pub fn viewing_keys(ufvk: &UnifiedFullViewingKey) -> Result<ViewingKeys> {
    let fvk = ufvk
        .orchard()
        .ok_or_else(|| anyhow!("viewing key has no Orchard component, so it cannot see Ironwood payments"))?
        .clone();
    let ivk = fvk.to_ivk(Scope::External);
    Ok(ViewingKeys { fvk, ivk })
}

/// The Orchard-type address at diversifier index `index`.
pub fn purchase_address(ivk: &IncomingViewingKey, index: u64) -> orchard::Address {
    ivk.address_at(DiversifierIndex::from(index))
}

/// Encodes a unified address that carries only the Orchard-type receiver: no
/// transparent receiver and no Sapling receiver, so a payer cannot be routed to a
/// public pool by this address.
pub fn encode_shielded_only(network: &Network, addr: orchard::Address) -> Result<String> {
    let ua = UnifiedAddress::from_receivers(Some(addr), None, None, None, None)
        .ok_or_else(|| anyhow!("could not build a unified address"))?;
    Ok(ua.encode(network))
}

/// Decodes a unified address and returns its Orchard-type receiver.
pub fn decode_orchard_receiver(network: &Network, s: &str) -> Result<orchard::Address> {
    let ua = UnifiedAddress::decode(network, s).map_err(|e| anyhow!("bad unified address: {e}"))?;
    ua.orchard().copied().ok_or_else(|| anyhow!("address has no Orchard-type receiver"))
}

/// The unified incoming viewing key to publish for the demo account. It reveals incoming
/// payments to this account only: amounts, heights, diversifier indices. It cannot spend
/// and it reveals nothing about tokens or calls.
/// The external Orchard incoming viewing key from a stored key: a unified full viewing
/// key (a merchant) or a unified incoming viewing key (watch-only, such as a judge holding
/// the published demo key). Both give the same purchase addresses and detect the same
/// payments.
pub fn incoming_key(network: &Network, s: &str) -> Result<IncomingViewingKey> {
    if let Ok(ufvk) = decode_ufvk(network, s) {
        return Ok(viewing_keys(&ufvk)?.ivk);
    }
    let uivk = UnifiedIncomingViewingKey::decode(network, s)
        .map_err(|e| anyhow!("not a unified viewing key for this network: {e:?}"))?;
    uivk.orchard()
        .clone()
        .ok_or_else(|| anyhow!("viewing key has no Orchard component, so it cannot see Ironwood payments"))
}

/// True when the stored key is incoming-only: it can verify payments but mints nothing.
pub fn is_watch_only(network: &Network, s: &str) -> bool {
    decode_ufvk(network, s).is_err()
}

pub fn encode_uivk(network: &Network, ufvk: &UnifiedFullViewingKey) -> Result<String> {
    ufvk.to_unified_incoming_viewing_key()
        .encode(network)
        .map_err(|e| anyhow!("cannot encode viewing key: {e:?}"))
}
