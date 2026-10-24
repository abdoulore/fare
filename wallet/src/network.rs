//! fare-wallet runs on testnet only.

use anyhow::{bail, Result};
use zcash_protocol::consensus::Network;

pub fn testnet_only(name: &str) -> Result<Network> {
    match name {
        "test" | "testnet" => Ok(Network::TestNetwork),
        "main" | "mainnet" => bail!("fare-wallet runs on testnet only; mainnet is refused"),
        other => bail!("unknown network '{other}', use test"),
    }
}
