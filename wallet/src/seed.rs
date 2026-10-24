//! The payer's seed. It comes only from the environment, is never printed, never
//! written to disk and never put in an error message.

use anyhow::{anyhow, bail, Result};
use secrecy::SecretVec;

pub const SEED_ENV: &str = "FARE_PAYER_SEED";

/// Reads the 24-word BIP 39 phrase from `FARE_PAYER_SEED`.
pub fn seed_from_env() -> Result<SecretVec<u8>> {
    let phrase = std::env::var(SEED_ENV).map_err(|_| anyhow!("set {SEED_ENV} to the payer's 24-word testnet phrase"))?;
    seed_from_phrase(&phrase)
}

/// Converts a phrase to its 64-byte seed (empty passphrase, as wallets do). Errors say
/// what is wrong without quoting any word.
pub fn seed_from_phrase(phrase: &str) -> Result<SecretVec<u8>> {
    let words: Vec<&str> = phrase.split_whitespace().collect();
    if words.len() != 24 {
        bail!("{SEED_ENV} must be a 24-word BIP 39 phrase, found {} words", words.len());
    }
    let mnemonic = <bip0039::Mnemonic>::from_phrase(words.join(" "))
        .map_err(|_| anyhow!("{SEED_ENV} is not a valid BIP 39 phrase (unknown word or bad checksum)"))?;
    Ok(SecretVec::new(mnemonic.to_seed("").to_vec()))
}
