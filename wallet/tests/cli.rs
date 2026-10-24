//! The binary refuses before touching the seed, the database or the network.

use std::process::{Command, Output};

const BIN: &str = env!("CARGO_BIN_EXE_fare-wallet");
const SEED_ENV: &str = "FARE_PAYER_SEED";

fn run(args: &[&str], seed: Option<&str>) -> Output {
    let dir = tempfile::tempdir().unwrap();
    let mut cmd = Command::new(BIN);
    cmd.arg("--dir").arg(dir.path()).args(args).env_remove(SEED_ENV).env("RUST_BACKTRACE", "0");
    // An unroutable server: any attempt to reach it fails, so a passing test proves
    // the refusal came first.
    cmd.args(["--server", "http://127.0.0.1:9"]);
    if let Some(s) = seed {
        cmd.env(SEED_ENV, s);
    }
    cmd.output().unwrap()
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn orchard_only_address() -> String {
    use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
    use zcash_protocol::consensus::Network;
    let usk = UnifiedSpendingKey::from_seed(&Network::TestNetwork, &[1; 32], zip32::AccountId::ZERO).unwrap();
    let (ua, _) = usk.to_unified_full_viewing_key().default_address(UnifiedAddressRequest::ORCHARD).unwrap();
    ua.encode(&Network::TestNetwork)
}

#[test]
fn mainnet_is_refused_for_every_command() {
    for args in [vec!["balance"], vec!["address"], vec!["sync"], vec!["init", "--birthday", "1"]] {
        let mut all = vec!["--network", "main"];
        all.extend(args);
        let out = run(&all, None);
        assert!(!out.status.success());
        assert!(stderr(&out).contains("testnet only"), "{}", stderr(&out));
    }
}

#[test]
fn pay_refuses_bad_uris_before_reading_the_seed() {
    let to = orchard_only_address();
    let cases = [
        (format!("zcash:{to}?amount=0.001&memo=aGk"), "memo"),
        (format!("zcash:{to}?amount=0.01"), "above --max-zec"),
        ("zcash:tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU?amount=0.001".to_owned(), "no shielded receiver"),
        ("not a uri".to_owned(), "must start with zcash:"),
    ];
    for (uri, expect) in cases {
        let out = run(&["pay", &uri, "--max-zec", "0.002"], None);
        assert!(!out.status.success(), "{uri} was accepted");
        let err = stderr(&out);
        assert!(err.contains(expect), "{uri}: {err}");
        assert!(!err.contains(SEED_ENV), "{uri}: refused for the seed, not the URI: {err}");
    }
}

#[test]
fn pay_requires_max_zec() {
    let to = orchard_only_address();
    let out = run(&["pay", &format!("zcash:{to}?amount=0.001")], None);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("--max-zec"), "{}", stderr(&out));
}

#[test]
fn a_valid_uri_still_needs_the_seed() {
    let to = orchard_only_address();
    let out = run(&["pay", &format!("zcash:{to}?amount=0.001"), "--max-zec", "0.002"], None);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("set FARE_PAYER_SEED"), "{}", stderr(&out));
}

#[test]
fn a_bad_seed_is_never_echoed() {
    let phrase = format!("{} zebrafishword", ["abandon"; 23].join(" "));
    let out = run(&["init", "--birthday", "1"], Some(&phrase));
    assert!(!out.status.success());
    let all = format!("{}{}", stderr(&out), String::from_utf8_lossy(&out.stdout));
    assert!(all.contains("not a valid BIP 39 phrase"), "{all}");
    assert!(!all.contains("zebrafishword") && !all.contains("abandon"), "seed words echoed: {all}");
}
