//! Fare payer: a headless testnet wallet that pays Fare purchase URIs.
//!
//! Rules this crate keeps:
//! - The seed comes only from `FARE_PAYER_SEED`. It is never printed, written or logged.
//!   The wallet database holds what `zcash_client_sqlite` stores, which is no seed.
//! - Testnet only. Mainnet is refused.
//! - It pays shielded receivers from shielded notes. No transparent inputs, no memo.
//! - Network reads are wholesale: block ranges, tree states, subtree roots, the tip.

pub mod cache;
pub mod network;
pub mod request;
pub mod seed;
pub mod wallet;
