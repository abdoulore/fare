//! `fare-scanner check`: the canary verdict a workflow can fail on.

use fare_scanner::keys::PURCHASE_INDEX_BASE;
use fare_scanner::scan::Pool;
use fare_scanner::store::{Merchant, Payment, Purchase, State};

const PRICE: u64 = 100_000; // 0.001 ZEC

fn state(tip: Option<u64>) -> State {
    let mut s = State::new(Merchant {
        network: "test".into(),
        server: "https://testnet.zec.rocks:443".into(),
        ufvk: String::new(),
        birthday_height: 100,
        next_index: PURCHASE_INDEX_BASE,
        required_confirmations: 1,
    });
    s.last_scanned_height = tip;
    s
}

fn purchase(label: &str, index: u64, paid_zat: &[(u64, Option<u64>)]) -> Purchase {
    Purchase {
        id: format!("{index:016x}"),
        index: PURCHASE_INDEX_BASE + index,
        price_zat: PRICE,
        address: String::new(),
        pay_uri: String::new(),
        label: Some(label.into()),
        created_unix: 0,
        created_height: 100,
        payments: paid_zat
            .iter()
            .enumerate()
            .map(|(i, &(value_zat, height))| Payment {
                txid: format!("{index:02}{i:062}"),
                pool: Pool::Ironwood,
                action_index: 0,
                height,
                value_zat,
                transparent_inputs: 0,
            })
            .collect(),
    }
}

fn labels(l: &[&str]) -> Vec<String> {
    l.iter().map(|s| s.to_string()).collect()
}

fn canary_state() -> State {
    let mut s = state(Some(110));
    s.purchases.push(purchase("canary", 0, &[(PRICE, Some(105))]));
    s.purchases.push(purchase("underpay", 1, &[(PRICE / 2, Some(106))]));
    s
}

#[test]
fn passes_when_paid_and_underpaid_match() {
    let lines = canary_state().check(&labels(&["canary"]), &labels(&["underpay"])).unwrap();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].starts_with("canary: paid"));
    assert!(lines[1].starts_with("underpay: underpaid"));
}

#[test]
fn fails_on_a_pending_purchase() {
    let mut s = canary_state();
    s.purchases[0].payments.clear();
    let err = s.check(&labels(&["canary"]), &labels(&["underpay"])).unwrap_err().to_string();
    assert!(err.contains("canary: pending (expected paid)"), "{err}");
}

#[test]
fn fails_on_a_mempool_only_payment() {
    let mut s = canary_state();
    s.purchases[0].payments[0].height = None;
    let err = s.check(&labels(&["canary"]), &[]).unwrap_err().to_string();
    assert!(err.contains("canary: in mempool (expected paid)"), "{err}");
}

#[test]
fn fails_when_an_underpaid_purchase_is_listed_as_paid() {
    let err = canary_state().check(&labels(&["canary", "underpay"]), &[]).unwrap_err().to_string();
    assert!(err.contains("underpay: underpaid (short 0.0005 ZEC) (expected paid)"), "{err}");
    assert!(!err.contains("canary:"), "the paid purchase is not a failure: {err}");
}

#[test]
fn fails_when_a_paid_purchase_is_listed_as_underpaid() {
    let err = canary_state().check(&[], &labels(&["canary"])).unwrap_err().to_string();
    assert!(err.contains("canary: paid (expected underpaid)"), "{err}");
}

#[test]
fn fails_on_an_unknown_label() {
    let err = canary_state().check(&labels(&["canary", "nope"]), &[]).unwrap_err().to_string();
    assert!(err.contains("no purchase labelled 'nope'"), "{err}");
}

#[test]
fn fails_on_a_repeated_label() {
    let mut s = canary_state();
    s.purchases.push(purchase("canary", 2, &[(PRICE, Some(107))]));
    let err = s.check(&labels(&["canary"]), &[]).unwrap_err().to_string();
    assert!(err.contains("more than one purchase labelled 'canary'"), "{err}");
}

#[test]
fn fails_before_any_scan_and_with_nothing_to_check() {
    let mut s = canary_state();
    assert!(s.check(&[], &[]).unwrap_err().to_string().contains("nothing to check"));
    s.last_scanned_height = None;
    let err = s.check(&labels(&["canary"]), &[]).unwrap_err().to_string();
    assert!(err.contains("no scan recorded yet"), "{err}");
}
