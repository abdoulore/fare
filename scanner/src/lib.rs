//! Fare scanner: detects shielded payments to per-purchase addresses.
//!
//! Privacy rules this crate keeps:
//! - It holds a viewing key only. The seed is written once by `init` and never read again.
//! - It reads whole compact blocks and whole mempool snapshots. It never asks a server
//!   for one transaction by id, so no server learns which transactions are ours.
//! - It never needs a memo. A payment is matched to its purchase by the diversifier
//!   index of the address it was sent to.

pub mod keys;
pub mod lwd;
pub mod scan;
pub mod store;
pub mod zec;
