//! `fare-scanner serve`: the issuer's sidecar. Loopback only, two routes:
//!
//! - `POST /mint {price_zat}` returns `201 {purchase_id, index, address, pay_uri}`
//! - `GET /purchases/{id}` returns `{status, received_zat, payments, ...}`
//! - `GET /ledger` returns every purchase by index offset, with no ids: what the
//!   published incoming viewing key shows anyway, plus status
//! - `GET /health` returns `{scanned_to, purchases}`
//!
//! `POST /mint` answers `503 not_synced` until the first scan has finished, so a fresh
//! state learns which indexes earlier runs used before it hands one out.
//!
//! It logs nothing about requests: no addresses, no timing, no purchase ids.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Result};
use axum::body::Bytes;
use axum::extract::{Path, State as AxState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::keys::PURCHASE_INDEX_BASE;
use crate::service;
use crate::store::{self, State};

#[derive(Clone)]
pub struct App {
    pub state: Arc<Mutex<State>>,
    pub dir: PathBuf,
}

pub fn router(app: App) -> Router {
    Router::new()
        .route("/mint", post(mint))
        .route("/purchases/{id}", get(purchase))
        .route("/ledger", get(ledger))
        .route("/health", get(health))
        .fallback(|| async { error(StatusCode::NOT_FOUND, "not_found") })
        .with_state(app)
}

/// Refuses any address that is not loopback: the sidecar has no authentication.
pub fn check_loopback(addr: &SocketAddr) -> Result<()> {
    if !addr.ip().is_loopback() {
        bail!("serve binds to loopback only (127.0.0.1 or ::1), refusing {addr}");
    }
    Ok(())
}

fn error(code: StatusCode, reason: &str) -> Response {
    (code, Json(json!({ "error": reason }))).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MintRequest {
    price_zat: u64,
}

async fn mint(AxState(app): AxState<App>, body: Bytes) -> Response {
    let Ok(req) = serde_json::from_slice::<MintRequest>(&body) else {
        return error(StatusCode::BAD_REQUEST, "body must be {\"price_zat\": <integer>}");
    };
    if req.price_zat == 0 || req.price_zat > service::MAX_PRICE_ZAT {
        return error(StatusCode::BAD_REQUEST, "price_zat out of range");
    }
    let mut state = app.state.lock().await;
    if state.last_scanned_height.is_none() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "not_synced");
    }
    let created_height = state.last_scanned_height.unwrap_or(state.merchant.birthday_height);
    let purchase = match service::mint(&mut state, req.price_zat, None, created_height) {
        Ok(p) => p,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "mint_failed"),
    };
    if store::save(&app.dir, &state).is_err() {
        // Not persisted, so not handed out: drop it and give the index back.
        state.purchases.pop();
        state.merchant.next_index -= 1;
        return error(StatusCode::INTERNAL_SERVER_ERROR, "state_not_saved");
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "purchase_id": purchase.id,
            "index": purchase.index,
            "address": purchase.address,
            "pay_uri": purchase.pay_uri,
        })),
    )
        .into_response()
}

fn valid_id(id: &str) -> bool {
    // 128-bit ids from serve; 64-bit ids from CLI mints made before serve existed.
    matches!(id.len(), 16 | 32) && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

async fn purchase(AxState(app): AxState<App>, Path(id): Path<String>) -> Response {
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "malformed_id");
    }
    let state = app.state.lock().await;
    let Some(p) = state.purchases.iter().find(|p| p.id == id) else {
        return error(StatusCode::NOT_FOUND, "unknown_purchase");
    };
    let tip = state.last_scanned_height.unwrap_or(0);
    let required = state.merchant.required_confirmations;
    let payments: Vec<Value> = p
        .payments
        .iter()
        .map(|pay| {
            json!({
                "txid": pay.txid,
                "pool": pay.pool,
                "height": pay.height,
                "value_zat": pay.value_zat,
                "confirmations": pay.height.map(|h| store::confirmations(h, tip)),
                "transparent_inputs": pay.transparent_inputs,
            })
        })
        .collect();
    Json(json!({
        "status": p.status(tip, required).code(),
        "received_zat": p.received_zat(),
        "price_zat": p.price_zat,
        "payments": payments,
        "leaky_funding": p.leaky_funding(),
        "scanned_to": state.last_scanned_height,
        "required_confirmations": required,
    }))
    .into_response()
}

async fn health(AxState(app): AxState<App>) -> Response {
    let state = app.state.lock().await;
    Json(json!({ "scanned_to": state.last_scanned_height, "purchases": state.purchases.len() })).into_response()
}

/// One row per purchase and per payment no purchase owns, ordered by index. No purchase
/// ids (they fetch signatures), no addresses, no txids, no creation times.
async fn ledger(AxState(app): AxState<App>) -> Response {
    let state = app.state.lock().await;
    let tip = state.last_scanned_height.unwrap_or(0);
    let required = state.merchant.required_confirmations;
    let mut rows: Vec<(u64, Value)> = state
        .purchases
        .iter()
        .filter(|p| p.index >= PURCHASE_INDEX_BASE)
        .map(|p| {
            let offset = p.index - PURCHASE_INDEX_BASE;
            let height = p.payments.iter().filter_map(|pay| pay.height).min();
            (
                offset,
                json!({
                    "index": offset,
                    "price_zat": p.price_zat,
                    "received_zat": p.received_zat(),
                    "payments": p.payments.len(),
                    "height": height,
                    "status": p.status(tip, required).code(),
                }),
            )
        })
        .collect();
    for u in &state.unattributed {
        let Some(offset) = u.diversifier_index.parse::<u64>().ok().and_then(|j| j.checked_sub(PURCHASE_INDEX_BASE)) else {
            continue;
        };
        rows.push((
            offset,
            json!({
                "index": offset,
                "price_zat": null,
                "received_zat": u.payment.value_zat,
                "payments": 1,
                "height": u.payment.height,
                "status": "no_record",
            }),
        ));
    }
    rows.sort_by_key(|(offset, _)| *offset);
    Json(json!({ "scanned_to": state.last_scanned_height, "rows": rows.into_iter().map(|(_, v)| v).collect::<Vec<_>>() }))
        .into_response()
}
