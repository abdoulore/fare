//! Source checks that fail the build if the payer gains a leak.

use std::fs;
use std::path::Path;

fn sources() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            out.push((path.file_name().unwrap().to_string_lossy().into_owned(), fs::read_to_string(&path).unwrap()));
        }
    }
    assert!(out.len() >= 5, "source files not found");
    out
}

#[test]
fn never_looks_up_a_single_transaction_or_address() {
    // GetTransaction takes a TxFilter; the address calls name an address. Reading a
    // transaction back from the local wallet database is fine and is not a server call.
    let forbidden = ["TxFilter", "get_taddress", "get_address_utxos", "GetAddressUtxos", "get_mempool", "GetTransaction"];
    for (name, src) in sources() {
        for f in forbidden {
            assert!(!src.contains(f), "{name} uses {f}");
        }
    }
}

#[test]
fn transparent_spending_is_not_compiled_in() {
    let manifest = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
    for f in ["transparent-inputs", "transparent-key-import"] {
        assert!(!manifest.contains(f), "Cargo.toml enables {f}");
    }
}

#[test]
fn the_seed_is_exposed_only_for_key_derivation_and_migration() {
    for (name, src) in sources() {
        let uses = src.matches("expose_secret()").count();
        let allowed = if name == "wallet.rs" { 2 } else { 0 };
        assert_eq!(uses, allowed, "{name} exposes the seed {uses} times");
    }
}

#[test]
fn the_seed_is_never_written_or_printed() {
    for (name, src) in sources() {
        for line in src.lines() {
            let l = line.to_lowercase();
            let prints = ["println!", "eprintln!", "print!(", "fs::write", "write!(", "writeln!"].iter().any(|p| l.contains(p));
            if prints {
                assert!(!l.contains("seed") || l.contains("seed_env") || l.contains("fare_payer_seed"), "{name}: {line}");
                assert!(!l.contains("phrase") && !l.contains("usk") && !l.contains("ufvk"), "{name}: {line}");
            }
        }
    }
}
