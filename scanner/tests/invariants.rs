//! Privacy invariants enforced on the source itself. If someone adds a targeted lookup,
//! the build fails before the leak ships.

use std::fs;
use std::path::Path;

fn sources() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            out.push((path.display().to_string(), fs::read_to_string(&path).unwrap()));
        }
    }
    assert!(!out.is_empty());
    out
}

/// Fetching one transaction by id tells the server which transaction is ours.
#[test]
fn never_looks_up_a_single_transaction() {
    for (path, src) in sources() {
        for banned in ["get_transaction(", "GetTransaction", "TxFilter", "get_taddress", "get_address_utxos"] {
            assert!(!src.contains(banned), "{path} uses {banned}: a targeted lookup leaks which transaction or address is ours");
        }
    }
}

/// The scanner runs on a viewing key. It must never load the seed it wrote.
#[test]
fn never_reads_the_seed_back() {
    for (path, src) in sources() {
        if src.contains("seed_path(") {
            for line in src.lines().filter(|l| l.contains("seed_path(")) {
                assert!(
                    line.contains("pub fn seed_path") || line.contains("let path = seed_path(dir)"),
                    "{path} touches the seed path outside write_seed: {line}"
                );
            }
        }
        assert!(!src.contains("from_phrase("), "{path} parses a seed phrase");
    }
}

/// Payment requests carry no memo: matching is by address, so nothing identifying is sent.
#[test]
fn payment_requests_carry_no_memo() {
    for (path, src) in sources() {
        assert!(!src.contains("memo="), "{path} builds a payment request with a memo");
    }
}

/// The sidecar logs nothing about requests: no peer address, no timing next to an id.
#[test]
fn serve_logs_nothing_about_requests() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let http = fs::read_to_string(dir.join("http.rs")).unwrap();
    for banned in ["println!", "eprintln!", "tracing", "ConnectInfo", "TraceLayer"] {
        assert!(!http.contains(banned), "http.rs uses {banned}");
    }
    let service = fs::read_to_string(dir.join("service.rs")).unwrap();
    for line in service.lines().filter(|l| l.contains("println!") || l.contains("eprintln!")) {
        assert!(!line.contains(".id") && !line.contains("purchase"), "service.rs logs a purchase: {line}");
    }
}
