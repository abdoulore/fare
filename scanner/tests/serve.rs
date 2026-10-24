//! `fare-scanner serve` handlers, the follow loop's reorg handling and the loopback rule.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tower::ServiceExt;

use fare_scanner::http::{check_loopback, router, App};
use fare_scanner::keys::{self, PURCHASE_INDEX_BASE};
use fare_scanner::scan::{Detection, Pool};
use fare_scanner::service::{self, Fetched};
use fare_scanner::store::{self, Merchant, State};
use zcash_protocol::consensus::Network;

const NET: Network = Network::TestNetwork;
const PRICE: u64 = 100_000; // 0.001 TAZ

struct Fixture {
    app: App,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let ufvk = keys::ufvk_from_seed(&NET, &[1; 32]).unwrap();
    let state = State::new(Merchant {
        network: "test".into(),
        server: "https://testnet.zec.rocks:443".into(),
        ufvk: ufvk.encode(&NET).unwrap(),
        birthday_height: 100,
        next_index: PURCHASE_INDEX_BASE,
        required_confirmations: 1,
    });
    let dir = tempfile::tempdir().unwrap();
    store::create(dir.path(), &state).unwrap();
    Fixture { app: App { state: Arc::new(Mutex::new(state)), dir: dir.path().to_path_buf() }, _dir: dir }
}

async fn call(app: &App, method: &str, uri: &str, body: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap();
    let resp = router(app.clone()).oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn mint(app: &App) -> Value {
    let (status, body) = call(app, "POST", "/mint", &json!({ "price_zat": PRICE }).to_string()).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

fn detection(index: u64, value_zat: u64, height: Option<u64>, transparent_inputs: usize) -> Detection {
    Detection {
        txid: format!("{index:064x}"),
        height,
        pool: Pool::Ironwood,
        action_index: 0,
        diversifier_index: u128::from(index),
        value_zat,
        transparent_inputs,
    }
}

async fn record(app: &App, tip: u64, found: Vec<Detection>, mempool: Option<Vec<Detection>>, start: u64) {
    let fetched = Fetched { start, tip, blocks: 0, ironwood_actions: 0, with_transparent: true, mined: found, mempool };
    let mut state = app.state.lock().await;
    service::commit(&mut state, &fetched);
}

#[tokio::test]
async fn mint_hands_out_fresh_shielded_addresses_and_128_bit_ids() {
    let f = fixture();
    let a = mint(&f.app).await;
    let b = mint(&f.app).await;

    let id = a["purchase_id"].as_str().unwrap();
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_eq!(a["index"], json!(PURCHASE_INDEX_BASE));
    assert_eq!(b["index"], json!(PURCHASE_INDEX_BASE + 1));
    assert_ne!(a["purchase_id"], b["purchase_id"]);
    assert_ne!(a["address"], b["address"]);

    let address = a["address"].as_str().unwrap();
    assert_eq!(a["pay_uri"], json!(format!("zcash:{address}?amount=0.001")), "exactly address and amount, no memo");

    let on_disk = store::load(&f.app.dir).unwrap();
    assert_eq!(on_disk.purchases.len(), 2, "mints are saved before they are handed out");
    assert_eq!(on_disk.purchases[0].id, id);
}

#[tokio::test]
async fn mint_refuses_bad_bodies_without_using_an_index() {
    let f = fixture();
    for body in [
        "",
        "not json",
        "{}",
        r#"{"price_zat": 0}"#,
        r#"{"price_zat": -5}"#,
        r#"{"price_zat": "100000"}"#,
        r#"{"price_zat": 1.5}"#,
        r#"{"price_zat": 100000, "label": "x"}"#,
        r#"{"price_zat": 2100000000000001}"#,
    ] {
        let (status, resp) = call(&f.app, "POST", "/mint", body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} -> {resp}");
        assert!(resp["error"].is_string());
    }
    assert_eq!(mint(&f.app).await["index"], json!(PURCHASE_INDEX_BASE));
}

#[tokio::test]
async fn status_refuses_unknown_and_malformed_ids() {
    let f = fixture();
    mint(&f.app).await;
    let (status, body) = call(&f.app, "GET", &format!("/purchases/{}", "0".repeat(32)), "").await;
    assert_eq!((status, body["error"].as_str()), (StatusCode::NOT_FOUND, Some("unknown_purchase")));
    for bad in ["xyz", "ABCDEF0123456789ABCDEF0123456789", "0123", "../state.json"] {
        let (status, _) = call(&f.app, "GET", &format!("/purchases/{bad}"), "").await;
        assert!(status == StatusCode::BAD_REQUEST || status == StatusCode::NOT_FOUND, "{bad}: {status}");
    }
    let (status, _) = call(&f.app, "GET", "/state.json", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn status_follows_the_chain() {
    let f = fixture();
    let p = mint(&f.app).await;
    let uri = format!("/purchases/{}", p["purchase_id"].as_str().unwrap());

    let (_, body) = call(&f.app, "GET", &uri, "").await;
    assert_eq!((body["status"].as_str(), body["received_zat"].as_u64()), (Some("pending"), Some(0)));

    // Seen in the mempool only: no tokens yet.
    record(&f.app, 104, vec![], Some(vec![detection(PURCHASE_INDEX_BASE, PRICE, None, 0)]), 100).await;
    let (_, body) = call(&f.app, "GET", &uri, "").await;
    assert_eq!(body["status"], json!("in_mempool"));

    // Mined at 105 with the tip at 105: one confirmation, paid.
    record(&f.app, 105, vec![detection(PURCHASE_INDEX_BASE, PRICE, Some(105), 0)], Some(vec![]), 96).await;
    let (_, body) = call(&f.app, "GET", &uri, "").await;
    assert_eq!(body["status"], json!("paid"));
    assert_eq!(body["received_zat"], json!(PRICE));
    assert_eq!(body["payments"][0]["confirmations"], json!(1));
    assert_eq!(body["payments"][0]["height"], json!(105));
    assert_eq!(body["leaky_funding"], json!(false));
}

#[tokio::test]
async fn underpaid_and_transparent_funded_purchases_say_so() {
    let f = fixture();
    let a = mint(&f.app).await;
    let b = mint(&f.app).await;
    record(
        &f.app,
        110,
        vec![
            detection(PURCHASE_INDEX_BASE, PRICE / 2, Some(105), 0),
            detection(PURCHASE_INDEX_BASE + 1, PRICE, Some(106), 2),
        ],
        None,
        100,
    )
    .await;
    let (_, body) = call(&f.app, "GET", &format!("/purchases/{}", a["purchase_id"].as_str().unwrap()), "").await;
    assert_eq!(body["status"], json!("underpaid"));
    let (_, body) = call(&f.app, "GET", &format!("/purchases/{}", b["purchase_id"].as_str().unwrap()), "").await;
    assert_eq!((body["status"].as_str(), body["leaky_funding"].as_bool()), (Some("paid"), Some(true)));
}

#[tokio::test]
async fn a_rescan_drops_a_payment_a_reorg_removed() {
    let f = fixture();
    let p = mint(&f.app).await;
    let uri = format!("/purchases/{}", p["purchase_id"].as_str().unwrap());
    record(&f.app, 105, vec![detection(PURCHASE_INDEX_BASE, PRICE, Some(105), 0)], None, 100).await;
    assert_eq!(call(&f.app, "GET", &uri, "").await.1["status"], json!("paid"));

    // The next pass rescans from 96 and the payment's block is gone.
    let start = service::next_start(&*f.app.state.lock().await, 10);
    assert_eq!(start, 96);
    record(&f.app, 106, vec![], None, start).await;
    assert_eq!(call(&f.app, "GET", &uri, "").await.1["status"], json!("pending"));

    // It reappears in another block: counted once, at its new height.
    record(&f.app, 108, vec![detection(PURCHASE_INDEX_BASE, PRICE, Some(107), 0)], None, 97).await;
    let body = call(&f.app, "GET", &uri, "").await.1;
    assert_eq!((body["status"].as_str(), body["payments"].as_array().unwrap().len()), (Some("paid"), 1));
    assert_eq!(body["payments"][0]["height"], json!(107));
}

#[tokio::test]
async fn payments_below_the_rescan_window_are_kept() {
    let f = fixture();
    mint(&f.app).await;
    record(&f.app, 150, vec![detection(PURCHASE_INDEX_BASE, PRICE, Some(120), 0)], None, 100).await;
    record(&f.app, 151, vec![], None, 142).await;
    assert_eq!(f.app.state.lock().await.purchases[0].payments.len(), 1);
}

#[test]
fn next_start_rescans_the_reorg_window() {
    let f = fixture();
    let mut state = f.app.state.blocking_lock().clone();
    assert_eq!(service::next_start(&state, 10), 100, "no cursor: start at the birthday");
    state.last_scanned_height = Some(1_000);
    assert_eq!(service::next_start(&state, 10), 991);
    state.last_scanned_height = Some(5);
    assert_eq!(service::next_start(&state, 10), 1);
}

#[test]
fn serve_binds_loopback_only() {
    for ok in ["127.0.0.1:7077", "[::1]:7077"] {
        assert!(check_loopback(&ok.parse::<SocketAddr>().unwrap()).is_ok(), "{ok}");
    }
    for bad in ["0.0.0.0:7077", "192.168.1.10:7077", "[::]:7077"] {
        assert!(check_loopback(&bad.parse::<SocketAddr>().unwrap()).is_err(), "{bad}");
    }
}
