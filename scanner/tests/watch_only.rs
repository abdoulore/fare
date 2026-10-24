//! Watch-only verification with a published incoming viewing key: what a judge runs.

use std::process::Command;

use fare_scanner::keys::{self, PURCHASE_INDEX_BASE};
use fare_scanner::service;
use fare_scanner::store::{Merchant, State};
use zcash_protocol::consensus::Network;

const NET: Network = Network::TestNetwork;
const BIN: &str = env!("CARGO_BIN_EXE_fare-scanner");

fn keys_for(byte: u8) -> (String, String) {
    let ufvk = keys::ufvk_from_seed(&NET, &[byte; 32]).unwrap();
    (ufvk.encode(&NET).unwrap(), keys::encode_uivk(&NET, &ufvk).unwrap())
}

fn state_with(key: &str) -> State {
    State::new(Merchant {
        network: "test".into(),
        server: "https://testnet.zec.rocks:443".into(),
        ufvk: key.into(),
        birthday_height: 1,
        next_index: PURCHASE_INDEX_BASE,
        required_confirmations: 1,
    })
}

#[test]
fn the_incoming_key_sees_the_same_purchase_addresses_as_the_full_key() {
    let (ufvk, uivk) = keys_for(9);
    let full = keys::incoming_key(&NET, &ufvk).unwrap();
    let watch = keys::incoming_key(&NET, &uivk).unwrap();
    for offset in [0u64, 1, 2, 1000] {
        let j = PURCHASE_INDEX_BASE + offset;
        assert_eq!(keys::purchase_address(&full, j), keys::purchase_address(&watch, j), "index +{offset}");
    }
    assert!(!keys::is_watch_only(&NET, &ufvk));
    assert!(keys::is_watch_only(&NET, &uivk));
}

#[test]
fn rejects_garbage_and_other_networks() {
    assert!(keys::incoming_key(&NET, "not a key").is_err());
    let main_ufvk = keys::ufvk_from_seed(&Network::MainNetwork, &[9; 32]).unwrap();
    let main_uivk = keys::encode_uivk(&Network::MainNetwork, &main_ufvk).unwrap();
    assert!(keys::incoming_key(&NET, &main_uivk).is_err());
}

#[test]
fn a_watch_only_state_mints_nothing() {
    let (ufvk, uivk) = keys_for(9);
    let mut watch = state_with(&uivk);
    let err = service::mint(&mut watch, 100_000, None, 1).unwrap_err().to_string();
    assert!(err.contains("watch-only"), "{err}");
    assert!(watch.purchases.is_empty());
    assert_eq!(watch.merchant.next_index, PURCHASE_INDEX_BASE, "no index consumed");

    let mut merchant = state_with(&ufvk);
    assert!(service::mint(&mut merchant, 100_000, None, 1).is_ok());
}

fn cli(dir: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(BIN).arg("--dir").arg(dir).args(args).env("RUST_BACKTRACE", "0").output().unwrap()
}

#[test]
fn cli_init_with_uivk_is_watch_only() {
    let (ufvk, uivk) = keys_for(10);
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("verify");

    let out = cli(&data, &["init", "--network", "test", "--uivk", &uivk, "--birthday", "1"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains("watch-only"));
    assert!(!data.join("SEED-MOVE-OFFLINE.txt").exists(), "no seed for a verifier");

    let mint = cli(&data, &["mint", "--zec", "0.001"]);
    assert!(!mint.status.success());
    assert!(String::from_utf8_lossy(&mint.stderr).contains("watch-only"));

    let vk = cli(&data, &["viewing-key"]);
    assert_eq!(String::from_utf8_lossy(&vk.stdout).trim(), uivk);

    // A full viewing key passed as --uivk is refused: it would grant more than verifying.
    let other = dir.path().join("wrong");
    let refused = cli(&other, &["init", "--network", "test", "--uivk", &ufvk, "--birthday", "1"]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--ufvk"));
}
